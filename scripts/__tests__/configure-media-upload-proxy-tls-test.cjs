const test = require('node:test');
const assert = require('node:assert/strict');
const { configureUploads, validateTlsInclude, main } = require('../configure-media-upload-proxy.cjs');
const host = 'outdoor-fit.35-241-75-217.sslip.io';
const tlsPath = '/etc/letsencrypt/options-ssl-nginx.conf';
// Directive shapes taken from Certbot's official v2.9.0 template; shortened
// cipher list is test data, not a TLS configuration recommended for deployment.
const tls = `# managed TLS settings\nssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384";`;
const api = `location /api/ {
  proxy_pass http://127.0.0.1:3000;
  auth_basic "Private # admin";
  auth_basic_user_file /etc/nginx/.admin-passwords;
  allow 10.0.0.0/8; deny all;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  add_header X-Private "preserved" always;
}`;
const redirect = `server { if ($host = ${host}) { return 301 https://$host$request_uri; } listen 80; server_name ${host}; return 404; }`;
const source = `server {
  server_name ${host};
  client_max_body_size 25m;
  ${api}
  location / { try_files $uri $uri/ /index.html; }
  listen 443 ssl;
  ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
  include ${tlsPath}; # managed by Certbot
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
${redirect}`;
const options = (contents = tls) => ({ activeFiles: new Map([[tlsPath, contents]]) });

test('actual Certbot TLS directive shapes pass, preserving 25m default, API ACLs, headers and redirect', () => {
  const configured = configureUploads(source, options());
  assert.equal(configured.count, 1);
  assert.ok(configured.output.includes(api));
  assert.ok(configured.output.endsWith(redirect));
  assert.equal((configured.output.match(/client_max_body_size 25m;/g) || []).length, 1);
  assert.equal((configured.output.match(/client_max_body_size 260m;/g) || []).length, 1);
  assert.equal((configured.output.match(/auth_basic "Private # admin";/g) || []).length, 2);
  assert.equal((configured.output.match(/deny all;/g) || []).length, 2);
  assert.equal((configured.output.match(/proxy_set_header X-Real-IP \$remote_addr;/g) || []).length, 2);
  assert.equal((configured.output.match(/add_header X-Private "preserved" always;/g) || []).length, 2);
  assert.equal((configured.output.match(new RegExp(`include ${tlsPath};`, 'g')) || []).length, 1);
  const second = configureUploads(configured.output, options());
  assert.equal((second.output.match(/location = \/api\/admin\/media\/upload/g) || []).length, 1);
  assert.equal((second.output.match(/client_max_body_size 260m;/g) || []).length, 1);
});

test('only real direct server_name declarations select the virtual host', () => {
  for (const decoy of [
    `set $note "server_name ${host};";`,
    `add_header X-Note "server_name ${host};";`,
    `location /other/ { set $note "server_name ${host};"; }`,
  ]) {
    const unrelated = `server { ${decoy} server_name unrelated.example; ${api} }`;
    assert.deepEqual(configureUploads(unrelated), { output: unrelated, count: 0 });
    const combined = configureUploads(unrelated + '\n' + source, options());
    assert.equal(combined.count, 1);
    assert.ok(combined.output.startsWith(unrelated + '\n'));
  }
  assert.equal(configureUploads(source.replace(`server_name ${host};`, `server_name "${host}";`), options()).count, 1);
  assert.equal(configureUploads(source.replace(`server_name ${host};`, `server_name other.example ${host};`), options()).count, 1);
});

test('the include filename alone is never trusted: active current content is required', () => {
  assert.throws(() => configureUploads(source), /inspected|manual/i);
  assert.throws(() => configureUploads(source, options('allow all;')), /Unapproved TLS/);
  const withExistingExact = configureUploads(source, options()).output;
  assert.throws(() => configureUploads(withExistingExact, options('auth_basic off;')), /Unapproved TLS/);
  assert.throws(() => configureUploads(source, options('')), /Empty TLS/);
});

test('only a literal exact server-level path is supported; other includes still require review', () => {
  for (const include of ['/etc/nginx/options-ssl-nginx.conf', '/etc/letsencrypt/*.conf', '$tls_settings', '${tls_settings}', '/etc/letsencrypt/../letsencrypt/options-ssl-nginx.conf', '/etc/letsencrypt/options-ssl-nginx.conf other.conf']) {
    assert.throws(() => configureUploads(source.replace(`include ${tlsPath};`, `include ${include};`), options()), /include|TLS|manual/i, include);
  }
  assert.doesNotThrow(() => configureUploads(source.replace(`include ${tlsPath};`, `include "${tlsPath}";`), options()));
  assert.throws(() => configureUploads(source.replace(`include ${tlsPath};`, `include ${tlsPath}; include /etc/nginx/acl.conf;`), options()), /include|manual/i);
  assert.throws(() => configureUploads(source.replace('auth_basic "Private # admin";', `include ${tlsPath};`), options()), /server-level/i);
  assert.throws(() => configureUploads(source.replace(`include ${tlsPath};`, `"include" ${tlsPath};`), options()), /syntax|manual/i);
});

