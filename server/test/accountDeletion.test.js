import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { createIdentityRepository } from '../src/identityRepository.js';
import { hashPassword, signToken, signSmsVerification } from '../src/security.js';

const SECRET = 'isolated-account-deletion-test-secret';
const PHONE = '+85269008880';
const PASSWORD = 'Synthetic-password-1';
async function fixture(run) {
  const database = createDatabase(':memory:'), now = new Date().toISOString(), passwords = await hashPassword(PASSWORD), tokens = {};
  for (const [index, [id, permissions, active]] of [['owner', null, 1], ['editor', ['users.edit', 'users.read'], 1], ['reader', ['users.read'], 1], ['inactive', ['users.edit'], 0], ['other', null, 1]].entries()) {
    database.prepare("INSERT INTO users (id,name,phone,email,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,?,'participant',?,?,?,?)")
      .run(id, 'Synthetic ' + id, id === 'owner' ? PHONE : '+8526900888' + index, id + '@example.test', passwords.salt, passwords.hash, now, now);
    if (permissions) database.prepare("INSERT INTO admin_accounts (user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,?,?,?)")
      .run(id, JSON.stringify(permissions), active, now, now);
    tokens[id] = signToken({ id, profile_role: 'participant' }, SECRET);
  }
  for (const id of ['owner', 'other']) database.prepare("INSERT INTO push_tokens (id,user_id,expo_push_token,platform,created_at,updated_at) VALUES (?,?,?,'android',?,?)").run(id, id, 'ExponentPushToken[synthetic_' + id + ']', now, now);
  database.prepare("INSERT INTO research_events (id,participant_id,event_name,event_time,app_version,metadata_json) VALUES ('old-event','owner','screen.view',?,'test','{}')").run(now);
  const identityRepository = { ...createIdentityRepository(database) };
  const server = createApp({ database, jwtSecret: SECRET, identityRepository }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (route, { actor, token = actor ? tokens[actor] : null, method = 'GET', body } = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const remove = (actor = 'editor', id = 'owner') => request('/api/admin/users/' + id, { actor, method: 'DELETE' });
  try { await run({ database, identityRepository, request, remove, tokens, base }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}
function assertDeleted(response) {
  assert.equal(response.status, 401); assert.deepEqual(response.data, { error: 'accountDeleted' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
test('admin soft deletion revokes every new authenticated API request without returning personal data', async () => fixture(async ({ database, request, remove }) => {
  assert.equal((await request('/api/users/me', { actor: 'owner' })).status, 200);
  assert.equal((await remove()).status, 200);
  for (const [route, method, body] of [
    ['/api/users/me', 'GET'], ['/api/users/me', 'PATCH', { name: 'must not update' }],
    ['/api/sessions', 'GET'], ['/api/sessions', 'POST', {}], ['/api/sessions/not-real', 'DELETE'],
    ['/api/learning/progress', 'POST', { records: [] }], ['/api/research/events', 'POST', { eventName: 'forbidden' }],
    ['/api/assistant/chat', 'POST', { message: 'private input must not reach AI' }],
    ['/api/push-tokens', 'POST', { token: 'ExponentPushToken[blocked]' }],
    ['/api/feedback', 'POST', {}], ['/api/volunteer/participants', 'GET'],
    ['/api/admin/users', 'GET'], ['/api/app-texts', 'GET'], ['/api/health', 'GET'],
  ]) assertDeleted(await request(route, { actor: 'owner', method, body }));
  assert.equal(database.prepare("SELECT COUNT(*) n FROM push_tokens WHERE user_id='owner'").get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM push_tokens WHERE user_id='other'").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM research_events WHERE participant_id='owner'").get().n, 1);
  assert.ok(database.prepare("SELECT deleted_at FROM users WHERE id='owner'").get().deleted_at);
  assert.equal((await request('/api/users/me', { actor: 'other' })).status, 200);
  assert.equal((await request('/api/app-texts')).status, 200);
  assert.equal((await request('/api/health')).status, 200);
}));
test('only a valid unexpired user signature receives deletion status; login cannot enumerate it', async () => fixture(async ({ request, remove, tokens }) => {
  await remove();
  for (const token of [null, 'malformed', signToken({ id: 'owner' }, 'wrong-secret'), signToken({ id: 'owner' }, SECRET, Date.now() - 8 * 86400000), signToken({ id: 'missing' }, SECRET), signSmsVerification('owner', SECRET)]) {
    const result = await request('/api/users/me', { token });
    assert.equal(result.status, 401); assert.deepEqual(result.data, { error: 'unauthorized' });
  }
  for (const identifier of [PHONE, 'owner@example.test', '+85269997777']) {
    for (const token of [null, tokens.owner]) {
      const result = await request('/api/auth/login', { token, method: 'POST', body: { identifier, password: PASSWORD } });
      assert.equal(result.status, 401); assert.deepEqual(result.data, { error: 'invalidCredentials' });
    }
  }
}));
test('a new registration on the same phone gets a new ID and cannot reactivate a deleted token', async () => fixture(async ({ request, remove, tokens, database }) => {
  await remove();
  const invitation = await request('/api/admin/registration-codes', { actor: 'editor', method: 'POST', body: { name: 'New synthetic registration', phone: PHONE, profileRole: 'participant' } });
  assert.equal(invitation.status, 201);
  const registered = await request('/api/auth/register', { method: 'POST', body: { name: 'New person', phone: PHONE, password: PASSWORD, confirmPassword: PASSWORD, registrationCode: invitation.data.code } });
  assert.equal(registered.status, 201); assert.notEqual(registered.data.user.id, 'owner');
  assert.equal((await request('/api/users/me', { token: registered.data.token })).status, 200);
  assertDeleted(await request('/api/users/me', { token: tokens.owner }));
  assert.ok(database.prepare("SELECT deleted_at FROM users WHERE id='owner'").get().deleted_at);
  assert.equal((await request('/api/admin/users/owner', { actor: 'editor', method: 'PATCH', body: { name: 'Restore attempt' } })).status, 404);
}));
test('deletion permissions, self-protection and administrator-removal guard remain enforced', async () => fixture(async ({ remove, request }) => {
  assert.equal((await remove(null)).status, 401);
  assert.equal((await remove('owner')).status, 403);
  assert.equal((await remove('reader')).status, 403);
  assert.equal((await remove('inactive')).status, 403);
  assert.equal((await remove('editor', 'editor')).data.error, 'cannotDeleteSelf');
  assert.equal((await remove('editor', 'reader')).data.error, 'adminAccountMustBeRemovedFirst');
  assert.equal((await request('/api/users/me', { actor: 'owner' })).status, 200);
}));
test('deletion and push-token cleanup roll back if the audit transaction fails', async t => fixture(async ({ database, remove, request }) => {
  t.mock.method(console, 'error', () => {});
  database.exec("CREATE TRIGGER deny_delete_log BEFORE INSERT ON system_logs WHEN NEW.action='user.delete' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  assert.equal((await remove()).status, 500);
  assert.equal(database.prepare("SELECT deleted_at FROM users WHERE id='owner'").get().deleted_at, null);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM push_tokens WHERE user_id='owner'").get().n, 1);
  assert.equal((await request('/api/users/me', { actor: 'owner' })).status, 200);
  database.exec('DROP TRIGGER deny_delete_log');
  assert.equal((await remove()).status, 200); assertDeleted(await request('/api/users/me', { actor: 'owner' }));
}));
test('deletion status survives a serialized database reopening and repeated deletion cannot revive it', async () => fixture(async ({ database, remove, tokens }) => {
  assert.equal((await remove()).status, 200); assert.equal((await remove()).status, 404);
  const restored = new Database(database.serialize());
  const server = createApp({ database: restored, jwtSecret: SECRET }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/users/me', { headers: { authorization: 'Bearer ' + tokens.owner } });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'accountDeleted' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); restored.close(); }
}));
function afterRead(t, database, matches, action) {
  const original = database.prepare.bind(database);
  let used = false;
  t.mock.method(database, 'prepare', sql => {
    const statement = original(sql);
    if (!matches(sql)) return statement;
    return new Proxy(statement, { get(target, prop) {
      if (prop === 'get') return (...args) => { const row = target.get(...args); if (!used && row?.id === 'owner') { used = true; queueMicrotask(action); } return row; };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
}
function afterIdentityRead(t, identity, method, action) {
  const original = identity[method];
  let used = false;
  t.mock.method(identity, method, (...args) => {
    const row = original(...args);
    if (!used && row?.id === 'owner') { used = true; queueMicrotask(action); }
    return row;
  });
}
test('deletion during async password verification never issues a stale login token', async t => fixture(async ({ database, identityRepository, request }) => {
  afterIdentityRead(t, identityRepository, 'findActiveUserByIdentifier', () => {
    database.prepare("UPDATE users SET deleted_at=? WHERE id='owner'").run(new Date().toISOString());
  });
  const result = await request('/api/auth/login', { method: 'POST', body: { identifier: PHONE, password: PASSWORD } });
  assert.equal(result.status, 401); assert.deepEqual(result.data, { error: 'invalidCredentials' });
}));
test('deletion during async profile password update cannot overwrite the deleted profile', async t => fixture(async ({ database, identityRepository, request }) => {
  afterIdentityRead(t, identityRepository, 'getUserById', () => {
    database.prepare("UPDATE users SET name='Removed synthetic user',deleted_at=? WHERE id='owner'").run(new Date().toISOString());
  });
  const result = await request('/api/users/me', { actor: 'owner', method: 'PATCH', body: { name: 'Should not write', currentPassword: PASSWORD, newPassword: 'Updated-password-1' } });
  assertDeleted(result);
  assert.equal(database.prepare("SELECT name FROM users WHERE id='owner'").get().name, 'Removed synthetic user');
  assert.equal(database.prepare("SELECT COUNT(*) n FROM system_logs WHERE action='user.profile.update'").get().n, 0);
}));
test('permission revoked while deletion hashes a random password prevents the delete', async t => fixture(async ({ database, remove, request }) => {
  afterRead(t, database, sql => sql === 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', () => {
    database.prepare("UPDATE admin_accounts SET permissions_json='[]' WHERE user_id='editor'").run();
  });
  const result = await remove();
  assert.equal(result.status, 403); assert.deepEqual(result.data, { error: 'permissionDenied' });
  assert.equal((await request('/api/users/me', { actor: 'owner' })).status, 200);
}));
