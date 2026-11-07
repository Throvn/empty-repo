#!/usr/bin/env python3
"""Generate a pdftex.map: concatenation of the dvips-style map files shipped in the tree plus
auto-generated lines for the Computer Modern / AMS Type1 fonts (Debian builds pdftex.map with
updmap at install time; we have no updmap in the sandbox, so we synthesise an equivalent)."""
import os, re, sys
texmf = sys.argv[1]
out = []
# 1. maps shipped with the font packages (URW35 etc.)
for sub in ("times", "helvetic", "courier", "palatino", "bookman", "ncntrsbk", "avantgar",
            "zapfchan", "zapfding", "symbol", "tetex", "rsfs", "wasy-type1"):
    d = os.path.join(texmf, "fonts/map/dvips", sub)
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.endswith(".map"):
                out.append(open(os.path.join(d, f), errors="replace").read())
# 2. CM + AMS fonts: derive "tfmname PSName <file.pfb" from the pfb headers
root = os.path.join(texmf, "fonts/type1/public/amsfonts")
seen = set()
for dp, dn, fn in sorted(os.walk(root)):
    for f in sorted(fn):
        if not f.endswith(".pfb"):
            continue
        data = open(os.path.join(dp, f), "rb").read(4096)
        m = re.search(rb"/FontName\s*/(\S+)", data)
        if not m:
            continue
        base = f[:-4]
        if base in seen:
            continue
        seen.add(base)
        out.append("%s %s <%s\n" % (base, m.group(1).decode(), f))
sys.stdout.write("".join(out))
