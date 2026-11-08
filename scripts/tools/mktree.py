#!/usr/bin/env python3
"""Assemble the runtime TeX tree for pdfTeX from extracted Ubuntu .deb contents.

   mktree.py <debs-x dir> <out tree>

* merges texmf-dist/ (and the older /usr/share/texmf/) trees of the listed packages, later packages win
* keeps only what pdfTeX can use: tex/{generic,latex,plain,...}, bibtex/bst, fonts/{tfm,vf,type1,enc,map}, web2c/*.tcx
* fonts-extra is ~2 GB: only an allow-list of popular families is taken
* generates what Debian's maintainer scripts would (we have no updmap/fmtutil here): pdftex.map, language.dat/.def
"""
import os, re, shutil, sys

DEBS, OUT = sys.argv[1], sys.argv[2]

PKGS = ['texlive-base', 'texlive-latex-base', 'texlive-latex-recommended', 'texlive-latex-extra', 'texlive-pictures',
        'texlive-science', 'texlive-publishers', 'texlive-plain-generic', 'texlive-bibtex-extra', 'texlive-formats-extra',
        'texlive-fonts-recommended', 'lmodern', 'cm-super', 'cm-super-minimal',
        'texlive-lang-german', 'texlive-lang-french', 'texlive-lang-spanish', 'texlive-lang-italian', 'texlive-lang-portuguese',
        'texlive-lang-european', 'texlive-lang-polish', 'texlive-lang-cyrillic', 'texlive-lang-czechslovak',
        'texlive-fonts-extra']
ROOTS = ['usr/share/texlive/texmf-dist', 'usr/share/texmf']

# engines/formats pdfTeX does not run: their macro trees are useless here
DROP_TEX = {'latex-dev', 'luatex', 'lualatex', 'xelatex', 'xetex', 'context', 'jadetex', 'xmltex', 'mltex', 'texsis', 'lollipop', 'eplain-x'}
# families taken from the huge fonts-extra package (their tfm/vf/type1/enc/map siblings come along)
FONT_ALLOW = {'kpfonts', 'newtx', 'newpx', 'txfontsb', 'libertine', 'libertinus-type1', 'xcharter', 'fourier', 'mathdesign',
              'concmath', 'eulervm', 'cmbright', 'inconsolata', 'mnsymbol', 'stix', 'stix2-type1', 'antt', 'arev', 'bera',
              'ebgaramond', 'cochineal', 'garamond-libre', 'gentium-tug', 'fbb', 'erewhon', 'nimbus15', 'dejavu', 'mlmodern',
              'sansmathfonts', 'sansmathaccent', 'cm-lgc', 'ccicons', 'fontawesome', 'fontawesome5', 'bbold-type1', 'bboldx',
              'dsserif', 'esint', 'cmll', 'cmexb', 'doublestroke', 'dutchcal', 'boondox', 'cmathbb', 'iwona', 'kurier', 'ptsans', 'ptserif', 'pxfonts', 'txfonts', 'utopia', 'charter', 'tex-gyre', 'urw35vf', 'courierten', 'frcursive', 'calligra-type1',
              'esstix', 'fdsymbol', 'esvect', 'yfonts-t1', 'zlmtt', 'lm', 'ly1', 'tipa', 'wsuipa', 'phaistos',
              'bbold', 'concmath-fonts', 'concrete', 'bbm', 'bbm-macros'}
FONT_KINDS = ('tfm', 'vf', 'type1', 'enc', 'map')

n_files = n_conflict = 0
def want(rel, pkg):
    """should <texmf-dist>-relative path `rel` (posix) of package `pkg` go into the tree?"""
    p = rel.split('/')
    if p[0] == 'tex':
        return len(p) > 2 and p[1] not in DROP_TEX
    if p[0] == 'bibtex':
        return len(p) > 2 and p[1] == 'bst'
    if p[0] == 'web2c':
        return rel.endswith('.tcx')
    if p[0] == 'fonts':
        if len(p) < 4 or p[1] not in FONT_KINDS:
            return False
        if pkg == 'texlive-fonts-extra':
            # fonts/<kind>/<supplier>/<family>/...   (map files: fonts/map/<driver>/<family>/...)
            fam = p[3] if p[1] != 'map' else (p[3] if len(p) > 4 else '')
            return fam in FONT_ALLOW or p[2] in FONT_ALLOW
        return not (p[1] == 'type1' and p[2] == 'hoekwater')
    return False

