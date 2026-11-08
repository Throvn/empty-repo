#!/usr/bin/env python3
"""file_packager's json index -> compact index {"d": [dirs], "f": [[dir, name, start, end], ...]} (81k entries)"""
import json, sys
src, dst = sys.argv[1:3]
files = json.load(open(src))['files']
dirs, did, out = [], {}, []
for f in files:
    p = f['filename'].lstrip('/')
    d, _, n = p.rpartition('/')
    if d not in did:
        did[d] = len(dirs); dirs.append(d)
    out.append([did[d], n, f['start'], f['end']])
json.dump({'d': dirs, 'f': out}, open(dst, 'w'), separators=(',', ':'))
