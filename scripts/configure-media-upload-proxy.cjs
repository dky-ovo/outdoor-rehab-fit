// Run by the server installer. Only the requested public host's upload route is
// changed; copy its existing API proxy rules so ACL/header rules are preserved.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const HOST = 'outdoor-fit.35-241-75-217.sslip.io';
const UPLOAD = '/api/admin/media/upload';
const TLS_INCLUDE = '/etc/letsencrypt/options-ssl-nginx.conf';

// This is a deliberately small grammar, not a general nginx config parser.
// The included file is accepted only if its *current contents* consist solely
// of these TLS value directives. No file-loading, routing, auth or includes.
// References: nginx.org/en/docs/http/ngx_http_ssl_module.html and Certbot's
// v2.9.0 certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf template.
function flatDirectives(source) {
  const statements = []; let words = []; let word = ''; let started = false;
  let quote = ''; let closedQuote = false; let comment = false;
  const finishWord = () => { if (started) words.push(word); word = ''; started = false; closedQuote = false; };
  for (const character of source) {
    if (comment) { if (character === '\n') comment = false; else continue; }
    if (character === '\\' || character === '$' || character === '{' || character === '}' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(character)) throw new Error('Unsafe or unsupported TLS include syntax');
    if (quote) {
      if (character === quote) { quote = ''; closedQuote = true; }
      else word += character;
      continue;
    }
    if (character === '#') { finishWord(); comment = true; continue; }
    if (/[ \t\r\n]/.test(character)) { finishWord(); continue; }
    if (character === ';') {
      finishWord(); if (!words.length) throw new Error('Empty TLS include directive');
      statements.push(words); words = []; continue;
    }
    if (closedQuote) throw new Error('Concatenated TLS include token requires manual review');
    if (character === '"' || character === "'") {
      if (started) throw new Error('Invalid quoted TLS include token');
      quote = character; started = true; continue;
    }
    word += character; started = true;
  }
  if (quote || started || words.length) throw new Error('Unterminated TLS include directive');
  return statements;
}

function validateTlsInclude(source) {
  if (typeof source !== 'string' || source.length > 65536) throw new Error('Invalid TLS include contents');
  const seen = new Set(); const statements = flatDirectives(source);
  if (!statements.length) throw new Error('Empty TLS include requires manual review');
  const one = (values, pattern) => values.length === 1 && pattern.test(values[0]);
  for (const [name, ...values] of statements) {
    if (seen.has(name)) throw new Error(`Duplicate TLS include directive: ${name}`);
    seen.add(name);
    let valid = false;
    if (name === 'ssl_session_cache') {
      valid = one(values, /^(?:off|none)$/) || (values.length >= 1 && values.length <= 2 &&
        values.every((value) => /^(?:builtin(?::[1-9][0-9]*)?|shared:[A-Za-z0-9_]+:[1-9][0-9]*[kKmMgG]?)$/.test(value)) &&
        new Set(values.map((value) => value.split(':')[0])).size === values.length);
    } else if (name === 'ssl_session_timeout') valid = one(values, /^[0-9]+(?:ms|s|m|h|d|w)?$/);
    else if (name === 'ssl_session_tickets' || name === 'ssl_prefer_server_ciphers') valid = one(values, /^(?:on|off)$/);
    else if (name === 'ssl_protocols') valid = values.length > 0 && values.every((value) => /^TLSv1(?:\.[123])?$/.test(value)) && new Set(values).size === values.length;
    else if (name === 'ssl_ciphers') valid = one(values, /^[A-Za-z0-9_:+!@=.,-]+$/);
    else if (name === 'ssl_ecdh_curve') valid = one(values, /^[A-Za-z0-9_:-]+$/);
    else if (name === 'ssl_buffer_size') valid = one(values, /^[1-9][0-9]*[kKmMgG]?$/);
    if (!valid) throw new Error(`Unapproved TLS include directive or value: ${name}`);
  }
  return true;
}

function maskComments(source) {
  let quote = ''; let comment = false; let escaped = false;
  return [...source].map((character) => {
    if (comment) { if (character === '\n') comment = false; return character === '\n' ? '\n' : ' '.repeat(character.length); }
    if (escaped) { escaped = false; return character; }
    if (character === '\\') { escaped = true; return character; }
    if (quote) { if (character === quote) quote = ''; return character; }
    if (character === '"' || character === "'") quote = character;
    if (character === '#') { comment = true; return ' '; }
    return character;
  }).join('');
}