test('TLS contents cannot hide routing, auth, nested include, arbitrary SSL commands or certificate reads', () => {
  for (const unsafe of [
    'location /api/ { allow all; }', 'auth_basic off;', 'auth_request off;', 'allow all;', 'deny all;',
    'proxy_pass http://127.0.0.1:3000;', 'proxy_set_header Host $host;', 'add_header X-Private off;',
    'include /etc/nginx/acl.conf;', `include ${tlsPath};`, 'return 301 https://elsewhere.example;',
    'ssl_conf_command Options UnsafeLegacyRenegotiation;', 'ssl_certificate /tmp/cert;',
    'ssl_certificate_key /tmp/key;', 'ssl_dhparam /tmp/dh;', 'ssl_session_ticket_key /tmp/key;',
    'ssl_verify_client off;', 'ssl_key_log /tmp/keys;',
  ]) assert.throws(() => configureUploads(source, options(tls + '\n' + unsafe)), /TLS|manual/i, unsafe);
});

test('strict TLS tokenizer rejects malformed, unterminated, dynamic and disguised statements', () => {
  for (const unsafe of [
    'ssl_session_tickets off', 'ssl_session_tickets "off;', "ssl_session_tickets 'off;",
    'ssl_session_tickets off;;', 'ssl_session_tickets off; garbage', 'ssl_session_tickets off on;',
    'ssl_session_tickets off; ssl_session_tickets on;', 'ssl_session_timeout ${time};',
    'ssl_ciphers "DEFAULT; allow all";', 'ssl_ciphers "HIGH"junk;', 'ssl_ciphers "HIGH\\\n:!aNULL";',
    'ssl_ciphers "HIGH{$name}";', 'ssl_session_tickets o\\ff;', 'ssl_session_tickets of\x00f;',
    'ssl_session_cache shared:a:1m shared:b:2m;', 'ssl_protocols TLSv1.2 TLSv1.2;',
    'ssl_session_tickets off; } server {', 'ssl_ciphers "DEFAULT#x";',
  ]) assert.throws(() => validateTlsInclude(unsafe), /TLS|manual/i, unsafe);
  assert.doesNotThrow(() => validateTlsInclude(`\n# include unsafe.conf; {\n${tls}\n# End 🔒\n`));
  assert.doesNotThrow(() => validateTlsInclude('ssl_session_cache builtin:1000 shared:SSL:10m; ssl_session_timeout 10m; ssl_ecdh_curve auto; ssl_buffer_size 16k;'));
});

test('inspected TLS does not disable regex or nested API routing refusal', () => {
  assert.throws(() => configureUploads(source.replace('location / {', 'location ~ ^/ { deny all; } location / {'), options()), /regex/);
  assert.throws(() => configureUploads(source.replace('proxy_pass http', 'location /api/admin/ { deny all; } proxy_pass http'), options()), /Nested/);
  for (const header of ['location "/api/admin/"', "location '/api/admin/'", '"location" /api/admin/', 'location /api\\/admin/', 'location "~" "^/api"']) {
    assert.throws(() => configureUploads(source.replace('location / {', `${header} { deny all; } location / {`), options()), /routing|syntax|manual/i);
  }
});

