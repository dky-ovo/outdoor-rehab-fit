#!/usr/bin/env python3
"""Stage private Nginx candidates; never replace or reload the live config."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tempfile


def require(condition, code):
    if not condition:
        raise SystemExit(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


require(os.geteuid() == 0, 'PREPARE_REQUIRES_ROOT')
os.umask(0o077)
source = Path('/etc/nginx/sites-available/outdoor-fit')
enabled = Path('/etc/nginx/sites-enabled/outdoor-fit')
main = Path('/etc/nginx/nginx.conf')
require(enabled.resolve(strict=True) == source and source.is_file()
        and not source.is_symlink(), 'SITE_PATH_CHANGED')
probe = subprocess.run(['nginx', '-T'], capture_output=True, timeout=20)
require(probe.returncode == 0, 'CURRENT_NGINX_CONFIG_INVALID')
dump = probe.stdout.decode('utf-8')
active = set(re.findall(r'(?m)^# configuration file (/[^\r\n]+):\r?$', dump))
require(active == {'/etc/nginx/nginx.conf', '/etc/nginx/mime.types',
                   str(enabled), '/etc/letsencrypt/options-ssl-nginx.conf'},
        'ACTIVE_NGINX_FILES_CHANGED')
original = source.read_bytes()
text = original.decode('utf-8')
upstream = re.compile(r'(?m)^([ \t]*)proxy_pass[ \t]+http://127\.0\.0\.1:3000[ \t]*;[ \t]*(?:#[^\r\n]*)?$')
host = re.compile(r'(?m)^([ \t]*)proxy_set_header[ \t]+Host[ \t]+\$host[ \t]*;[ \t]*(?:#[^\r\n]*)?$')
require(len(upstream.findall(text)) == 2 and len(host.findall(text)) == 2,
        'EXPECTED_TWO_API_PROXIES_REQUIRED')
require(len(re.findall(r'(?m)^\s*proxy_pass\b', text)) == 2
        and not re.search(r'(?m)^\s*(?:proxy_ssl_\w+|proxy_next_upstream)\b', text),
        'EXISTING_PROXY_SETTINGS_REQUIRE_REVIEW')
locations = re.findall(r'(?m)^[ \t]*location[ \t]+([^\r\n{]+)\{[ \t]*$', text)
require(sorted(value.strip() for value in locations)
        == sorted(['/api/', '/', '= /api/admin/media/upload']),
        'SITE_LOCATIONS_CHANGED')
api_blocks = re.findall(r'(?m)^[ \t]*location[ \t]+(?:/api/|=[ \t]+/api/admin/media/upload)[ \t]*\{([^{}]*)\}', text)
require(len(api_blocks) == 2 and all(len(upstream.findall(body)) == 1
        and len(host.findall(body)) == 1 for body in api_blocks),
        'API_PROXY_SCOPE_REQUIRES_REVIEW')

tls = ['proxy_pass https://api.outdoorfit.hk;',
       'proxy_ssl_server_name on;', 'proxy_ssl_name api.outdoorfit.hk;',
       'proxy_ssl_verify on;', 'proxy_ssl_verify_depth 5;',
       'proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;',
       'proxy_next_upstream off;']
final = upstream.sub(lambda m: '\n'.join(m[1] + line for line in tls), text)
final = host.sub(lambda m: m[1] + 'proxy_set_header Host api.outdoorfit.hk;', final)
maintenance = upstream.sub(lambda m: m[1] + 'return 503;', text)
require(Path('/etc/ssl/certs/ca-certificates.crt').is_file(), 'PUBLIC_CA_UNAVAILABLE')
main_bytes = main.read_bytes()
main_text = main_bytes.decode('utf-8')
include = re.compile(r'(?m)^([ \t]*)include[ \t]+/etc/nginx/sites-enabled/\*[ \t]*;[ \t]*(?:#[^\r\n]*)?$')
require(len(include.findall(main_text)) == 1, 'MAIN_INCLUDE_REQUIRES_REVIEW')
folder = Path(tempfile.mkdtemp(prefix='outdoor-fit-cutover-', dir='/home/dukaiyu2004'))
print('CUTOVER_DIR=' + str(folder), flush=True)
files = {'original.conf': original, 'maintenance.conf': maintenance.encode('utf-8'),
         'aliyun.conf': final.encode('utf-8')}
for name, data in files.items():
    with (folder / name).open('xb') as stream:
        stream.write(data)
    if name == 'original.conf':
        continue
    wrapper = include.sub(lambda m: m[1] + 'include ' + str(folder / name) + ';', main_text)
    check = folder / (name + '.check')
    with check.open('x', encoding='utf-8') as stream:
        stream.write(wrapper)
    result = subprocess.run(['nginx', '-t', '-p', '/etc/nginx/', '-c', str(check)],
                            capture_output=True, timeout=20)
    with (folder / (name + '.check.log')).open('xb') as stream:
        stream.write(result.stdout + result.stderr)
    require(result.returncode == 0, 'CANDIDATE_NGINX_CHECK_FAILED_' + name.split('.')[0].upper())
require(source.read_bytes() == original and main.read_bytes() == main_bytes,
        'ACTIVE_CONFIGURATION_CHANGED_DURING_PREPARE')
manifest = {'source': str(source), 'source_sha256': digest(original),
            'main_sha256': digest(main_bytes), 'files': {name: digest(data) for name, data in files.items()}}
with (folder / 'manifest.json').open('x', encoding='utf-8') as stream:
    json.dump(manifest, stream, indent=2)
print('API_PROXY_COUNT=2')
print('MAINTENANCE_CONFIG=PASS')
print('ALIYUN_PROXY_CONFIG=PASS')
print('LIVE_CONFIG=UNCHANGED')
print('CUTOVER_PREPARE=COMPLETE')
