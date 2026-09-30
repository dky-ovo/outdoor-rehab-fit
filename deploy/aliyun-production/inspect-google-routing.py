#!/usr/bin/env python3
# Read-only routing summary; never apply changes from this partial inventory alone.
import os, re, subprocess
from urllib.parse import urlsplit

host = 'outdoor-fit.35-241-75-217.sslip.io'
try:
    p = subprocess.run(['nginx', '-T'], capture_output=True, text=True, timeout=15)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('NGINX_CONFIG_READ_FAILED')
if p.returncode:
    raise SystemExit('NGINX_CONFIG_READ_FAILED')
parts = re.split(r'(?m)^# configuration file (/[^\r\n]+):\r?\n', p.stdout)
selected = review = 0
variables = {'$host', '$http_host', '$remote_addr', '$proxy_add_x_forwarded_for',
             '$scheme', '$http_authorization'}
for i in range(1, len(parts), 2):
    path, body = parts[i], parts[i + 1]
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', path):
        raise SystemExit('NGINX_PATH_REQUIRES_LOCAL_REVIEW')
    print('ACTIVE_FILE=' + path)
    clean = '\n'.join(line.split('#', 1)[0] for line in body.splitlines())
    if not re.search(r'\bserver_name\s+[^;]*\b' + re.escape(host) + r'(?=\s|;)', clean):
        continue
    selected += 1
    print('TARGET_FILE=' + path)
    print('TARGET_REALPATH=' + os.path.realpath(path))
    for number, raw in enumerate(body.splitlines(), 1):
        line = raw.split('#', 1)[0].strip()
        name = line.split(None, 1)[0] if line else ''
        label = '{}:{}'.format(path, number)
        if name == 'proxy_pass' and line.endswith(';') and line.count(';') == 1:
            try:
                u = urlsplit(line[len('proxy_pass'):-1].strip())
                if u.scheme not in ('http', 'https') or not re.fullmatch(r'[A-Za-z0-9.-]+', u.hostname or ''):
                    raise ValueError()
                print(label, 'UPSTREAM', u.scheme, u.hostname,
                      u.port or (443 if u.scheme == 'https' else 80))
            except ValueError:
                review += 1
                print(label, 'PROXY_REVIEW')
        elif re.fullmatch(r'proxy_set_header\s+[A-Za-z0-9_-]+\s+[^;]+;', line):
            fields = line[:-1].split(None, 2)
            value = fields[2] if fields[2] in variables else '<redacted>'
            print(label, 'HEADER', fields[1], value)
        elif re.fullmatch(r'location\s+(?:(?:=|\^~)\s+)?/[A-Za-z0-9_./-]*\s*\{', line):
            print(label, line)
        elif re.fullmatch(r'(?:listen|server_name|root|alias|include|try_files|client_max_body_size|proxy_(?:read|send|connect)_timeout|proxy_request_buffering)\s+[A-Za-z0-9_.:/\[\]*$ =-]+;', line):
            print(label, line)
        elif re.search(r'\b(?:location|server_name|listen|root|alias|include|try_files|return|rewrite|if|auth_basic|auth_basic_user_file|allow|deny|proxy_pass|proxy_set_header)\b', line):
            review += 1
            print(label, 'ROUTING_OR_ACCESS_REVIEW_VALUE_OMITTED')
if not selected:
    raise SystemExit('TARGET_SERVER_NOT_FOUND')
print('REVIEW_COUNT=' + str(review))
print('NGINX_ROUTING_READ=COMPLETE')