function blocks(source) {
  const masked = maskComments(source); const result = []; const stack = []; const directives = [];
  let boundary = 0; let quote = ''; let escaped = false;
  for (let i = 0; i < masked.length; i++) {
    const character = masked[i];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    // Nginx ${variables} are not nested configuration blocks.
    if (character === '{' && masked[i - 1] === '$') { const end = masked.indexOf('}', i); if (end < 0) throw new Error('Invalid nginx variable'); i = end; continue; }
    if (character === '{') {
      const item = { start: boundary, open: i, header: masked.slice(boundary, i).trim(), parent: stack.at(-1) };
      stack.push(item); result.push(item); boundary = i + 1;
    } else if (character === '}') {
      const item = stack.pop(); if (!item) throw new Error('Unbalanced nginx config'); item.end = i; boundary = i + 1;
    } else if (character === ';') {
      directives.push({ text: masked.slice(boundary, i).trim(), parent: stack.at(-1) });
      boundary = i + 1;
    }
  }
  if (stack.length || quote || escaped) throw new Error('Unbalanced nginx config');
  return { masked, result, directives };
}

function configureUploads(source, { activeFiles = new Map() } = {}) {
  const { masked, result, directives } = blocks(source); const edits = [];
  for (const server of result.filter((item) => item.header === 'server')) {
    // Read real, direct server_name statements only. A quoted value in a set,
    // header or nested location must never impersonate the target virtual host.
    const hostNames = directives.filter((item) => item.parent === server && /^server_name(?:\s|$)/.test(item.text))
      .flatMap((item) => flatDirectives(item.text + ';')[0].slice(1));
    if (!hostNames.includes(HOST)) continue;
    const children = result.filter((item) => item.parent === server);
    // Quoted/escaped location names and paths can encode a more-specific ACL.
    // Never silently skip one and clone a weaker generic /api/ location.
    if (children.some((item) => !/^(?:location\s|if\s*\()/.test(item.header))) throw new Error('Unsupported nginx block syntax requires manual review');
    const locations = children.filter((item) => /^location\s/.test(item.header));
    if (locations.some((item) => /['"\\$]/.test(item.header))) throw new Error('Quoted, escaped or dynamic nginx routing requires manual review');
    // An exact route would win over regex ACLs, even a generic ^/ rule. Nginx
    // PCRE semantics cannot safely be inferred with a JavaScript regex engine.
    if (locations.some((item) => /^location\s+~/.test(item.header))) throw new Error('Nginx regex routing requires manual review');
    for (const directive of directives) {
      let owner = directive.parent;
      while (owner && owner !== server) owner = owner.parent;
      if (owner !== server) continue;
      // Quoted/escaped directive names may be valid nginx, but are deliberately
      // not supported by this conservative automatic rewrite.
      const name = directive.text.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)/)?.[1];
      if (!name) throw new Error('Unsupported nginx directive syntax requires manual review');
      if (name !== 'include') continue;
      const parsed = flatDirectives(directive.text + ';');
      const included = parsed[0]?.[1];
      if (directive.parent !== server || parsed.length !== 1 || parsed[0].length !== 2 || included !== TLS_INCLUDE || !activeFiles.has(included)) {
        throw new Error('Included nginx routing requires manual review; only an active, inspected server-level TLS include is supported');
      }
      validateTlsInclude(activeFiles.get(included));
    }
    let selected = locations.find((item) => /^location\s+=\s+\/api\/admin\/media\/upload$/.test(item.header));
    if (!selected) {
      selected = locations.map((item) => ({ item, prefix: item.header.match(/^location\s+(?:\^~\s+)?(\/[^\s]*)$/)?.[1] }))
        .filter(({ prefix }) => prefix && UPLOAD.startsWith(prefix) && prefix.startsWith('/api'))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.item;
    }
    if (!selected) continue; // An HTTP-to-HTTPS redirect block has no API proxy.
    if (result.some((item) => item.parent === selected)) throw new Error('Nested API routing requires manual review');
    const originalBody = source.slice(selected.open + 1, selected.end);
    const originalMasked = masked.slice(selected.open + 1, selected.end);
    if (!/\bproxy_pass\s+http:\/\/(?:127\.0\.0\.1|localhost):3000\s*;/.test(originalMasked)) throw new Error('Unexpected API upstream; refusing automatic rewrite');
    // Remove only these four route-level settings; retain authentication, access
    // controls, request headers, logging, buffering and other inherited behavior.
    const setting = /\b(?:client_max_body_size|proxy_request_buffering|proxy_read_timeout|proxy_send_timeout)\s+[^;]+;/g;
    const removals = [...originalMasked.matchAll(setting)].map((match) => ({ at: match.index, length: match[0].length }));
    let preserved = originalBody;
    for (const removal of removals.reverse()) preserved = preserved.slice(0, removal.at) + preserved.slice(removal.at + removal.length);
    const replacement = `\n    location = ${UPLOAD} {${preserved.trimEnd()}\n        client_max_body_size 260m;\n        proxy_request_buffering off;\n        proxy_read_timeout 300s;\n        proxy_send_timeout 300s;\n    }\n`;
    if (/^location\s+=\s+\/api\/admin\/media\/upload$/.test(selected.header)) edits.push({ start: selected.start, end: selected.end + 1, replacement });
    else edits.push({ start: server.end, end: server.end, replacement });
  }
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return { output, count: edits.length };
}

function main(args = process.argv.slice(2), { fileSystem = fs, run = execFileSync, log = console.log } = {}) {
  const restoring = args[0] === '--restore'; const checking = args[0] === '--check';
  const suppliedBackup = args[restoring || checking ? 1 : 0];
  if (args.length > (restoring || checking ? 2 : 1) || (args[0]?.startsWith('--') && !restoring && !checking)) throw new Error('Usage: configure-media-upload-proxy.cjs [--check | --restore] [BACKUPDIR]');
  const backupDir = suppliedBackup ? path.posix.resolve(suppliedBackup) : null;
  if ((!checking || suppliedBackup) && (!backupDir || !backupDir.startsWith('/home/dukaiyu2004/outdoor-fit-backups/'))) throw new Error('A validated deployment backup directory is required');
  if (restoring) {
    const manifest = JSON.parse(fileSystem.readFileSync(path.posix.join(backupDir, 'nginx-manifest.json'), 'utf8'));
    for (const item of manifest) {
      if (!item.file.startsWith('/etc/nginx/') || fileSystem.realpathSync(item.file) !== item.file ||
        !item.backup.startsWith(path.posix.join(backupDir, 'nginx') + '/') || fileSystem.realpathSync(item.backup) !== item.backup) throw new Error('Invalid restoration path');
    }
    for (const item of manifest) fileSystem.copyFileSync(item.backup, item.file);
    run('nginx', ['-t'], { stdio: ['ignore', 'pipe', 'pipe'] });
    log('Original nginx configuration restored.'); return;
  }
  const dump = run('nginx', ['-T'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  const activeFiles = new Map(); const snapshots = [];
  for (const logical of new Set([...dump.matchAll(/^# configuration file ([^\r\n]+):\r?$/gm)].map((match) => match[1]))) {
    const file = fileSystem.realpathSync(logical);
    if (logical === TLS_INCLUDE && file !== TLS_INCLUDE) throw new Error('TLS include must resolve to its exact active path; manual review required');
    if (!file.startsWith('/etc/nginx/') && logical !== TLS_INCLUDE) continue;
    if (!fileSystem.statSync(file).isFile()) throw new Error('Active nginx configuration is not a regular file');
    const source = fileSystem.readFileSync(file, 'utf8');
    activeFiles.set(logical, source); activeFiles.set(file, source);
    snapshots.push({ logical, file, source });
  }
  const pending = [];
  for (const [file, source] of new Map(snapshots.map(({ file, source }) => [file, source]))) {
    if (!file.startsWith('/etc/nginx/')) continue;
    const configured = configureUploads(source, { activeFiles });
    if (configured.count) pending.push({ file, source, output: configured.output });
  }
  if (!pending.length) throw new Error('No matching API proxy found; configure the upload route manually before deploying');
  // Detect changes after inspection, including a replaced symlink/TLS file.
  // Never back up or write certificate / TLS include files.
  for (const { logical, file, source } of snapshots) {
    if (fileSystem.realpathSync(logical) !== file || fileSystem.readFileSync(file, 'utf8') !== source) throw new Error('Active nginx configuration changed during inspection; retry after manual review');
  }
  if (checking) {
    log(`Read-only preflight passed: ${pending.length} nginx configuration file(s); only exact ${UPLOAD} would receive 260m. No configuration or backup files written.`);
    return { count: pending.length, checking: true };
  }
  fileSystem.mkdirSync(path.posix.join(backupDir, 'nginx'), { recursive: true, mode: 0o700 });
  const manifest = pending.map(({ file, source }) => {
    const backup = path.posix.join(backupDir, 'nginx', crypto.createHash('sha256').update(file).digest('hex') + '.conf');
    fileSystem.writeFileSync(backup, source, { flag: 'wx', mode: 0o600 }); return { file, backup };
  });
  fileSystem.writeFileSync(path.posix.join(backupDir, 'nginx-manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  try {
    for (const { file, output } of pending) fileSystem.writeFileSync(file, output);
    run('nginx', ['-t'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    for (const { file, source } of pending) fileSystem.writeFileSync(file, source);
    throw new Error('Nginx validation failed; original configuration restored', { cause: error });
  }
  log(`Validated media-upload route in ${pending.length} nginx configuration file(s).`);
}

module.exports = { configureUploads, validateTlsInclude, main };
if (require.main === module) main();