for pkg in PKGS:
    for root in ROOTS:
        base = os.path.join(DEBS, pkg, root)
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            dns.sort()
            for fn in sorted(fns):
                src = os.path.join(dp, fn)
                if not os.path.isfile(src):            # dangling Debian symlink into /etc, /var
                    continue
                rel = os.path.relpath(src, base).replace(os.sep, '/')
                if fn.endswith(('.pdf', '.ps', '.eps')) and rel.startswith('tex/'):
                    pass                                # figures a package \includes at run time may be needed: keep
                if not want(rel, pkg):
                    continue
                dst = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if os.path.exists(dst):
                    n_conflict += 1
                shutil.copyfile(src, dst); n_files += 1
print(f'tree: {n_files} files ({n_conflict} overwritten by later packages)', file=sys.stderr)

# ------------------------------------------------------------------ pdftex.map
tree_files = {}
for sub in ('fonts/type1', 'fonts/enc', 'fonts/truetype'):
    for dp, _, fns in os.walk(os.path.join(OUT, sub)):
        for fn in fns:
            tree_files[fn] = True
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

def map_files():
    """all dvips/pdftex map files, the 'classic' sets first (their entries must win over alternatives)"""
    found = []
    for drv in ('pdftex', 'dvips'):
        for dp, _, fns in os.walk(os.path.join(OUT, 'fonts/map', drv)):
            for fn in fns:
                if fn.endswith('.map'):
                    found.append(os.path.join(dp, fn))
    def prio(f):
        r = f.replace(OUT, '')
        for i, key in enumerate(('/cm/', '/lm/', '/amsfonts', '/cm-super', '/times/', '/helvetic/', '/courier/', '/palatino/', '/bookman/', '/ncntrsbk/', '/avantgar/', '/zapfchan/', '/zapfding/', '/symbol/', '/psnfss/')):
            if key in r:
                return i
        return 99
    return sorted(found, key=lambda f: (prio(f), f))

def refs(line):
    """font/encoding files a map line refers to:  <8r.enc  <<foo.pfb  <[x.enc  <foo.pfb"""
    return [m.group(1) for m in re.finditer(r'<(?:<|\[)?([^\s<>\[\]"]+)', line)]

entries, seen = [], set()
def add(line):
    t = line.split()
    if not t or t[0].startswith('%') or t[0] in seen:
        return
    fonts = [r for r in refs(line) if r.endswith(('.pfb', '.pfa', '.ttf'))]
    allrefs = refs(line)
    if not fonts or not all(r in tree_files for r in allrefs):    # only entries whose files exist (and that embed something)
        return
    seen.add(t[0]); entries.append(line.rstrip())

urw_lines = {}
for mf in map_files():
    for line in open(mf, errors='replace').read().splitlines():
        t = line.split()
        if len(t) >= 3 and t[0].startswith('u'):
            urw_lines.setdefault(t[0], t)
        add(line)
# psnfss raw fonts carry Adobe names and base-35 PostScript names (ptmr8r Times-Roman): point them at the URW clones
d35 = os.path.join(OUT, 'fonts/map/dvips/tetex/dvips35.map')
if os.path.exists(d35):
    for line in open(d35, errors='replace').read().splitlines():
        m = re.match(r'^(p\S+)\s+(\S+)(.*)$', line)
        if not m or m.group(2) not in URW or URW[m.group(2)] not in urw_lines:
            continue
        u = urw_lines[URW[m.group(2)]]
        pfb = [w for w in u if w.startswith('<') and w.endswith('.pfb')]
        if pfb:
            add('%s %s%s %s' % (m.group(1), u[1], re.sub(r'<\S+\.pfb', '', m.group(3)).rstrip(), pfb[0]))
# CM / AMS fonts: derive "tfmname PSName <file.pfb" from the pfb headers (no map ships for them)
for dp, _, fns in sorted(os.walk(os.path.join(OUT, 'fonts/type1/public/amsfonts'))):
    for f in sorted(fns):
        if f.endswith('.pfb') and f[:-4] not in seen:
            m = re.search(rb'/FontName\s*/(\S+)', open(os.path.join(dp, f), 'rb').read(4096))
            if m:
                add('%s %s <%s' % (f[:-4], m.group(1).decode(), f))
