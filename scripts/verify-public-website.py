"""Check the standalone site's links and assets without contacting production."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'website'

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links, self.assets, self.portraits, self.h1 = [], [], [], [], 0
    def handle_starttag(self, tag, attributes):
        a = dict(attributes)
        if a.get('id'): self.ids.append(a['id'])
        if tag == 'h1': self.h1 += 1
        if tag == 'a':
            self.links.append(a.get('href', ''))
            if 'avatar' in a.get('class', '').split(): self.portraits.append(a)
        if tag in ('img', 'script'): self.assets.append(a.get('src', ''))
        if tag == 'link' and a.get('rel') in ('stylesheet', 'icon'): self.assets.append(a.get('href', ''))

pages = {}
errors = []
for path in SITE.rglob('*.html'):
    page = Page(); page.feed(path.read_text(encoding='utf-8')); pages[path] = page
    if page.h1 != 1: errors.append(f'{path.name}: expected one h1')
    if len(set(page.ids)) != len(page.ids): errors.append(f'{path}: duplicate id')

def resolve(path, raw):
    value = urlsplit(raw)
    target = (SITE / unquote(value.path).lstrip('/')) if value.path.startswith('/') else (path.parent / unquote(value.path))
    if not value.path: target = path
    if target.is_dir(): target = target / 'index.html'
    return target, unquote(value.fragment)

for path, page in pages.items():
    for raw in page.links + page.assets:
        if not raw or raw == '#': errors.append(f'{path}: empty target'); continue
        if urlsplit(raw).scheme or raw.startswith('//'):
            if raw in page.assets: errors.append(f'{path}: remote runtime asset {raw}')
            continue
        target, fragment = resolve(path, raw)
        if not target.is_file(): errors.append(f'{path}: missing {raw}')
        elif fragment and target in pages and fragment not in pages[target].ids:
            errors.append(f'{path}: missing anchor {raw}')
for css in SITE.rglob('*.css'):
    for raw in re.findall(r'url\([\'"]?([^\)\'\"]+)', css.read_text(encoding='utf-8')):
        if not (css.parent / raw).is_file(): errors.append(f'{css}: missing font {raw}')
home = pages[SITE / 'index.html']
if len(home.portraits) != 13: errors.append('Expected 13 linked portraits')
for a in home.portraits:
    if not a.get('href', '').startswith('https://') or not a.get('aria-label'):
        errors.append('Portrait lacks secure official URL or accessible name')
report = {'status': 'pass' if not errors else 'fail', 'htmlPages': len(pages), 'linkedPortraits': len(home.portraits),
          'files': len([p for p in SITE.rglob('*') if p.is_file()]), 'bytes': sum(p.stat().st_size for p in SITE.rglob('*') if p.is_file()), 'errors': errors}
out=ROOT/'output/public-website'; out.mkdir(parents=True,exist_ok=True)
(out/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
