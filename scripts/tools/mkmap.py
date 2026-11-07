#!/usr/bin/env python3
"""Generate a pdftex.map: concatenation of the dvips-style map files shipped in the tree plus
auto-generated lines for the Computer Modern / AMS Type1 fonts (Debian builds pdftex.map with
updmap at install time; we have no updmap in the sandbox, so we synthesise an equivalent)."""
import os, re, sys
texmf = sys.argv[1]
out = []
# 1. maps shipped with the font packages (URW35, Latin Modern, ...).  NOT pdftex35.map: it marks the
#    base-35 fonts as non-embedded and would shadow the real Type1 entries.
for sub in ("times", "helvetic", "courier", "palatino", "bookman", "ncntrsbk", "avantgar",
            "zapfchan", "zapfding", "symbol", "lm", "rsfs", "wasy-type1"):
    d = os.path.join(texmf, "fonts/map/dvips", sub)
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.endswith(".map"):
                text = open(os.path.join(d, f), errors="replace").read()
                out.append(text)
# 1b. psnfss' raw fonts carry Adobe names and *base-35 PostScript names* (ptmr8r Times-Roman) in
#     dvips35.map; re-point them at the URW clones that actually ship as Type1 so they get embedded.
URW = {  # base-35 PS name -> tfm name of the URW map entry providing the outlines
 "Times-Roman": "utmr8r", "Times-Bold": "utmb8r", "Times-Italic": "utmri8r", "Times-BoldItalic": "utmbi8r",
 "Helvetica": "uhvr8r", "Helvetica-Bold": "uhvb8r", "Helvetica-Oblique": "uhvro8r", "Helvetica-BoldOblique": "uhvbo8r",
 "Courier": "ucrr8r", "Courier-Bold": "ucrb8r", "Courier-Oblique": "ucrro8r", "Courier-BoldOblique": "ucrbo8r",
 "Palatino-Roman": "uplr8r", "Palatino-Bold": "uplb8r", "Palatino-Italic": "uplri8r", "Palatino-BoldItalic": "uplbi8r",
 "Bookman-Light": "ubkl8r", "Bookman-LightItalic": "ubkli8r", "Bookman-Demi": "ubkd8r", "Bookman-DemiItalic": "ubkdi8r",
 "NewCenturySchlbk-Roman": "uncr8r", "NewCenturySchlbk-Bold": "uncb8r", "NewCenturySchlbk-Italic": "uncri8r",
 "NewCenturySchlbk-BoldItalic": "uncbi8r", "AvantGarde-Book": "uagk8r", "AvantGarde-BookOblique": "uagko8r",
 "AvantGarde-Demi": "uagd8r", "AvantGarde-DemiOblique": "uagdo8r", "ZapfChancery-MediumItalic": "uzcmi8r",
 "Symbol": "usyr", "ZapfDingbats": "uzdr"}
urw_lines = {}
for line in "".join(out).splitlines():
    t = line.split()
    if len(t) >= 3 and t[0].startswith("u"):
        urw_lines[t[0]] = t
d35 = os.path.join(texmf, "fonts/map/dvips/tetex/dvips35.map")
if os.path.exists(d35):
    alias = []
    for line in open(d35, errors="replace").read().splitlines():
        m = re.match(r"^(p\S+)\s+(\S+)(.*)$", line)
        if not m or m.group(2) not in URW or URW[m.group(2)] not in urw_lines:
            continue
        u = urw_lines[URW[m.group(2)]]
        pfb = [w for w in u if w.startswith("<") and w.endswith(".pfb")]
        if not pfb:
            continue
        rest = re.sub(r"<\S+\.pfb", "", m.group(3))
        alias.append("%s %s%s %s" % (m.group(1), u[1], rest.rstrip(), pfb[0]))
    out.append("\n".join(alias) + "\n")

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
