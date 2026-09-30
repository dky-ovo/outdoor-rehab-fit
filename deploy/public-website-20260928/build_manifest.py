#!/usr/bin/env python3
"""Build the static payload hash manifest; never contact a server."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from install import Failure, safe_relative


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--website', type=Path, default=Path(__file__).parent / 'website')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'website-manifest.json')
    args = parser.parse_args()
    root = args.website
    if not root.is_dir() or root.is_symlink():
        raise Failure('WEBSITE_SOURCE_MISSING')
    entries = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise Failure('WEBSITE_SYMLINK_REJECTED')
        if path.is_dir():
            continue
        relative = path.relative_to(root).as_posix()
        safe_relative(relative)
        if not path.is_file():
            raise Failure('WEBSITE_SPECIAL_FILE_REJECTED')
        data = path.read_bytes()
        entries[relative] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    if 'index.html' not in entries:
        raise Failure('WEBSITE_INDEX_REQUIRED')
    args.output.write_text(json.dumps({'format': 1, 'files': entries}, indent=2) + '\n', encoding='utf-8')
    print('WEBSITE_MANIFEST=READY\nWEBSITE_FILE_COUNT=' + str(len(entries)))


if __name__ == '__main__':
    main()
