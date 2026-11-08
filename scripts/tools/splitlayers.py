#!/usr/bin/env python3
"""splitlayers.py <tree> <tree.layers.json> <outdir>: hard-link the merged tree into one directory per layer (outdir/<layer>/...)"""
import json, os, shutil, sys
tree, lj, out = sys.argv[1:4]
layers = json.load(open(lj))
shutil.rmtree(out, ignore_errors=True)
for rel, layer in layers.items():
    src = os.path.join(tree, rel)
    if not os.path.isfile(src):
        continue
    dst = os.path.join(out, layer, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)
print(' '.join(sorted(set(layers.values()))))