function runtime({ contents = source, tlsContents = tls, includeActive = true, tlsRealPath = tlsPath, changeTlsAfterRead = false, failFinalTest = false } = {}) {
  const file = '/etc/nginx/sites-available/outdoor-fit';
  const enabled = '/etc/nginx/sites-enabled/outdoor-fit';
  const root = '/etc/nginx/nginx.conf';
  const files = new Map([[file, contents], [root, 'events {} http { include /etc/nginx/sites-enabled/*; }'], [tlsRealPath, tlsContents]]);
  const readCounts = new Map(); const writes = []; const commands = []; const logs = [];
  const logicalPaths = [root, enabled, ...(includeActive ? [tlsPath] : [])];
  const deps = {
    fileSystem: {
      realpathSync: (name) => name === enabled ? file : name === tlsPath ? tlsRealPath : name,
      statSync: () => ({ isFile: () => true }),
      readFileSync: (name) => {
        readCounts.set(name, (readCounts.get(name) || 0) + 1);
        if (changeTlsAfterRead && name === tlsPath && readCounts.get(name) > 1) return 'allow all;';
        if (!files.has(name)) throw new Error('Unexpected file read: ' + name);
        return files.get(name);
      },
      mkdirSync: (...args) => writes.push(['mkdir', ...args]),
      writeFileSync: (name, data, flags) => { writes.push(['write', name, data, flags]); files.set(name, data); },
      copyFileSync: (...args) => writes.push(['copy', ...args]),
    },
    run: (command, args) => {
      commands.push([command, args]);
      if (args[0] === '-t' && failFinalTest) throw new Error('nginx configuration invalid');
      if (args[0] === '-T') return logicalPaths.map((name) => `# configuration file ${name}:\n${files.get(name === enabled ? file : name === tlsPath ? tlsRealPath : name)}\n`).join('\n');
      return '';
    },
    log: (message) => logs.push(message),
  };
  return { deps, files, file, writes, commands, logs, readCounts };
}

test('--check with or without a backup argument reads enabled sources and performs zero config/backup writes', () => {
  for (const args of [['--check'], ['--check', '/home/dukaiyu2004/outdoor-fit-backups/qa']]) {
    const mocked = runtime();
    assert.deepEqual(main(args, mocked.deps), { count: 1, checking: true });
    assert.equal(mocked.writes.length, 0);
    assert.deepEqual(mocked.commands, [['nginx', ['-T']]]);
    assert.ok(mocked.readCounts.get(tlsPath) >= 2);
    assert.match(mocked.logs[0], /Read-only preflight passed/);
    assert.equal(mocked.files.get(mocked.file), source);
    assert.equal(mocked.files.get(tlsPath), tls);
  }
});

test('runtime preflight refuses inactive, changed, redirected or unsafe TLS file contents before writing', () => {
  for (const setup of [
    { includeActive: false }, { tlsContents: tls + '\nauth_basic off;' },
    { tlsRealPath: '/etc/letsencrypt/other.conf' }, { changeTlsAfterRead: true },
  ]) {
    const mocked = runtime(setup);
    assert.throws(() => main(['--check'], mocked.deps), /TLS|include|changed/i);
    assert.equal(mocked.writes.length, 0);
  }
});

test('deployment backs up only the site config and leaves TLS files/certificates untouched', () => {
  const mocked = runtime();
  main(['/home/dukaiyu2004/outdoor-fit-backups/qa'], mocked.deps);
  assert.match(mocked.files.get(mocked.file), /location = \/api\/admin\/media\/upload/);
  assert.equal(mocked.files.get(tlsPath), tls);
  assert.equal(mocked.writes.filter((entry) => String(entry[1]).startsWith('/etc/letsencrypt/')).length, 0);
  const manifestWrite = mocked.writes.find((entry) => String(entry[1]).endsWith('/nginx-manifest.json'));
  assert.equal(JSON.parse(manifestWrite[2]).length, 1);
  assert.equal(JSON.parse(manifestWrite[2])[0].file, mocked.file);
  assert.deepEqual(mocked.commands, [['nginx', ['-T']], ['nginx', ['-t']]]);
});

test('final nginx validation failure restores original site bytes, not the TLS include', () => {
  const mocked = runtime({ failFinalTest: true });
  assert.throws(() => main(['/home/dukaiyu2004/outdoor-fit-backups/qa'], mocked.deps), /original configuration restored/);
  assert.equal(mocked.files.get(mocked.file), source);
  assert.equal(mocked.files.get(tlsPath), tls);
  assert.equal(mocked.writes.filter((entry) => String(entry[1]).startsWith('/etc/letsencrypt/')).length, 0);
});

test('invalid CLI arguments and missing API routes fail without any file write', () => {
  for (const args of [[], ['--restore'], ['--unknown'], ['--check', '/tmp'], ['--check', '/home/dukaiyu2004/outdoor-fit-backups/../bad'], ['--check', '/home/dukaiyu2004/outdoor-fit-backups/qa', 'extra']]) {
    const mocked = runtime();
    assert.throws(() => main(args, mocked.deps), /backup|Usage/i);
    assert.equal(mocked.writes.length, 0);
  }
  const mocked = runtime({ contents: redirect });
  assert.throws(() => main(['--check'], mocked.deps), /No matching API/);
  assert.equal(mocked.writes.length, 0);
});
