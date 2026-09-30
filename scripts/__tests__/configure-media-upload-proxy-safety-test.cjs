const test = require('node:test');
const assert = require('node:assert/strict');
const { configureUploads } = require('../configure-media-upload-proxy.cjs');
const host = 'outdoor-fit.35-241-75-217.sslip.io';

test('proxy configuration handles supplementary Unicode comments without changing source offsets', () => {
  const source = `# 🔒 Access rules\nserver { server_name ${host}; location /api/ { auth_basic "Restricted"; proxy_pass http://127.0.0.1:3000; } }`;
  const { output } = configureUploads(source);
  assert.match(output, /location = \/api\/admin\/media\/upload \{\s*auth_basic "Restricted";/);
  assert.equal((output.match(/auth_basic "Restricted"/g) || []).length, 2);
  assert.equal((output.match(/\{/g) || []).length, (output.match(/\}/g) || []).length);
});

test('tab and newline separated location directives cannot bypass more-specific administrator ACLs', () => {
  for (const separator of ['\t', '\n']) {
    const source = `server { server_name ${host}; location /api/ { proxy_pass http://127.0.0.1:3000; } location${separator}/api/admin/ { proxy_pass http://127.0.0.1:3000; allow 10.0.0.0/8; deny all; } }`;
    const { output } = configureUploads(source);
    assert.match(output.slice(output.indexOf('location = /api/admin/media/upload')), /deny all;/);
  }
});

test('uninspected server-level includes cannot hide ACLs from a new exact upload route', () => {
  const source = `server { server_name ${host}; include /etc/nginx/private-admin-locations.conf; location /api/ { proxy_pass http://127.0.0.1:3000; } }`;
  assert.throws(() => configureUploads(source), /include|manual|review/i);
});