os.makedirs(os.path.join(OUT, 'fonts/map'), exist_ok=True)
open(os.path.join(OUT, 'fonts/map/pdftex.map'), 'w').write('\n'.join(entries) + '\n')
print(f'pdftex.map: {len(entries)} entries', file=sys.stderr)

# ------------------------------------------------------------------ language.dat / language.def
HY = os.path.join(OUT, 'tex/generic/hyph-utf8/loadhyph')
have = set(os.listdir(HY)) if os.path.isdir(HY) else set()
LANGS = [  # babel name, loadhyph file, synonyms
 ('german', 'loadhyph-de-1901.tex', ['germanb']), ('ngerman', 'loadhyph-de-1996.tex', ['ngermanb']),
 ('swissgerman', 'loadhyph-de-ch-1901.tex', []), ('french', 'loadhyph-fr.tex', ['francais', 'canadien', 'acadian']),
 ('spanish', 'loadhyph-es.tex', ['espanol']), ('italian', 'loadhyph-it.tex', []), ('portuguese', 'loadhyph-pt.tex', ['portuges']),
 ('brazilian', 'loadhyph-pt.tex', ['brazil']), ('dutch', 'loadhyph-nl.tex', []), ('polish', 'loadhyph-pl.tex', []),
 ('czech', 'loadhyph-cs.tex', []), ('slovak', 'loadhyph-sk.tex', []), ('russian', 'loadhyph-ru.tex', []),
 ('ukrainian', 'loadhyph-uk.tex', []), ('bulgarian', 'loadhyph-bg.tex', []), ('swedish', 'loadhyph-sv.tex', []),
 ('danish', 'loadhyph-da.tex', []), ('norwegian', 'loadhyph-nb.tex', ['norsk', 'bokmal']), ('nynorsk', 'loadhyph-nn.tex', []),
 ('finnish', 'loadhyph-fi.tex', []), ('latin', 'loadhyph-la.tex', []), ('catalan', 'loadhyph-ca.tex', []),
 ('croatian', 'loadhyph-hr.tex', []), ('slovenian', 'loadhyph-sl.tex', ['slovene']), ('hungarian', 'loadhyph-hu.tex', ['magyar']),
 ('romanian', 'loadhyph-ro.tex', []), ('turkish', 'loadhyph-tr.tex', []), ('serbian', 'loadhyph-sr-latn.tex', []),
 ('estonian', 'loadhyph-et.tex', []), ('lithuanian', 'loadhyph-lt.tex', []), ('latvian', 'loadhyph-lv.tex', []),
 ('galician', 'loadhyph-gl.tex', []), ('icelandic', 'loadhyph-is.tex', []), ('irish', 'loadhyph-ga.tex', []),
 ('welsh', 'loadhyph-cy.tex', []), ('esperanto', 'loadhyph-eo.tex', []), ('interlingua', 'loadhyph-ia.tex', []),
]
dat = ['% language.dat -- generated for pdfTeX in wasm (English: traditional hyphen.tex patterns)', 'english hyphen.tex', '=usenglish', '=USenglish', '=american']
defs = ['% language.def -- generated', r'\addlanguage{english}{hyphen}{}{2}{3}', r'\addlanguage{USenglish}{hyphen}{}{2}{3}', r'\addlanguage{american}{hyphen}{}{2}{3}']
for name, f, syn in LANGS:
    if f in have:
        dat.append(f'{name} {f}'); dat += ['=' + s for s in syn]
        defs.append(r'\addlanguage{%s}{%s}{}{2}{2}' % (name, f[len('loadhyph-'):-4].replace('-', '')))
        for s in syn:
            defs.append(r'\addlanguage{%s}{%s}{}{2}{2}' % (s, f[len('loadhyph-'):-4].replace('-', '')))
defs += [r'\uselanguage{english}', r'\endinput']
os.makedirs(os.path.join(OUT, 'tex/generic/config'), exist_ok=True)
open(os.path.join(OUT, 'tex/generic/config/language.dat'), 'w').write('\n'.join(dat) + '\n')
open(os.path.join(OUT, 'tex/generic/config/language.def'), 'w').write('\n'.join(defs) + '\n')
print(f'languages: {len(dat)} lines in language.dat', file=sys.stderr)
