#!/usr/bin/env python3
"""mkdist.py <webdir> <layer>...   write <webdir>/dist.json listing the given layers (packed by pack-layer.sh)"""
import json, sys
w, names = sys.argv[1], sys.argv[2:]
json.dump({"name": "texlive-2023 (Ubuntu 24.04 packages)", "format": "pdflatex.fmt",
           "layers": [{"name": n, "index": n + ".json", "data": n + ".data"} for n in names]}, open(w + "/dist.json", "w"), indent=1)
