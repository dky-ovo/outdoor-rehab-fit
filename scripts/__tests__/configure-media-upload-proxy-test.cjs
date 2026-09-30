const test = require('node:test');
const assert = require('node:assert/strict');
const { configureUploads } = require('../configure-media-upload-proxy.cjs');
const host = 'outdoor-fit.35-241-75-217.sslip.io';
const fixture = `server { listen 443 ssl; server_name ${host}; location /api/ { proxy_pass http://127.0.0.1:3000; auth_basic "Private admin"; proxy_set_header Host $host; } location / { try_files $uri /index.html; } }`;

test('only the exact upload endpoint receives the large body allowance, preserving access/header rules', () => {
  const { output, count } = configureUploads(fixture);
  assert.equal(count, 1); assert.match(output, /location = \/api\/admin\/media\/upload/);
  assert.equal(output.match(/auth_basic "Private admin"/g).length, 2);
  assert.equal(output.match(/client_max_body_size 260m/g).length, 1);
  assert.ok(output.includes('location /api/ { proxy_pass http://127.0.0.1:3000; auth_basic "Private admin"; proxy_set_header Host $host; }'));
});
test('repeat deployment is idempotent and other hosts and redirect blocks are untouched', () => {
  const first = configureUploads(fixture).output;
  const second = configureUploads(first).output;
  assert.equal(second.match(/location = \/api\/admin\/media\/upload/g).length, 1);
  assert.equal(second.match(/client_max_body_size/g).length, 1);
  assert.equal(configureUploads(fixture.replace(host, 'unrelated.example')).count, 0);
  assert.equal(configureUploads(`server { server_name ${host}; return 301 https://$host$request_uri; }`).count, 0);
});
test('more-specific admin ACL wins over the generic API prefix', () => {
  const source = fixture.replace('location / {', 'location /api/admin/ { proxy_pass http://127.0.0.1:3000; allow 10.0.0.0/8; deny all; } location / {');
  const output = configureUploads(source).output;
  assert.match(output.slice(output.indexOf('location =')), /deny all/);
});
test('unknown URI rewriting, regex API routing and nested locations stop instead of widening access', () => {
  assert.throws(() => configureUploads(fixture.replace(':3000;', ':3000/;')), /upstream/);
  assert.throws(() => configureUploads(fixture.replace('location / {', 'location ~ ^/api/admin { deny all; } location / {')), /regex/);
  assert.throws(() => configureUploads(fixture.replace('location / {', 'location ~ ^/ { deny all; } location / {')), /regex/);
  assert.throws(() => configureUploads(fixture.replace('proxy_pass', 'location /api/admin/ { deny all; } proxy_pass')), /Nested/);
});
