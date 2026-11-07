#!/usr/bin/env python3
"""Generate a synthetic long LaTeX document: gen-long.py SECTIONS > out.tex"""
import random, sys
n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
random.seed(1)
words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split()
para = lambda k: " ".join(random.choice(words) for _ in range(k)) + "."
out = [r"\documentclass{article}", r"\usepackage{amsmath}", r"\usepackage[margin=2.5cm]{geometry}",
       r"\title{Long document}", r"\author{wasm}", r"\begin{document}", r"\maketitle", r"\tableofcontents", r"\newpage"]
for i in range(1, n + 1):
    out.append(r"\section{Section number %d}\label{sec:%d}" % (i, i))
    for _ in range(6):
        out += [para(70), ""]
    out.append(r"\begin{equation} \sum_{k=1}^{%d} k = \frac{%d(%d+1)}{2} \end{equation}" % (i, i, i))
    out += [r"See Section~\ref{sec:%d}." % max(1, i - 1), ""]
out.append(r"\end{document}")
print("\n".join(out))
