#!/usr/bin/env python3
"""Install reviewed account continuity. Preserve live proxy configuration and secrets."""
import copy, fcntl, getpass, hashlib, json, os, pathlib, re, shutil, subprocess, sys, time

BASE = pathlib.Path('/opt/outdoor-fit/production')
TAG = '20260928-v10'
IMAGE = 'outdoor-fit-api:' + TAG
STATE = BASE / '.update-state' / ('account-data-' + TAG)
RELEASE = BASE / 'releases' / ('outdoor-fit-account-data-' + TAG)
PACKAGE = pathlib.Path(__file__).resolve().parent

def require(ok, code):
    if not ok: raise RuntimeError(code)

def run(args, data=None, show=False):
    result = subprocess.run(args, input=data, text=True, capture_output=not show)
    if result.returncode and not show:
        for line in (result.stdout + result.stderr).splitlines():
            if re.fullmatch(r'(ACCOUNT_DATA_SCHEMA=(PASS|FAIL)|ERROR_CODE=[A-Z0-9_]{1,80})', line): print(line, flush=True)
    require(result.returncode == 0, 'UPDATE_COMMAND_FAILED')
    return result.stdout

def inspect(name): return json.loads(run(['docker', 'inspect', name]))[0]
def save(name, value):
    (STATE / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    (STATE / name).chmod(0o600)

def compose(path, *args):
    return ['docker', 'compose', '--project-name', 'outdoor-fit-production', '-f', str(path), *args]

def capture(container, service):
    labels = container['Config']['Labels']
    require(labels.get('com.docker.compose.project') == 'outdoor-fit-production' and labels.get('com.docker.compose.service') == service, 'UPDATE_PROJECT_MISMATCH')
    paths = labels['com.docker.compose.project.config_files'].split(',')
    command = ['docker', 'compose', '--env-file', str(BASE / 'secrets/production.env')]
    for path in paths:
        file = pathlib.Path(path).resolve()
        require(BASE in file.parents and file.is_file(), 'UPDATE_COMPOSE_PATH_INVALID')
        command += ['-f', str(file)]
    value = json.loads(run(command + ['config', '--format', 'json']))
    resolved = value['services'][service]
    image = json.loads(run(['docker', 'image', 'inspect', resolved['image']]))[0]
    require(image['Id'] == container['Image'], 'UPDATE_LIVE_IMAGE_CONFIG_DRIFT')
    mounts = {x['Destination']: x['Source'] for x in container['Mounts'] if x['Type'] == 'bind'}
    for volume in resolved.get('volumes', []):
        if volume['type'] == 'bind': require(mounts.get(volume['target']) == volume['source'], 'UPDATE_LIVE_MOUNT_CONFIG_DRIFT')
    return value

def up(path, service): run(compose(path, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service), show=True)

def health():
    for attempt in range(24):
        result = subprocess.run(['docker', 'exec', 'outdoor-fit-production-api-1', 'node', '-e',
            "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(r=>process.exit(r.ok&&r.service==='outdoor-fit-api'?0:1)).catch(()=>process.exit(1))"], capture_output=True)
        if result.returncode == 0: return
        time.sleep(2)
    raise RuntimeError('UPDATE_HEALTH_FAILED')

def main():
    os.umask(0o077)
    require(os.geteuid() == 0, 'UPDATE_ROOT_REQUIRED')
    with (BASE / '.account-data.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        for name, expected in manifest['files'].items():
            path = PACKAGE / name
            require(not path.is_symlink() and path.is_file() and PACKAGE in path.resolve().parents, 'UPDATE_FILE_INVALID')
            require(hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'UPDATE_HASH_MISMATCH')
        require(not STATE.exists() and not RELEASE.exists(), 'UPDATE_ALREADY_STAGED_REVIEW_STATE')
        api, caddy = inspect('outdoor-fit-production-api-1'), inspect('outdoor-fit-production-caddy-1')
        require(api['State']['Running'] and caddy['State']['Running'], 'UPDATE_SERVICES_NOT_RUNNING')
        require(api['Config']['Image'] == 'outdoor-fit-api:20260928-v9', 'UPDATE_V9_BASELINE_REQUIRED')
        api_config, caddy_config = capture(api, 'api'), capture(caddy, 'caddy')
        web_mount = next(x for x in caddy['Mounts'] if x['Destination'] == '/srv/admin')
        current_web = pathlib.Path(web_mount['Source'])
        reused_web = {}
        for name, expected in manifest['webFiles'].items():
            relative = pathlib.PurePosixPath(name)
            require(relative.parts[0] == 'web' and '..' not in relative.parts and not relative.is_absolute(), 'UPDATE_WEB_PATH_INVALID')
            if name in manifest['files']: continue
            source = current_web.joinpath(*relative.parts[1:])
            require(not source.is_symlink() and source.is_file() and current_web.resolve() in source.resolve().parents, 'UPDATE_BASE_WEB_MISSING')
            require(hashlib.sha256(source.read_bytes()).hexdigest() == expected, 'UPDATE_BASE_WEB_HASH_MISMATCH')
            reused_web[name] = source
        STATE.mkdir(mode=0o700, parents=True)
        RELEASE.mkdir(mode=0o755, parents=True)
        for name in manifest['files']:
            source, target = PACKAGE / name, RELEASE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target); target.chmod(0o644)
        for name, source in reused_web.items():
            target = RELEASE / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target); target.chmod(0o644)
        for name, expected in manifest['webFiles'].items():
            require(hashlib.sha256((RELEASE / name).read_bytes()).hexdigest() == expected, 'UPDATE_WEB_COPY_MISMATCH')
        # Bind-mounted web assets must be traversable by Caddy's UID 1000.
        for parent, dirs, files in os.walk(RELEASE):
            pathlib.Path(parent).chmod(0o755)
        base_image = 'outdoor-fit-account-data-base:' + TAG
        run(['docker', 'tag', api['Image'], base_image])
        print('UPDATE_PHASE=building', flush=True)
        run(['docker', 'build', '--pull=false', '--build-arg', 'BASE_IMAGE=' + base_image, '-t', IMAGE, str(RELEASE)], show=True)
        # Old production binaries enforce exactly 40 tables. Build a rollback
        # image that also accepts the additive account table before any DDL runs.
        rollback = STATE / 'rollback'; rollback.mkdir()
        run(['docker', 'cp', 'outdoor-fit-production-api-1:/app/src/production.js', str(rollback / 'production.js')])
        source = (rollback / 'production.js').read_text()
        require(source.count('Number(tables?.count) !== 40') == 1, 'UPDATE_BASELINE_REQUIRES_REVIEW')
        (rollback / 'production.js').write_text(source.replace('Number(tables?.count) !== 40', '![40, 41].includes(Number(tables?.count))'))
        (rollback / 'Dockerfile').write_text('FROM ' + base_image + '\nCOPY --chown=1000:1000 production.js /app/src/production.js\nRUN node --check /app/src/production.js\n')
        rollback_image = 'outdoor-fit-account-data-rollback:' + TAG
        run(['docker', 'build', '--pull=false', '-t', rollback_image, str(rollback)], show=True)
        new_api = copy.deepcopy(api_config); new_api['services']['api']['image'] = IMAGE
        old_api = copy.deepcopy(api_config); old_api['services']['api']['image'] = rollback_image
        new_web = copy.deepcopy(caddy_config)
        volumes = new_web['services']['caddy']['volumes']
        require(sum(x['target'] == '/srv/admin' for x in volumes) == 1, 'UPDATE_WEB_MOUNT_REQUIRED')
        for item in volumes:
            if item['target'] == '/srv/admin': item['source'] = str(RELEASE / 'web')
        for name, value in [('api.json', new_api), ('rollback-api.json', old_api), ('caddy.json', new_web), ('rollback-caddy.json', caddy_config)]:
            save(name, value); run(compose(STATE / name, 'config', '--quiet'))
        # A rollback command remains available even if SSH disconnects mid-upgrade.
        rollback_script = '#!/bin/bash\nset -euo pipefail\n'
        import shlex
        rollback_script += shlex.join(compose(STATE / 'rollback-api.json', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'api')) + '\n'
        rollback_script += shlex.join(compose(STATE / 'rollback-caddy.json', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'caddy')) + '\n'
        (STATE / 'rollback.sh').write_text(rollback_script)
        print('ROLLBACK_SCRIPT=' + str(STATE / 'rollback.sh'), flush=True)
        print('UPDATE_PHASE=schema', flush=True)
        environment = dict(x.split('=', 1) for x in api['Config']['Env'] if '=' in x)
        command = ['docker', 'run', '--rm', '-i', '--network', 'container:outdoor-fit-production-api-1', '--volumes-from', 'outdoor-fit-production-api-1:ro']
        for key in ('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_SSL_CA'):
            require(environment.get(key), 'UPDATE_MYSQL_CONFIGURATION_MISSING'); command += ['-e', key + '=' + environment[key]]
        command += ['--entrypoint', 'node', IMAGE, 'continuity/migrate.mjs']
        password = getpass.getpass('RDS password for outdoor_fit_migrator: ')
        try:
            print(run(command, data=json.dumps({'password': password})), end='', flush=True)
        except BaseException:
            # MySQL DDL commits independently. A partial additive migration must
            # not strand the previous service behind its 40-table startup gate.
            up(STATE / 'rollback-api.json', 'api'); health()
            raise
        finally: password = None
        api_changed = caddy_changed = False
        try:
            print('UPDATE_PHASE=activating', flush=True)
            api_changed = True; up(STATE / 'api.json', 'api'); health()
            caddy_changed = True; up(STATE / 'caddy.json', 'caddy')
            run(['curl', '--fail', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', '--max-time', '15', 'https://api.outdoorfit.hk/api/health'])
            html = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', 'https://admin.outdoorfit.hk/admin'])
            require(html.encode() == (RELEASE / 'web/index.html').read_bytes(), 'UPDATE_WEB_RESPONSE_MISMATCH')
            # Write completion only after the app domain and new routes pass below.
            app_html = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', 'https://app.outdoorfit.hk/'])
            require(app_html.encode() == (RELEASE / 'web/index.html').read_bytes(), 'UPDATE_APP_RESPONSE_MISMATCH')
            for endpoint in ['account/data/sync', 'account/learning']:
                args = ['curl', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '15']
                if endpoint.endswith('sync'): args += ['--request', 'POST', '--header', 'Content-Type: application/json', '--data', '{}']
                require(run(args + ['https://api.outdoorfit.hk/api/' + endpoint]).strip() == '401', 'UPDATE_ACCOUNT_ROUTE_MISSING')
            save('report.json', {'status':'complete', 'image':IMAGE, 'web':str(RELEASE/'web')})
            print('ACCOUNT_DATA_UPDATE=PASS', flush=True)
        except BaseException:
            print('UPDATE_PHASE=rollback', flush=True)
            if api_changed: up(STATE / 'rollback-api.json', 'api'); health()
            if caddy_changed: up(STATE / 'rollback-caddy.json', 'caddy')
            raise

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'ACCOUNT_DATA_UPDATE_FAILED', file=sys.stderr)
        sys.exit(1)
