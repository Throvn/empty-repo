#!/usr/bin/env python3
"""Generate the edge-case corpus into build/corpus (one .tex per case, or a directory for multi-file projects).
Every case is compiled by native pdftex and by pdftex.wasm; all outputs must be byte-identical (tests/diff.mjs).
Deliberately includes broken documents: error paths are part of the contract."""
import os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'build', 'corpus')
os.makedirs(OUT, exist_ok=True)
n = 0

def D(name, body, pre='', cls='article', opts='', clsopt='', files=None):
    """one document; files={path: text} makes it a project directory"""
    global n
    n += 1
    head = f"%!opts:{opts}\n\\documentclass{clsopt and '[' + clsopt + ']'}{{{cls}}}\n{pre}\n\\begin{{document}}\n"
    text = head + body + "\n\\end{document}\n"
    if files:
        d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'main.tex'), 'w').write(text)
        for p, t in files.items():
            fp = os.path.join(d, p); os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, 'w').write(t)
    else:
        open(os.path.join(OUT, name + '.tex'), 'w').write(text)

def RAW(name, text, files=None, opts=''):
    """document given verbatim (plain TeX, ini-style, no \\documentclass ...)"""
    global n
    n += 1
    text = f"%!opts:{opts}\n" + text
    if files:
        d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'main.tex'), 'w').write(text)
        for p, t in files.items():
            fp = os.path.join(d, p); os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, 'w').write(t)
    else:
        open(os.path.join(OUT, name + '.tex'), 'w').write(text)

AMS = r'\usepackage{amsmath,amssymb,amsthm}'
LOREM = ' '.join('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split()) + '. '
L = lambda k=1: LOREM * k

# ------------------------------------------------------------------ document classes & options
for cls in ['article', 'report', 'book', 'letter', 'slides', 'minimal', 'proc', 'ltxdoc']:
    body = {'letter': r'\address{Me}\signature{Me}\begin{letter}{You}\opening{Dear You,}' + L(2) + r'\closing{Yours}\end{letter}',
            'minimal': 'Hello minimal.', 'slides': r'\begin{slide}Hi\end{slide}'}.get(cls, r'\title{T}\author{A}\date{D}\maketitle' + (r'\chapter{One}' if cls in ('report', 'book') else r'\section{One}') + L(3))
    D('class-' + cls, body, cls=cls)
for o in ['10pt', '11pt', '12pt', 'a4paper', 'letterpaper', 'a5paper', 'b5paper', 'landscape', 'twocolumn', 'twoside', 'titlepage', 'notitlepage', 'fleqn', 'leqno', 'openbib', 'draft', 'final', 'oneside', 'openany', 'openright']:
    D('opt-' + o, r'\title{T}\author{A}\maketitle\tableofcontents\section{One}' + L(10) + r'\begin{equation}a=b\end{equation}', clsopt=o, cls='report' if o.startswith('open') else 'article')
D('opt-many', L(20), clsopt='12pt,a4paper,twocolumn,twoside,draft,fleqn,leqno')
D('opt-unknown', L(1), clsopt='nonexistentoption')
D('class-missing', 'x', cls='nonexistentclass')

# ------------------------------------------------------------------ math
D('math-align', r'\begin{align}a&=b+c\\ d&=e\end{align}\begin{align*}x&=1\\y&=2\end{align*}\begin{alignat}{2}a&=b&\quad c&=d\\e&=f&g&=h\end{alignat}\begin{flalign}x&=1&y&=2\end{flalign}', AMS)
D('math-gather-multline', r'\begin{gather}a=b\\c=d\end{gather}\begin{multline}' + '+'.join('x_%d' % i for i in range(40)) + r'\end{multline}\begin{split}a&=b\\&=c\end{split}', AMS)
D('math-cases-matrix', r'$f(x)=\begin{cases}1&x>0\\0&\text{else}\end{cases}$ $\begin{pmatrix}1&2\\3&4\end{pmatrix}\begin{bmatrix}a&b\\c&d\end{bmatrix}\begin{vmatrix}1&0\\0&1\end{vmatrix}\begin{Bmatrix}1\end{Bmatrix}$ $\smash{x}\mathstrut\hphantom{y}\vphantom{z}$', AMS)
D('math-operators', r'$\sum_{i=1}^n\prod_{j}\int_0^1\oint\iint\bigcup\bigcap\lim_{x\to0}\sup\inf\max\min\det\gcd\sin\cos\tan\log\ln\exp\arg\deg\ker\dim\hom$ $\DeclareMathOperator{\foo}{foo}$ \DeclareMathOperator*{\bar}{bar}$\foo x\bar_{y}z$', AMS)
D('math-fractions', r'$\frac{a}{b}\dfrac{a}{b}\tfrac{a}{b}\binom{n}{k}\dbinom{n}{k}\genfrac{(}{)}{0pt}{}{a}{b}\sqrt{x}\sqrt[3]{x}\cfrac{1}{1+\cfrac{1}{2}}\overset{a}{b}\underset{a}{b}\stackrel{a}{=}\substack{a\\b}$', AMS)
D('math-delims', r'$\left(\frac{a}{b}\right)\left[\sum\right]\left\{x\right\}\left|x\right|\left\|x\right\|\left\langle x\right\rangle\bigl(\Bigl(\biggl(\Biggl($\left.\frac12\right|_0^1$ $\left\lfloor x\right\rceil$', AMS)
D('math-fonts', r'$\mathbb{R}\mathcal{L}\mathfrak{g}\mathscr{A}\mathbf{v}\mathit{abc}\mathsf{s}\mathtt{t}\mathrm{d}\boldsymbol{\alpha}\bm{x}\mathnormal{x}\boldsymbol\Gamma\mathbf{\Gamma}$', r'\usepackage{amsmath,amssymb,amsfonts,bm}')
D('math-greek-symbols', r'$\alpha\beta\gamma\delta\epsilon\varepsilon\zeta\eta\theta\vartheta\iota\kappa\lambda\mu\nu\xi\pi\varpi\rho\varrho\sigma\varsigma\tau\upsilon\phi\varphi\chi\psi\omega\Gamma\Delta\Theta\Lambda\Xi\Pi\Sigma\Upsilon\Phi\Psi\Omega\hbar\ell\wp\Re\Im\partial\nabla\infty\forall\exists\neg\emptyset\varnothing$ $\leq\geq\neq\approx\equiv\sim\simeq\cong\propto\ll\gg\subset\supset\subseteq\supseteq\in\notin\ni\cup\cap\setminus\oplus\otimes\times\div\cdot\circ\bullet\star\ast\pm\mp$', AMS)
D('math-arrows-accents', r'$\to\gets\leftrightarrow\Rightarrow\Leftarrow\Leftrightarrow\mapsto\longrightarrow\longmapsto\hookrightarrow\rightsquigarrow\uparrow\downarrow\nearrow\searrow\xrightarrow{abc}\xleftarrow[x]{y}\hat{a}\tilde{a}\bar{a}\vec{a}\dot{a}\ddot{a}\widehat{abc}\widetilde{abc}\overline{abc}\underline{abc}\overbrace{abc}^{d}\underbrace{abc}_{d}\check{a}\breve{a}\acute{a}\grave{a}$', AMS)
D('math-numbering', r'\begin{equation}a\end{equation}\begin{equation}b\tag{custom}\label{e:b}\end{equation}\begin{equation}c\tag*{star}\end{equation}\eqref{e:b} \ref{e:b}\begin{subequations}\begin{align}a&=1\label{s:a}\\b&=2\end{align}\end{subequations}\eqref{s:a}\begin{equation}\notag a\end{equation}\begin{align}a\nonumber\\b\end{align}', AMS + r'\numberwithin{equation}{section}')
D('math-theorems', r'\begin{theorem}[Name]$a=b$\end{theorem}\begin{lemma}L\end{lemma}\begin{proof}By \qedhere\end{proof}\begin{remark}R\end{remark}\begin{definition}D\end{definition}\begin{proof}[Proof of X]trivial.\end{proof}', AMS + r'\theoremstyle{plain}\newtheorem{theorem}{Theorem}[section]\newtheorem{lemma}[theorem]{Lemma}\theoremstyle{definition}\newtheorem{definition}{Definition}\theoremstyle{remark}\newtheorem*{remark}{Remark}')
D('math-display-in-par', 'text $$a+b=c$$ text \\[ x^2 \\] text \\begin{displaymath}y\\end{displaymath} $\\displaystyle\\sum_i x_i$ $\\textstyle\\sum$ $\\scriptstyle a$ $\\scriptscriptstyle b$', AMS)
D('math-errors', r'$a_b_c$ $a^b^c$ $\frac{a}{$ $x}$ $$a$ \[ \begin{equation} $\left(x$ $\left( x \right]$ \end{align}', AMS)
D('math-big', r'$$' + r'\sum_{i}^{n}'.join('x_%d' % i for i in range(200)) + r'$$ ' + r'\[' + '+'.join('a_{%d}^{2}' % i for i in range(300)) + r'\]', AMS)
D('math-tags-mix', r'\begin{align}a&=b\tag{1a}\\c&=d\label{x}\end{align}\begin{equation*}a=b\end{equation*}\begin{eqnarray}a&=&b\\c&=&d\end{eqnarray}\begin{eqnarray*}a&=&b\end{eqnarray*}', AMS)
D('math-text-mode', r'$\text{text }\textbf{b}\mathrm{abc}\operatorname{op}\operatorname*{lim}_x\mbox{box}\hbox{hb}\vbox{vb}\raisebox{1ex}{up}$ $\text{\textit{it} $x$ \emph{e}}$', AMS)
D('math-spacing', r'$a\,b\:c\;d\!e\ f\quad g\qquad h\hspace{3pt}i\mkern3mu j\mskip5mu plus 2mu k\negthinspace l$ $a{}b\mathbin{x}\mathrel{y}\mathop{z}\limits_1\mathpunct{;}\mathinner{i}\mathopen{(}\mathclose{)}\mathord{o}$', AMS)

# ------------------------------------------------------------------ text structure
D('struct-sections', r'\tableofcontents\listoffigures\listoftables\section{S}\subsection{SS}\subsubsection{SSS}\paragraph{P}x\subparagraph{SP}y\section*{Star}\addcontentsline{toc}{section}{Manual}\appendix\section{App}\subsection{Sub}', cls='article')
D('struct-book', r'\frontmatter\tableofcontents\mainmatter\part{P}\chapter{C}\section{S}x\chapter*{CS}\appendix\chapter{A}\backmatter\chapter{B}', cls='book')
D('struct-secnumdepth', r'\setcounter{secnumdepth}{0}\setcounter{tocdepth}{1}\tableofcontents\section{S}\subsection{SS}\subsubsection{SSS}\setcounter{secnumdepth}{5}\subsubsection{N}\paragraph{P}\subparagraph{Q}x')
D('struct-lists', r'\begin{itemize}\item a\begin{itemize}\item b\begin{itemize}\item c\begin{itemize}\item d\end{itemize}\end{itemize}\end{itemize}\end{itemize}\begin{enumerate}\item a\begin{enumerate}\item b\begin{enumerate}\item c\begin{enumerate}\item d\end{enumerate}\end{enumerate}\end{enumerate}\end{enumerate}\begin{description}\item[Term] def\item[Other] def\end{description}')
D('struct-lists-too-deep', r'\begin{itemize}\item\begin{itemize}\item\begin{itemize}\item\begin{itemize}\item\begin{itemize}\item x\end{itemize}\end{itemize}\end{itemize}\end{itemize}\end{itemize}')
D('struct-lists-errors', r'\begin{itemize}x\end{itemize}\begin{enumerate}\end{enumerate}\item stray \begin{description}\item[a\end{description}')
D('struct-quotes', r'\begin{quote}' + L(3) + r'\end{quote}\begin{quotation}' + L(3) + r'\par' + L(2) + r'\end{quotation}\begin{verse}line one\\line two\\\\next\end{verse}\begin{center}c\\c2\end{center}\begin{flushleft}l\end{flushleft}\begin{flushright}r\end{flushright}')
D('struct-verbatim', r'\begin{verbatim}  a  b\n\\ % $ { } ~ ^ _ &  \end{verbatim}\verb|a b| \verb+x|y+ \verb*|a b|\begin{verbatim*}a b\end{verbatim*}', r'')
D('struct-verb-errors', 'a \\verb|unterminated\n b\n\\begin{verbatim}never ended')
D('struct-footnotes', r'x\footnote{one}y\footnote{two}\footnote[7]{seven}\footnotemark[1]\footnotetext[1]{t} \begin{minipage}{5cm}m\footnote{in minipage}\end{minipage}\marginpar{margin}\marginpar[left]{right}' + L(30) + r'\footnote{' + L(30) + '}')
D('struct-footnote-in-section', r'\section{S\footnote{in heading}}\tableofcontents x', )
D('struct-boxes', r'\fbox{f}\framebox[3cm][l]{l}\framebox[3cm][r]{r}\makebox[3cm][s]{s s}\parbox[t]{3cm}{' + L(2) + r'}\parbox[b][2cm][s]{3cm}{x}\raisebox{3pt}[0pt][0pt]{r}\rule{1cm}{1pt}\rule[-2pt]{2pt}{1cm}\underline{u}\mbox{m}\fboxsep=5pt\fboxrule=2pt\fbox{x}\dotfill\hrulefill\hfill\null')
D('struct-minipage', r'\begin{minipage}[t]{.45\textwidth}' + L(5) + r'\end{minipage}\hfill\begin{minipage}[b]{.45\textwidth}' + L(3) + r'\end{minipage}\begin{minipage}[c][5cm][b]{3cm}x\end{minipage}')
D('struct-spacing', r'a\hspace{1cm}b\hspace*{1cm}c\vspace{1cm}d\vspace*{2cm}e\\[2cm]f\bigskip g\medskip h\smallskip i\noindent j\indent k\par\vfill l\newpage m\clearpage n\\*[1ex]\linebreak o\nolinebreak\pagebreak[2]\nopagebreak', )
D('struct-fonts', r'\tiny a\scriptsize b\footnotesize c\small d\normalsize e\large f\Large g\LARGE h\huge i\Huge j\normalsize \textbf{b}\textit{i}\textsl{s}\textsc{sc}\texttt{t}\textsf{sf}\textrm{r}\textmd{m}\textup{u}\textnormal{n}\emph{e\emph{ee}}\bfseries\itshape\scshape\ttfamily\sffamily\rmfamily\mdseries\upshape\slshape\normalfont\textbf{\textit{bi}}\textsc{\textbf{scb}}\fontsize{15}{18}\selectfont big\fontfamily{cmtt}\selectfont tt\fontseries{bx}\fontshape{it}\selectfont bxit')
D('struct-font-errors', r'\fontfamily{nonexistent}\selectfont x \fontsize{0}{0}\selectfont y \fontencoding{XYZ}\selectfont z \textbf{\fontshape{zz}\selectfont w}')
D('struct-accents-text', r'\"a \"o \"u \'e \`e \^e \~n \=a \.a \u{a} \v{c} \H{o} \c{c} \k{a} \d{a} \b{a} \t{oo} \r{a} \aa \AA \ae \AE \oe \OE \o \O \l \L \ss \i \j \SS ? ! \textquoteleft \textquoteright \textquotedblleft \textquotedblright --- -- - \dag \ddag \S \P \copyright \pounds \textbackslash \{ \} \$ \% \& \# \_ \textasciitilde \textasciicircum \textbar \textless \textgreater', )
D('struct-ligatures', r'fi fl ff ffi ffl ``quoted\'\' `single\' <<>> --- -- ?` !` A\kern-.1emV T\/e fi{}fi f{}i \textbf{fi} \texttt{fi -- ---}')
D('struct-hyphenation', r'\hyphenation{hy-phen-ation-test} hyphenationtest ' + 'Supercalifragilisticexpialidocious ' * 5 + r'\sloppy ' + L(5) + r'\fussy \hbadness=0 \hfuzz=0pt ' + 'antidisestablishmentarianism ' * 8, clsopt='twocolumn')
D('struct-overfull', r'\hbox to 1cm{this is far too long for the box}\par\hbox to 10cm{short}\par\vbox to 1cm{' + L(10) + r'}\par ' + 'a' * 300 + r'\par\tracingonline1 \showboxbreadth100 \showboxdepth100 \setbox0\hbox{xyz}\showbox0 \showthe\wd0 \showlists')
D('struct-pagebreaks', r'\newpage ' + r'\newpage '.join(L(1) for _ in range(30)) + r'\clearpage\cleardoublepage\pagestyle{empty}x\thispagestyle{plain}y\pagenumbering{roman}z\pagenumbering{Alph}\setcounter{page}{5}w', cls='book')
D('struct-headings-styles', r'\pagestyle{headings}\section{A}' + L(40) + r'\pagestyle{myheadings}\markboth{L}{R}' + L(40) + r'\pagestyle{plain}' + L(40), clsopt='twoside')
D('struct-title-abstract', r'\title{A very long title that goes on and on and on and on to test wrapping of the title block}\author{First \and Second\thanks{thanks}\and Third}\date{\today}\maketitle\begin{abstract}' + L(5) + r'\end{abstract}\thanks{x}', clsopt='titlepage')
D('struct-today', r'\today \number\year \number\month \number\day \the\time \pdfcreationdate \pdfelapsedtime')
D('struct-tabbing', r'\begin{tabbing}a\hspace{2cm}\=b\=c\\1\>2\>3\\\kill x\>y\\\+z\>\<w\\\end{tabbing}')
D('struct-two-column', L(60) + r'\begin{figure*}[t]\rule{\textwidth}{2cm}\caption{wide}\end{figure*}' + L(60) + r'\onecolumn ' + L(10) + r'\twocolumn[\section{Top}' + L(2) + r']' + L(40), clsopt='twocolumn')
D('struct-landscape', L(5), pre=r'\usepackage[landscape]{geometry}')

# ------------------------------------------------------------------ tables & floats
D('table-basic', r'\begin{tabular}{|l|c|r|p{3cm}|}\hline a&b&c&' + L(2) + r'\\\hline\multicolumn{2}{|c|}{span}&x&y\\\cline{1-2}1&2&3&4\\\hline\end{tabular}\begin{tabular}{@{}ll@{\hspace{2cm}}l!{\vrule width 2pt}}a&b&c\end{tabular}')
D('table-nested-floats', r'\begin{table}[htbp]\centering\caption{Cap}\label{t:1}\begin{tabular}{cc}a&b\\c&d\end{tabular}\end{table}\begin{figure}[!t]\fbox{fig}\caption[short]{long caption ' + L(3) + r'}\end{figure}\listoftables\listoffigures \ref{t:1}', )
D('table-many-floats', ''.join(r'\begin{figure}[tbp]\rule{5cm}{8cm}\caption{F%d}\end{figure}' % i for i in range(20)) + L(10))
D('table-longtable', r'\begin{longtable}{lp{5cm}}\caption{LT}\\\hline h1&h2\\\hline\endfirsthead\hline cont&\\\hline\endhead\hline\endfoot\hline\endlastfoot' + ''.join('r%d&%s\\\\' % (i, L(1)) for i in range(80)) + r'\end{longtable}', r'\usepackage{longtable}')
D('table-array-pkg', r'\begin{tabular}{>{\bfseries}l<{!}*{3}{c}|}a&b&c&d\\\end{tabular}\newcolumntype{Y}{>{\centering\arraybackslash}p{2cm}}\begin{tabular}{Y|Y}a&b\\\end{tabular}$\begin{array}{c|c}1&2\\3&4\end{array}$', r'\usepackage{array}')
D('table-tabularx', r'\begin{tabularx}{\textwidth}{lXr}a&' + L(3) + r'&c\\\end{tabularx}\begin{tabular*}{5cm}{@{\extracolsep{\fill}}ll}a&b\end{tabular*}', r'\usepackage{tabularx}')
D('table-booktabs-color', r'\begin{tabular}{ll}\toprule a&b\\\midrule\rowcolor{red!20}c&d\\\cmidrule(lr){1-2}\bottomrule\end{tabular}\columncolor{blue}', r'\usepackage{booktabs,colortbl,xcolor}')
D('table-errors', r'\begin{tabular}{ll}a&b&c\\d\end{tabular}\begin{tabular}{lx}a&b\end{tabular}\begin{tabular}{l}\hline\hline a\\\multicolumn{3}{l}{x}\end{tabular}\begin{tabular}a\end{tabular}')
D('float-captions', r'\begin{figure}\caption{no content}\end{figure}\begin{figure}\caption{a}\caption{b}\end{figure}\begin{figure}[H]\rule{1cm}{1cm}\end{figure}\captionof{figure}{x}', r'\usepackage{float,caption}')
D('float-placement-extreme', r'\setcounter{topnumber}{0}\setcounter{totalnumber}{0}\begin{figure}[t]\rule{1cm}{1cm}\caption{a}\end{figure}' + L(5) + r'\renewcommand{\topfraction}{.99}\renewcommand{\textfraction}{.01}\begin{figure}[b]\rule{10cm}{30cm}\caption{big}\end{figure}')
D('float-too-tall', r'\begin{figure}[t]\rule{1cm}{40cm}\caption{too tall}\end{figure}x')
D('float-wrap-sub', r'\begin{figure}\begin{subfigure}{.4\textwidth}\rule{3cm}{3cm}\caption{a}\end{subfigure}\begin{subfigure}{.4\textwidth}\rule{3cm}{3cm}\caption{b}\end{subfigure}\caption{both}\end{figure}', r'\usepackage{subcaption}')

# ------------------------------------------------------------------ cross references, toc, bibliography, index
D('ref-basic', r'\section{A}\label{s:a} see \ref{s:a}, \pageref{s:a}, \ref{undefined} \cite{undefined}\label{dup}\label{dup}' + L(30) + r'\newpage\section{B}\label{s:b}\ref{s:b}\pageref{s:b}')
D('ref-hyperref', r'\tableofcontents\section{A}\label{s:a}\autoref{s:a} \nameref{s:a} \hyperref[s:a]{go} \href{http://x.org}{link} \url{http://a.b/c_d%e} \hypertarget{t}{target}\hyperlink{t}{to} \texorpdfstring{$x$}{x}\footnote{\url{http://f.g}}' + L(10), r'\usepackage[colorlinks,pdfauthor={A B},pdftitle={T},bookmarksnumbered,pdfpagemode=UseOutlines]{hyperref}')
D('ref-hyperref-modes', r'\section{A}\subsection{B}\href{run:x.pdf}{r}\href{mailto:a@b.c}{m}\href{#x}{i}\textcolor{red}{c}', r'\usepackage[pdftex,hidelinks,bookmarksopen,bookmarksdepth=2,pdfstartview=FitH,pdfpagelayout=TwoColumnLeft,unicode,breaklinks,linktoc=all]{hyperref}\usepackage{xcolor}')
D('ref-hyperref-draft', r'\section{A}\ref{x}\href{u}{t}', r'\usepackage[draft]{hyperref}')
D('ref-bibliography', r'\cite{a}\cite{b,c}\cite[p.~3]{a}\nocite{*}\begin{thebibliography}{99}\bibitem{a} Author A. \emph{Title}. 2000.\bibitem[Lab]{b} B.\bibitem{c} C.\end{thebibliography}')
D('ref-natbib', r'\citet{a} \citep{a,b} \citep[see][p.~5]{a} \citeauthor{a} \citeyear{b}\begin{thebibliography}{2}\bibitem[A(2000)]{a} A.\bibitem[Bee(2001)]{b} B.\end{thebibliography}', r'\usepackage{natbib}')
D('ref-natbib-numbers', r'\cite{a,b,c}\begin{thebibliography}{3}\bibitem{a}A\bibitem{b}B\bibitem{c}C\end{thebibliography}', r'\usepackage[numbers,sort&compress]{natbib}')
D('ref-index', r'\index{a}x\index{b!sub}\index{c@C|textbf}\index{d|see{a}}\printindex\newpage\index{late}', r'\usepackage{makeidx}\makeindex')
D('ref-toc-levels', r'\tableofcontents\section{A}\subsection{B}\subsubsection{C}\newpage\section{D}' + r'\addtocontents{toc}{\protect\vspace{1cm}}\addcontentsline{toc}{subsection}{Added}')
D('ref-aux-mess', r'\makeatletter\@input{nonexistent.aux}\makeatother\newwrite\foo\immediate\openout\foo=\jobname.aux\immediate\write\foo{garbage}\immediate\closeout\foo x')
D('ref-label-unstable', r'\section{A}\label{x}\ref{y}\section{B}\label{y}\ref{x}\ref{z}\label{z}\ref{y}')

# ------------------------------------------------------------------ packages that exist in the tree
PK = {
 'geometry': r'\usepackage[a4paper,left=1in,right=2in,top=1cm,bottom=3cm,headheight=1cm,includehead,marginparwidth=3cm,showframe]{geometry}',
 'geometry-bad': r'\usepackage[paperwidth=1cm,paperheight=1cm,margin=2cm]{geometry}',
 'fancyhdr': r'\usepackage{fancyhdr}\pagestyle{fancy}\fancyhf{}\fancyhead[L]{\leftmark}\fancyhead[R]{\thepage}\fancyfoot[C]{\rightmark}\renewcommand{\headrulewidth}{2pt}\setlength{\headheight}{15pt}',
 'xcolor': r'\usepackage[dvipsnames,svgnames,table]{xcolor}\definecolor{my}{rgb}{.1,.5,.9}\definecolor{m2}{HTML}{FF8800}\colorlet{c3}{red!50!blue}',
 'setspace': r'\usepackage{setspace}\doublespacing',
 'parskip': r'\usepackage{parskip}',
 'enumitem': r'\usepackage{enumitem}\setlist{nosep,leftmargin=*}',
 'multicol': r'\usepackage{multicol}',
 'calc': r'\usepackage{calc}\newlength{\x}\setlength{\x}{3cm+2em*3}\newcounter{c}\setcounter{c}{3*4+1}',
 'ifthen': r'\usepackage{ifthen}',
 'verbatim': r'\usepackage{verbatim}',
 'xspace': r'\usepackage{xspace}\newcommand{\foo}{foo\xspace}',
 'listings': r'\usepackage{listings}\lstset{basicstyle=\ttfamily,numbers=left,frame=single,breaklines=true,language=Python}',
 'caption': r'\usepackage[font=small,labelfont=bf,format=hang,justification=centering]{caption}',
 'microtype': r'\usepackage{microtype}',
 'microtype-expansion': r'\usepackage[protrusion=true,expansion=true,tracking=true,kerning=true,spacing=true,factor=1100,stretch=20,shrink=20]{microtype}',
 'cmap': r'\usepackage{cmap}\usepackage[T1]{fontenc}',
 'textcomp': r'\usepackage{textcomp}',
 'tools-bm': r'\usepackage{bm}',
 'tools-dcolumn': r'\usepackage{dcolumn,delarray,hhline,theorem,varioref,showkeys}',
 'rotating': r'\usepackage{rotating}',
 'lscape': r'\usepackage{lscape}',
 'pdflscape': r'\usepackage{pdflscape}',
 'url': r'\usepackage{url}\urlstyle{rm}',
 'varioref': r'\usepackage{varioref}',
 'ulem': r'\usepackage[normalem]{ulem}',
 'epstopdf': r'\usepackage{epstopdf}',
 'bookmark': r'\usepackage{hyperref,bookmark}',
 'etoolbox': r'\usepackage{etoolbox}\newtoggle{x}\toggletrue{x}\AtBeginDocument{\typeout{abd}}\AtEndDocument{\typeout{aed}}\newbool{b}\booltrue{b}\ifbool{b}{\typeout{yes}}{\typeout{no}}',
 'xkeyval': r'\usepackage{xkeyval}\define@key{fam}{k}{\def\kv{#1}}\setkeys{fam}{k=v}',
 'mathtools': r'\usepackage{mathtools}\mathtoolsset{showonlyrefs}',
 'siunitx-missing': r'\usepackage{siunitx}',
 'tikz-missing': r'\usepackage{tikz}',
 'csquotes-missing': r'\usepackage{csquotes}',
 'babel-english': r'\usepackage[english]{babel}',
 'babel-unknown': r'\usepackage[klingon]{babel}',
 'babel-multi': r'\usepackage[german,english]{babel}',
 'inputenc-latin1': r'\usepackage[latin1]{inputenc}\usepackage[T1]{fontenc}',
 'inputenc-utf8': r'\usepackage[utf8]{inputenc}\usepackage[T1]{fontenc}\usepackage{lmodern}',
 'fonts-times': r'\usepackage{mathptmx}\usepackage[scaled=.9]{helvet}\usepackage{courier}',
 'fonts-palatino': r'\usepackage{palatino}', 'fonts-bookman': r'\usepackage{bookman}', 'fonts-newcent': r'\usepackage{newcent}', 'fonts-avant': r'\usepackage{avant}',
 'fonts-charter': r'\usepackage{charter}', 'fonts-utopia': r'\usepackage{utopia}', 'fonts-chancery': r'\usepackage{chancery}', 'fonts-lmodern': r'\usepackage{lmodern}\usepackage[T1]{fontenc}',
 'fonts-pxfonts-missing': r'\usepackage{pxfonts}', 'fonts-txfonts-missing': r'\usepackage{txfonts}',
 'fonts-euler': r'\usepackage{euler}', 'fonts-ae': r'\usepackage{ae}', 'fonts-concrete': r'\usepackage{ccfonts}', 'fonts-mathrsfs': r'\usepackage{mathrsfs}\usepackage{eucal}\usepackage{eufrak}',
 'fonts-t1-nolm': r'\usepackage[T1]{fontenc}',
 'fonts-ot2': r'\usepackage[OT2,T1]{fontenc}',
 'ams-fonts-all': r'\usepackage{amsfonts,amssymb,mathrsfs,wasysym,stmaryrd,marvosym,bbold}',
}
for k, pre in PK.items():
    body = r'\section{Test}' + L(3) + r'$\alpha+\beta=\gamma$ \textbf{b} \textit{i} \texttt{t} \textsc{sc}' + r'\begin{enumerate}\item a\item b\end{enumerate}'
    if k == 'listings': body += r'\begin{lstlisting}[language=C]' + '\nint main(){return 0;}\n// comment\n' + r'\end{lstlisting}\lstinline|x=1|\lstinputlisting{main.tex}'
    if k == 'multicol': body += r'\begin{multicols}{3}' + L(30) + r'\end{multicols}\begin{multicols*}{2}' + L(5) + r'\end{multicols*}'
    if k == 'ifthen': body += r'\ifthenelse{\equal{a}{a}}{yes}{no}\ifthenelse{3>2 \AND \isodd{3}}{y}{n}\newboolean{q}\setboolean{q}{true}\whiledo{\value{page}<3}{x\addtocounter{page}{1}}'
    if k == 'verbatim': body += r'\begin{comment}hidden\end{comment}\verbatiminput{main.tex}'
    if k == 'rotating': body += r'\begin{sideways}side\end{sideways}\begin{turn}{30}turned\end{turn}\rotatebox{45}{rot}\begin{sidewaystable}\begin{tabular}{ll}a&b\end{tabular}\end{sidewaystable}'
    if k in ('lscape', 'pdflscape'): body += r'\begin{landscape}wide' + L(3) + r'\end{landscape}after'
    if k == 'ulem': body += r'\uline{under}\uuline{double}\uwave{wave}\sout{strike}\xout{x}'
    if k.startswith('inputenc-utf8') : body += 'é è à ü ö ä ñ ç ß æ ø å œ € £ ¥ © ® ™ « » “ ” ‘ ’ – — … ° ± × ÷ ½ ¼ ¾ ¿ ¡ ·'
    if k == 'inputenc-latin1': body += '\xe9 \xe8 \xe0 \xfc \xf6 \xe4 \xf1 \xe7 \xdf'
    if k == 'babel-multi': body += r'\selectlanguage{german}Straße\selectlanguage{english}x\foreignlanguage{german}{y}'
    if k == 'xcolor': body += r'\textcolor{my}{c}\textcolor{m2}{d}\colorbox{c3}{e}\fcolorbox{red}{yellow}{f}\color{Orange}g\pagecolor{Lavender!20}\textcolor{NavyBlue}{n}\rowcolors{1}{red}{blue}'
    if k == 'varioref': body += r'\section{X}\label{s}\vref{s} \vpageref{s}'
    if k == 'bookmark': body += r'\bookmark[level=1,page=1]{Manual}\section{S}'
    if k == 'fonts-ot2': body += r'\textcyr{Privet}'
    if k == 'ams-fonts-all': body += r'$\mathbb{N}\mathscr{F}\boxtimes\llbracket\rrbracket\mathbbm{1}\Box\Diamond$ \Sun \Moon \Female \Male \smiley'
    if k == 'babel-multi': pass
    D('pkg-' + k, body, pre)

# ------------------------------------------------------------------ the wider TeX Live: graphics, classes, languages
D('x-tikz-basic', r'\begin{tikzpicture}\draw[thick,->] (0,0) -- (3,2) node[above] {A};\draw[red,fill=blue!20] (1,1) circle (0.5);\draw[dashed] (0,0) rectangle (2,2);\node[draw,rounded corners] at (2,-1) {Node};\end{tikzpicture}', r'\usepackage{tikz}')
D('x-tikz-libs', r'\begin{tikzpicture}[>=stealth]\node (a) [draw] {a};\node (b) [draw,right=2cm of a] {b};\draw[->] (a) to[bend left] (b);\draw[decorate,decoration={zigzag}] (0,-1)--(3,-1);\foreach \i in {1,...,5} \fill (\i*0.5,-2) circle (2pt);\shade[ball color=red] (4,0) circle (.4);\end{tikzpicture}', r'\usepackage{tikz}\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing,shadings,fit,backgrounds}')
D('x-tikz-plot', r'\begin{tikzpicture}\draw[domain=0:6.28,smooth,variable=\x,blue] plot ({\x},{sin(\x r)});\draw[->](0,0)--(7,0);\draw[->](0,-1.2)--(0,1.2);\end{tikzpicture}', r'\usepackage{tikz}')
D('x-tikz-errors', r'\begin{tikzpicture}\draw (0,0) -- (1,1;\node at (0,0) {\undefinedmacro};\end{tikzpicture}', r'\usepackage{tikz}')
D('x-pgfplots', r'\begin{tikzpicture}\begin{axis}[xlabel=$x$,ylabel=$y$,grid=major,legend pos=north west]\addplot[blue,mark=*] coordinates {(0,0)(1,1)(2,4)(3,9)};\addplot[red,domain=0:3,samples=30] {x^2+1};\legend{data,fit}\end{axis}\end{tikzpicture}', r'\usepackage{pgfplots}\pgfplotsset{compat=1.18}')
D('x-pgfplots-3d', r'\begin{tikzpicture}\begin{axis}\addplot3[surf,domain=0:1,samples=8]{x*y};\end{axis}\end{tikzpicture}', r'\usepackage{pgfplots}\pgfplotsset{compat=1.18}')
D('x-circuitikz', r'\begin{circuitikz}\draw (0,0) to[R=$R$] (2,0) to[C] (2,2) to[battery] (0,2) -- (0,0);\end{circuitikz}', r'\usepackage{circuitikz}')
D('x-pgf-math', r'\pgfmathsetmacro{\r}{sqrt(2)*3+pi}\r\ \pgfmathparse{int(mod(17,5))}\pgfmathresult\ \pgfmathparse{round(rnd*0)}\pgfmathresult', r'\usepackage{pgf}')
D('x-pgfkeys-foreach', r'\foreach \a/\b in {1/x,2/y,3/z} {\a:\b\ }\pgfkeys{/my/.cd,w/.store in=\w,w=hello}\w', r'\usepackage{pgffor,pgfkeys}')
D('x-beamer-basic', r'\begin{frame}{Title}Hello \alert{beamer}\begin{itemize}\item<1-> one\item<2-> two\end{itemize}\end{frame}\begin{frame}\frametitle{Second}\begin{block}{B}text\end{block}\begin{columns}\column{.5\textwidth}left\column{.5\textwidth}right\end{columns}\end{frame}', cls='beamer')
D('x-beamer-theme', r'\title{T}\author{A}\date{}\begin{frame}\titlepage\end{frame}\section{S}\begin{frame}\tableofcontents\end{frame}\begin{frame}[fragile]\frametitle{Code}\begin{verbatim}x=1\end{verbatim}\end{frame}', r'\usetheme{Madrid}\usecolortheme{beaver}\usepackage{tikz}', cls='beamer')
D('x-beamer-overlays', r'\begin{frame}\only<1>{a}\only<2>{b}\uncover<3->{c}\pause d\pause e\onslide<4>{f}\end{frame}', cls='beamer', clsopt='handout')
D('x-beamer-errors', r'\begin{frame}\frametitle{x}\undefinedcs\begin{itemize}\item\end{frame}', cls='beamer')
D('x-koma-scrartcl', r'\section{A}\subsection{B}' + L(10) + r'\begin{abstract}x\end{abstract}\addtokomafont{section}{\color{red}}', r'\usepackage{xcolor}', cls='scrartcl', clsopt='a4paper,12pt,parskip=half')
D('x-koma-scrreprt', r'\chapter{One}\section{A}' + L(10), cls='scrreprt')
D('x-koma-scrbook', r'\frontmatter\tableofcontents\mainmatter\chapter{One}' + L(10) + r'\backmatter', cls='scrbook', clsopt='BCOR=8mm,DIV=12')
D('x-koma-scrlttr2', r'\setkomavar{fromname}{Me}\begin{letter}{You\\Street}\opening{Dear}' + L(2) + r'\closing{Bye}\end{letter}', cls='scrlttr2')
D('x-memoir', r'\chapter{One}' + L(10) + r'\begin{epigraphs}\qitem{quote}{author}\end{epigraphs}\section{S}' + L(5), cls='memoir', clsopt='12pt,a4paper')
D('x-amsart', r'\title{T}\author{A}\maketitle\begin{abstract}x\end{abstract}\section{S}\begin{theorem}t\end{theorem}\bibliographystyle{amsplain}', r'\newtheorem{theorem}{Theorem}', cls='amsart')
D('x-amsbook', r'\chapter{C}' + L(5), cls='amsbook')
D('x-ieeetran', r'\title{Paper}\author{\IEEEauthorblockN{A}\IEEEauthorblockA{Inst}}\maketitle\begin{abstract}x\end{abstract}\begin{IEEEkeywords}a,b\end{IEEEkeywords}\section{Intro}' + L(10), cls='IEEEtran', clsopt='conference')
D('x-acmart', r'\title{T}\author{A}\affiliation{\institution{I}}\maketitle\section{S}' + L(5), cls='acmart', clsopt='sigconf')
D('x-elsarticle', r'\begin{frontmatter}\title{T}\author{A}\begin{abstract}x\end{abstract}\end{frontmatter}\section{S}' + L(5), cls='elsarticle')
D('x-llncs', r'\title{T}\author{A}\institute{I}\maketitle\begin{abstract}x\end{abstract}\section{S}' + L(5), cls='llncs')
D('x-revtex', r'\title{T}\author{A}\affiliation{I}\maketitle\section{S}' + L(5), cls='revtex4-2')
D('x-siunitx', r'\SI{12.5}{\meter\per\second} \num{1234567.89} \si{\kilogram\metre\squared\per\second\squared} \ang{30.5} \SIlist{1;2;3}{\volt} \SIrange{1}{5}{\kelvin} \num{1.2e-3} \qty{3}{\newton}', r'\usepackage{siunitx}')
D('x-algorithms', r'\begin{algorithm}\caption{A}\begin{algorithmic}[1]\State $x\gets 0$\For{$i=1$ to $n$}\State $x\gets x+i$\EndFor\If{$x>3$}\State done\Else\State more\EndIf\Return $x$\end{algorithmic}\end{algorithm}', r'\usepackage{algorithm,algpseudocode}')
D('x-algorithm2e', r'\begin{algorithm}[H]\KwData{a}\KwResult{b}\While{cond}{do\;\If{x}{y\;}}\caption{Alg}\end{algorithm}', r'\usepackage[ruled,vlined]{algorithm2e}')
D('x-enumitem', r'\begin{enumerate}[label=(\alph*),leftmargin=*,itemsep=0pt]\item a\item b\end{enumerate}\begin{itemize}[label=$\diamond$]\item x\end{itemize}\begin{description}[style=nextline]\item[T] d\end{description}', r'\usepackage{enumitem}')
D('x-multirow-makecell', r'\begin{tabular}{|c|c|}\hline\multirow{2}{*}{A}&b\\\cline{2-2}&c\\\hline\makecell{x\\y}&z\\\hline\end{tabular}', r'\usepackage{multirow,makecell,diagbox}')
D('x-titlesec', r'\section{A}' + L(3) + r'\subsection{B}' + L(3), r'\usepackage{titlesec}\titleformat{\section}{\Large\bfseries\color{blue}}{\thesection}{1em}{}\titlespacing*{\section}{0pt}{2ex}{1ex}\usepackage{xcolor}')
D('x-todonotes', r'Text\todo{note}\todo[inline]{inline note}\missingfigure{fig}\listoftodos', r'\usepackage{todonotes}')
D('x-lipsum-wrapfig', r'\begin{wrapfigure}{r}{4cm}\rule{4cm}{4cm}\caption{c}\end{wrapfigure}\lipsum[1-3]', r'\usepackage{wrapfig,lipsum}')
D('x-tcolorbox', r'\begin{tcolorbox}[colback=blue!5,colframe=blue!50!black,title=T]Content\end{tcolorbox}\tcbset{enhanced}', r'\usepackage[most]{tcolorbox}')
D('x-cleveref', r'\section{A}\label{s}\cref{s} \Cref{s}\begin{equation}\label{e}x\end{equation}\cref{e}', r'\usepackage{amsmath,cleveref}')
D('x-xstring-etoolbox', r'\IfSubStr{abcdef}{cd}{yes}{no}\StrLeft{abcdef}{3}\StrMid{abcdef}{2}{4}\ifstrequal{a}{a}{eq}{ne}\IfBeginWith{abc}{ab}{b}{n}\newcommand{\x}{y}\ifdefempty{\x}{e}{n}', r'\usepackage{xstring,etoolbox}')
D('x-fancyvrb-listings', r'\begin{Verbatim}[frame=single,numbers=left]x=1\end{Verbatim}\begin{lstlisting}[language=Python]def f(x):\n  return x\end{lstlisting}', r'\usepackage{fancyvrb,listings}')
D('x-mhchem', r'\ce{H2O + CO2 -> H2CO3} \ce{^{14}C}', r'\usepackage[version=4]{mhchem}')
D('x-physics-bbm', r'$\bra{a}\ket{b}\braket{a}{b}\dd{x}\dv{f}{x}\mathbbm{1}\mathds{R}$', r'\usepackage{physics,bbm,dsfont}')
D('x-cancel-esint', r'$\cancel{x}\bcancel{y}\xcancel{z}\oiint\iiint$', r'\usepackage{cancel,esint,amsmath}')
D('x-authblk-abstract', r'\title{T}\author[1]{A}\author[2]{B}\affil[1]{X}\affil[2]{Y}\maketitle\begin{abstract}' + L(3) + r'\end{abstract}', r'\usepackage{authblk,abstract}')
D('x-framed-mdframed', r'\begin{framed}text\end{framed}\begin{mdframed}[linecolor=red]md\end{mdframed}', r'\usepackage{framed,mdframed}')
D('x-tabularray', r'\begin{tblr}{colspec={Q[c]Q[r]},hlines}a&b\\c&d\end{tblr}', r'\usepackage{tabularray}')
D('x-adjustbox-eso', r'\adjustbox{width=3cm}{wide text}\adjustbox{angle=30}{rot}\newpage x', r'\usepackage{adjustbox,eso-pic}')
D('x-glossaries', r'\newglossaryentry{a}{name=A,description={d}}\gls{a}\printglossaries', r'\usepackage{glossaries}\makeglossaries')
D('x-biblatex-bibtex', r'\cite{k}\printbibliography', r'\usepackage[backend=bibtex,style=numeric]{biblatex}\addbibresource{refs.bib}', files={'refs.bib': '@book{k,author={A. Author},title={T},year=2000,publisher={P}}'})
D('x-hyperref-pdfpages', r'\includepdf{x.pdf}', r'\usepackage{pdfpages}')
D('x-fonts-kpfonts', r'Text $\alpha+\beta$ \textbf{b}\textit{i}', r'\usepackage{kpfonts}')
D('x-fonts-newtx', r'Text $\alpha+\beta$ \textbf{b}\textit{i}', r'\usepackage{newtxtext,newtxmath}')
D('x-fonts-libertine', r'Text $\alpha+\beta$ \textbf{b}\textit{i}', r'\usepackage{libertine}\usepackage[libertine]{newtxmath}')
D('x-fonts-xcharter', r'Text $\alpha+\beta$ \textbf{b}\textit{i}', r'\usepackage[T1]{fontenc}\usepackage{XCharter}')
D('x-fonts-ebgaramond', r'Text \textbf{b}\textit{i}', r'\usepackage[T1]{fontenc}\usepackage{ebgaramond}')
D('x-fonts-fourier', r'Text $\alpha+\beta$', r'\usepackage{fourier}')
D('x-fonts-mathdesign', r'Text $\alpha+\beta$', r'\usepackage[charter]{mathdesign}')
D('x-fonts-cmsuper', r'\textsc{Small caps} \textit{italic} \texttt{typewriter} Ä Ö Ü ß', r'\usepackage[T1]{fontenc}\usepackage[utf8]{inputenc}')
D('x-fonts-inconsolata', r'\texttt{code 0O1l}', r'\usepackage[T1]{fontenc}\usepackage{inconsolata}')
D('x-fonts-all-sizes', r'\tiny a\scriptsize b\footnotesize c\small d\normalsize e\large f\Large g\LARGE h\huge i\Huge j', r'\usepackage[T1]{fontenc}')
LANGS = {'german': 'Dies ist ein längerer deutscher Text mit Silbentrennung: Donaudampfschifffahrtsgesellschaft, Abfallentsorgungsunternehmen und Kontrollgeräteausrüstungsgegenstände.',
         'ngerman': 'Wiederholungsvorschlag: Rechtschreibreform, Bundesverfassungsgerichtsentscheidung, Zusammenfassungsschwierigkeiten.',
         'french': "Ceci est un texte français très long avec des coupures de mots : anticonstitutionnellement, développement, internationalisation.",
         'spanish': 'Este es un texto español con palabras largas: otorrinolaringología, electroencefalografista, desproporcionadamente.',
         'italian': 'Questo è un testo italiano: precipitevolissimevolmente, costituzionalissimamente, internazionalizzazione.',
         'portuguese': 'Este é um texto português: inconstitucionalissimamente, desenvolvimento, internacionalização.',
         'dutch': 'Dit is een Nederlandse tekst: donateursvergadering, kindercarnavalsoptochtvoorbereidingswerkzaamheden.',
         'polish': 'To jest polski tekst: Chrząszcz brzmi w trzcinie, nieproporcjonalnie, rzeczpospolita.',
         'swedish': 'Detta är en svensk text: nationalekonomiska, kärnkraftsavfallsslutförvaringsplatsen.',
         'czech': 'Toto je český text: nejnezdokumentovatelnější, příliš žluťoučký kůň.',
         'latin': 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt.',
         'finnish': 'Tämä on suomenkielinen teksti: epäjärjestelmällistyttämättömyydelläänsäkään.'}
for lg, text in LANGS.items():
    D('lang-' + lg, r'\selectlanguage{%s}\section{Test}%s %s %s\selectlanguage{english}Back in English.' % (lg, text, text, text), r'\usepackage[T1]{fontenc}\usepackage[utf8]{inputenc}\usepackage[%s,english]{babel}' % lg, clsopt='10pt,twocolumn')
D('lang-russian', r'\selectlanguage{russian}Это длинный русский текст с переносами слов: высокопревосходительства, электрификация, достопримечательность.', r'\usepackage[T2A,T1]{fontenc}\usepackage[utf8]{inputenc}\usepackage[russian,english]{babel}', clsopt='twocolumn')
D('lang-greek-missing', r'x', r'\usepackage[greek]{babel}')
D('lang-babel-shorthands', r'\selectlanguage{french}«~Bonjour~» ; Que voulez-vous ? \og citation \fg{} 1\ier{} 2\ieme{}\selectlanguage{german}"a "o "u "s "ck "`quoted"\textquotesingle', r'\usepackage[T1]{fontenc}\usepackage[french,german,english]{babel}')
D('lang-hyphenation-showhyphens', r'\showhyphens{Donaudampfschifffahrtsgesellschaft}\selectlanguage{ngerman}\showhyphens{Donaudampfschifffahrtsgesellschaft}', r'\usepackage[T1]{fontenc}\usepackage[ngerman,english]{babel}\usepackage{hyphenat}')

# ------------------------------------------------------------------ BibTeX (bibtex.wasm between pdfLaTeX passes)
BIB = r"""@string{jan = "January"}
@string{acm = {ACM Press}}
@book{knuth84, author = {Donald E. Knuth}, title = {The {TeXbook}}, publisher = {Addison-Wesley}, year = 1984, address = {Reading, MA}}
@article{lamport86, author = {Leslie Lamport}, title = {{\LaTeX}: A Document Preparation System}, journal = {Software}, year = {1986}, volume = 1, number = {2}, pages = {10--20}, month = jan}
@inproceedings{conf95, author = {Alice Author and Bob B{\"o}hm and Carol {van der} Berg}, title = {A Conference Paper}, booktitle = {Proc. of the 1st Conf.}, year = 1995, publisher = acm, pages = {1--10}}
@misc{web1, author = {Anon}, title = {Some \emph{Web} Page}, howpublished = {\url{http://example.org}}, year = 2020, note = {Accessed: today}}
@phdthesis{phd, author = {Dee, Dave}, title = {Thesis}, school = {University}, year = 2001}
@techreport{tr, author = {Tee Ar}, title = {Report}, institution = {Inst}, year = 2002, number = {42}}
@incollection{chap, author = {Ch Ap}, title = {Chapter}, booktitle = {The Book}, editor = {Ed Itor}, publisher = {Pub}, year = 2003, pages = {5--9}}
@article{many, author = {A. One and B. Two and C. Three and D. Four and E. Five and F. Six and G. Seven and H. Eight}, title = {Many Authors}, journal = {J.}, year = 2004}
@book{xref, crossref = {knuth84}, title = {Cross referenced}, year = 1985}
@unpublished{unp, author = {U. N. Published}, title = {Not out}, note = {In preparation}}
"""
for st in ['plain', 'unsrt', 'alpha', 'abbrv', 'ieeetr', 'acm', 'siam', 'apalike', 'amsplain', 'amsalpha', 'plainnat', 'abbrvnat', 'unsrtnat', 'nonexistentstyle']:
    nat = st.endswith('nat')
    D('bib-style-' + st, r'\cite{knuth84}\citep{lamport86}\citet{conf95,web1}\nocite{phd,tr,chap,many,xref,unp}' if nat else r'\cite{knuth84} \cite[p.~3]{lamport86} \cite{conf95,web1}\nocite{phd,tr,chap,many,xref,unp}' + '\n\\bibliographystyle{%s}\\bibliography{refs}' % st,
      (r'\usepackage{natbib}' if nat else ''), files={'refs.bib': BIB}) if False else None
    body = (r'\citet{knuth84} \citep{lamport86} \citep[see][p.~3]{conf95,web1}' if nat else r'\cite{knuth84} \cite[p.~3]{lamport86} \cite{conf95,web1}') + r'\nocite{phd,tr,chap,many,xref,unp}' + '\n\\bibliographystyle{%s}\\bibliography{refs}' % st
    D('bib-style-' + st, body, (r'\usepackage{natbib}' if nat else ''), files={'refs.bib': BIB})
D('bib-nocite-all', r'\nocite{*}\bibliographystyle{plain}\bibliography{refs}', files={'refs.bib': BIB})
D('bib-two-files', r'\cite{knuth84,extra}\bibliographystyle{plain}\bibliography{refs,more}', files={'refs.bib': BIB, 'more.bib': '@article{extra, author={X Tra}, title={Extra}, journal={J}, year=2010}'})
D('bib-missing-bib', r'\cite{k}\bibliographystyle{plain}\bibliography{nonexistent}')
D('bib-missing-entry', r'\cite{doesnotexist,knuth84}\bibliographystyle{plain}\bibliography{refs}', files={'refs.bib': BIB})
D('bib-no-cites', r'\bibliographystyle{plain}\bibliography{refs}', files={'refs.bib': BIB})
D('bib-no-style', r'\cite{knuth84}\bibliography{refs}', files={'refs.bib': BIB})
D('bib-bad-entries', r'\nocite{*}\bibliographystyle{plain}\bibliography{bad}', files={'bad.bib': '@article{a, author = {A}, title = {No journal}, year = 2000}\n@book{b, title = "unbalanced {brace"}\n@article{a, author={Dup}, title={Duplicate key}, journal={J}, year=2001}\n@foo{c, x = 1}\n@book{d, author = {D}, title = {T}, publisher = {P}, year = {2000} extra junk}\njunk outside entries\n@comment{ignored}\n@preamble{"\\newcommand{\\noop}[1]{}"}\n@book{e, author = {E}, title = {\\noop{T}itle}, publisher = {P}, year = 2002}'})
D('bib-empty-bib', r'\nocite{*}\bibliographystyle{plain}\bibliography{empty}', files={'empty.bib': ''})
D('bib-utf8', r'\nocite{*}\bibliographystyle{plain}\bibliography{u}', r'\usepackage[utf8]{inputenc}\usepackage[T1]{fontenc}', files={'u.bib': '@book{u1, author = {José Álvarez and Björn Müller}, title = {Über Ästhetik}, publisher = {Verlag}, year = 2000}\n@article{u2, author={你 好}, title={CJK}, journal={J}, year=1}'})
D('bib-many', r'\nocite{*}\bibliographystyle{plain}\bibliography{many}', files={'many.bib': '\n'.join('@article{k%d, author = {Author%d, A.}, title = {Title number %d}, journal = {Journal}, year = %d, volume = %d, pages = {%d--%d}}' % (i, i, i, 1900 + i % 120, i % 30, i, i + 9) for i in range(600))})
D('bib-include-nested-aux', r'\include{ch1}\include{ch2}\bibliographystyle{plain}\bibliography{refs}', files={'refs.bib': BIB, 'ch1.tex': r'\section{One}\cite{knuth84}', 'ch2.tex': r'\section{Two}\cite{lamport86}\cite{conf95}'})
D('bib-user-bst', r'\cite{knuth84}\bibliographystyle{my}\bibliography{refs}', files={'refs.bib': BIB, 'my.bst': 'ENTRY {author title year} {} {}\nFUNCTION {book} { "[" write$ cite$ write$ "]" write$ newline$ }\nREAD\nITERATE {call.type$}\nFUNCTION {begin.bib} {preamble$ write$}\nBEGIN {begin.bib}'})
D('bib-hyperref-cite', r'\cite{knuth84}\citeauthor{lamport86}\bibliographystyle{plain}\bibliography{refs}', r'\usepackage{hyperref}\usepackage{natbib}', files={'refs.bib': BIB})
D('bib-biblatex-backend-bibtex', r'\textcite{knuth84} \parencite{lamport86}\printbibliography', r'\usepackage[backend=bibtex,style=authoryear]{biblatex}\addbibresource{refs.bib}', files={'refs.bib': BIB})
D('bib-biblatex-default-biber', r'\cite{knuth84}\printbibliography', r'\usepackage{biblatex}\addbibresource{refs.bib}', files={'refs.bib': BIB})
D('bib-multibib-missing', r'\cite{a}\bibliographystyle{plain}\bibliography{refs}', r'\usepackage{multibib}', files={'refs.bib': BIB})
D('bib-thebibliography-and-cite-unresolved', r'\cite{a}\cite{b}\begin{thebibliography}{9}\bibitem{a}A.\end{thebibliography}')

# ------------------------------------------------------------------ PDF inclusion (xpdf)
G = r'\usepackage{graphicx}'
for nm, body in {
 'pdfinc-figure': r'\includegraphics[width=5cm]{figure.pdf}',
 'pdfinc-scale-rotate': r'\includegraphics[scale=2]{figure.pdf}\includegraphics[angle=45,width=4cm]{figure.pdf}\includegraphics[trim=20 20 20 20,clip,width=3cm]{figure.pdf}\includegraphics[height=2cm,keepaspectratio]{figure.pdf}',
 'pdfinc-pages': r'\includegraphics[page=1,width=4cm]{multipage.pdf}\includegraphics[page=2,width=4cm]{multipage.pdf}\includegraphics[page=3,width=4cm]{multipage.pdf}\includegraphics[page=9]{multipage.pdf}',
 'pdfinc-pagebox': r'\includegraphics[pagebox=cropbox,width=4cm]{rotated.pdf}\includegraphics[pagebox=mediabox,width=4cm]{rotated.pdf}',
 'pdfinc-rotated': r'\includegraphics[width=4cm]{rotated.pdf}',
 'pdfinc-with-image': r'\includegraphics[width=5cm]{with-image.pdf}',
 'pdfinc-pdftex-made': r'\includegraphics[width=8cm]{pdftex-made.pdf}',
 'pdfinc-transparent': r'\includegraphics[width=5cm]{transparent.pdf}',
 'pdfinc-encrypted': r'\includegraphics{encrypted.pdf}',
 'pdfinc-restricted': r'\includegraphics{restricted.pdf}',
 'pdfinc-truncated': r'\includegraphics{truncated.pdf}',
 'pdfinc-notpdf': r'\includegraphics{notpdf.pdf}',
 'pdfinc-missing': r'\includegraphics{doesnotexist.pdf}',
 'pdfinc-many': ''.join(r'\includegraphics[width=1cm]{figure.pdf}' for _ in range(40)),
 'pdfinc-pdfximage': r'\pdfximage page 2 {multipage.pdf}\pdfrefximage\pdflastximage\ \the\pdflastximagepages\pdfximage{figure.pdf}\pdfrefximage',
 'pdfinc-version': r'\pdfminorversion=3 \includegraphics{pdftex-made.pdf}',
 'pdfinc-errorlevel': r'\pdfinclusionerrorlevel=-1 \includegraphics{pdftex-made.pdf}\pdfinclusionerrorlevel=1 \includegraphics{pdftex-made.pdf}',
 'pdfinc-draft': r'\includegraphics[draft,width=3cm]{figure.pdf}',
 'pdfinc-in-float': r'\begin{figure}\centering\includegraphics[width=\linewidth]{figure.pdf}\caption{PDF figure}\end{figure}\listoffigures',
 'pdfinc-xform': r'\setbox0\hbox{\includegraphics{figure.pdf}}\pdfxform0 \pdfrefxform\pdflastxform',
 'pdfinc-dvi-mode': r'\includegraphics{figure.pdf}',
}.items():
    D(nm, body, G + (r'\pdfoutput=0 ' if nm.endswith('dvi-mode') else ''))

# ------------------------------------------------------------------ pdfTeX primitives
P = r'\begin{document}'
PR = {
 'pdf-compress': r'\pdfcompresslevel=0 \pdfobjcompresslevel=0 x', 'pdf-compress9': r'\pdfcompresslevel=9 \pdfobjcompresslevel=3 x',
 'pdf-minor': r'\pdfminorversion=4 x', 'pdf-minor-late': r'x\pdfminorversion=4 y',
 'pdf-pagesize': r'\pdfpagewidth=10cm \pdfpageheight=5cm \pdfhorigin=0pt \pdfvorigin=0pt x \newpage y',
 'pdf-literal': r'\pdfliteral{q 1 0 0 rg 10 10 100 100 re f Q}\pdfliteral direct{0 0 1 RG 5 w 0 0 m 100 100 l S}\pdfliteral page{}x',
 'pdf-save-matrix': r'\pdfsave\pdfsetmatrix{0.7 0.7 -0.7 0.7}rotated\pdfrestore x',
 'pdf-colorstack': r'\pdfcolorstack\pdfcolorstackinit page {1 0 0 rg}\relax x\pdfcolorstack0 push{0 1 0 rg}green\pdfcolorstack0 pop black',
 'pdf-xform': r'\setbox0\hbox{Form}\pdfxform0 \pdfrefxform\pdflastxform\pdfrefxform\pdflastxform\setbox1\hbox{\pdfrefxform\pdflastxform}\pdfxform attr{/Group <</S /Transparency>>} resources{} 1',
 'pdf-annot': r'\pdfannot width 10pt height 10pt depth 0pt{/Subtype /Text /Contents (note)}x\pdfstartlink attr{/Border[0 0 1]/C[1 0 0]}user{/Subtype/Link/A<</S/URI/URI(http://x.y)>>}link\pdfendlink',
 'pdf-dest-outline': r'\pdfdest name{a}xyz\pdfoutline goto name{a} count 1 {Outline}\pdfoutline goto name{a} {Child}\pdfdest num 3 fit \pdfstartlink goto name{a} text\pdfendlink \pdfstartlink goto num 3 t\pdfendlink',
 'pdf-thread': r'\pdfthread name{t}\pdfstartthread width 5cm height 5cm depth 0pt name{t}x\pdfendthread',
 'pdf-info-catalog': r'\pdfinfo{/Title (T) /Author (A) /Keywords (k) /Custom (c)}\pdfcatalog{/PageMode /UseOutlines}\pdftrailer{/Foo (bar)}x',
 'pdf-adjust': r'\pdfadjustspacing=2 \pdfprotrudechars=2 \lpcode\font`A=100 \rpcode\font`A=200 \efcode\font`A=1000 ' + L(20) + r'\pdfadjustinterwordglue=1 \pdffontexpand\font 20 20 5 autoexpand ' + L(10),
 'pdf-tracing': r'\pdftracingfonts=1 \pdfoutput=1 \tracingonline=1 \showboxbreadth=100 \showboxdepth=100 \tracingoutput=1 \tracingparagraphs=1 \tracingpages=1 \tracinglostchars=1 \tracingcommands=2 ' + L(2),
 'pdf-strings': r'\edef\a{\pdfstrcmp{a}{b}\pdfmdfivesum{abc}\pdfescapestring{(x)}\pdfescapename{a b}\pdfescapehex{xyz}\pdfunescapehex{78797a}}\show\a \edef\b{\pdffilesize{main.tex}\pdffiledump offset 0 length 20{main.tex}}\show\b \edef\c{\pdfmdfivesum file{main.tex}}\show\c',
 'pdf-version-info': r'\edef\a{\the\pdftexversion\pdftexrevision}\show\a \message{\pdftexbanner}\pdfoutput=\pdfoutput\the\pdfoutput',
 'pdf-random': r'\pdfsetrandomseed=42 \message{\the\pdfuniformdeviate100 \the\pdfnormaldeviate \the\pdfrandomseed}\pdfsetrandomseed=42 \message{\the\pdfuniformdeviate100}',
 'pdf-mapline': r'\pdfmapline{+cmr10 CMR10 <cmr10.pfb}\pdfmapfile{+pdftex.map}\pdfmapfile{=pdftex.map}\pdfmapfile{-nonexistent.map}x',
 'pdf-glyph-unicode': r'\input glyphtounicode \pdfgentounicode=1 Text fi ffi \"a',
 'pdf-unicode-bad': r'\pdfgentounicode=1 \pdfglyphtounicode{a}{zz}\pdfglyphtounicode{b}{0041}x',
 'pdf-linkmargin': r'\pdflinkmargin=3pt \pdfstartlink attr{/C[0 1 0]}user{/Subtype/Link/A<</S/URI/URI(u)>>}t\pdfendlink',
 'pdf-pageattr': r'\pdfpageattr{/Rotate 90}\pdfpagesattr{/Foo 1}\pdfpageresources{/ProcSet [/PDF]}\pdfpkresolution=1200 x',
 'pdf-ximage-pdf-missing': r'\pdfximage{missing.pdf}\pdfrefximage\pdflastximage',
 'pdf-draftmode': r'\pdfdraftmode=1 x\newpage y',
 'pdf-nonumber': r'\pdfinclusioncopyfonts=1 \pdfinclusionerrorlevel=-1 \pdfimageresolution=150 \pdfpkmode{ljfour}x',
 'pdf-omitcharset': r'\pdfomitcharset=1 \pdfsuppressptexinfo=-1 x',
 'pdf-pageref': r'\pdfpageref=1 \the\pdflastpage \the\pdfpageref 1 \pdfstartlink thread name{x} a\pdfendlink',
 'pdf-xpos': r'\pdfsavepos x\the\pdflastxpos,\the\pdflastypos \pdfsavepos \the\pdflastxpos',
 'pdf-primitives-names': r'\message{\the\pdfpagewidth\the\pdfpageheight\the\pdfhorigin\the\pdfvorigin\the\pdfdecimaldigits\the\pdfpkresolution\the\pdfoutput}',
 'pdf-dvimode': r'\pdfoutput=0 \special{dvi special}x\newpage y',
 'pdf-dvimode-late': r'x\pdfoutput=0 y',
}
for k, body in PR.items(): D(k, body)

# ------------------------------------------------------------------ e-TeX & low-level macro programming
ET = {
 'etex-numexpr': r'\message{\the\numexpr 7*3+4/2\relax,\the\numexpr(1+2)*(3+4)\relax,\the\dimexpr 1pt*3/4\relax,\the\glueexpr 1pt plus 2fil*2\relax,\the\muexpr 3mu*2\relax,\the\numexpr 2147483647+1\relax}',
 'etex-conditionals': r'\ifdefined\foo no\else yes\fi \ifcsname bar\endcsname a\else b\fi \unless\ifx aa x\else y\fi \ifnum\numexpr 1+1\relax=2 t\fi \ifdim 1pt<2pt t\fi \ifcase 2 a\or b\or c\else d\fi \ifodd 3 o\fi \ifvmode v\fi \ifhmode h\fi \ifmmode m\fi \ifinner i\fi \iftrue T\fi \iffalse\else F\fi',
 'etex-scantokens': r'\everyeof{\noexpand}\edef\a{\scantokens{abc}}\show\a \def\b{\scantokens{\def\c{x}}}\b\show\c \readline16 to \z',
 'etex-detokenize': r'\edef\a{\detokenize{a#b $ ~ \x}}\show\a \edef\b{\unexpanded{\foo#}}\show\b \message{\meaning\a}\protected\def\p{x}\edef\q{\p}\show\q \showtokens{a\b c}',
 'etex-lastlinefit': r'\lastlinefit=500 ' + L(10) + r'\interlinepenalties=3 100 200 300 ' + L(5),
 'etex-marks': r'\marks3{a}\topmarks3\firstmarks3\botmarks3\splitfirstmarks3 \splitbotmarks3 \message{\topmarks3}',
 'etex-interaction': r'\interactionmode=1 \message{\the\interactionmode}\interactionmode=0 \message{\the\interactionmode} \scrollmode \batchmode \nonstopmode \errorstopmode x',
 'etex-lastnode': r'\message{\the\lastnodetype}x\message{\the\lastnodetype}\hskip1pt\message{\the\lastnodetype}\vrule\message{\the\lastnodetype}\par\message{\the\lastnodetype}',
 'etex-groups': r'\begingroup\message{\the\currentgrouplevel,\the\currentgrouptype}{\message{\the\currentgrouplevel,\the\currentgrouptype}}\endgroup\showgroups \hbox{\showgroups}\showifs \iftrue\showifs\fi \message{\the\currentiflevel,\the\currentiftype,\the\currentifbranch}',
 'etex-fontchar': r'\message{\the\fontcharwd\font`A,\the\fontcharht\font`A,\the\fontchardp\font`A,\the\fontcharic\font`A}\message{\fontname\font}\message{\the\fontcharwd\font 255}',
 'etex-gluestretch': r'\skip0=1pt plus 2fil minus 3fill \message{\the\gluestretch\skip0,\the\glueshrink\skip0,\the\gluestretchorder\skip0,\the\glueshrinkorder\skip0,\the\gluetomu\skip0,\the\mutoglue\muexpr 3mu\relax}',
 'etex-tracing': r'\tracingassigns=1 \tracinggroups=1 \tracingifs=1 \tracingscantokens=1 \tracingnesting=2 \tracingcommands=3 \def\a{x}\a \begingroup\endgroup \if aa\fi \showtokens\expandafter{\a} \tracingparagraphs=1 ' + L(2),
 'etex-middle': r'$\left(a\middle|b\middle/c\right)$ \predisplaydirection=1 $$a$$ \TeXXeTstate=1 \beginL a\endL \beginR b\endR \beginR\endR \TeXXeTstate=0',
 'etex-pagediscards': r'\pagediscards \splitdiscards \vsplit0 to 1pt \setbox0\vbox{a\penalty0 b}\setbox1\vsplit0 to 1pt \splitdiscards\pagediscards',
 'etex-regs': r'\count300=5 \dimen4000=3pt \skip32767=1pt \toks32768={} \message{\the\count300,\the\dimen4000}\box32767 \showbox300',
 'etex-ifdefined': r'\def\a{}\ifdefined\a\message{def}\fi\ifcsname relax\endcsname\message{cs}\fi\expandafter\ifx\csname undefinedcs\endcsname\relax\message{rel}\fi\ifcsname undefinedcs\endcsname\else\message{gone}\fi\ifdefined\undefinedcs\else\message{nd}\fi',
 'tex-catcodes': r'\catcode`\@=11 \def\a@b{x}\a@b \catcode`\~=12 ~ \catcode`\~=13 \def~{T}~ \catcode`\#=12 # \catcode`\%=12 % \catcode`\^^M=12 \catcode`\\=12 \catcode`\\=0 \catcode`\{=12 { \catcode`\{=1 \catcode`\&=11 \def\a&{y}\catcode`\ =12 a b \catcode`\ =10',
 'tex-expansion': r'\def\a{\b}\def\b{\c}\def\c{x}\edef\d{\a}\show\d \expandafter\def\expandafter\e\expandafter{\a}\show\e \xdef\f{\string\a}\show\f \csname a\endcsname \expandafter\expandafter\expandafter\show\csname c\endcsname \noexpand\a \the\toks0 \afterassignment\show\count1=3 \aftergroup\a',
 'tex-loops': r'\newcount\i \i=0 \loop\ifnum\i<50 \advance\i by1 \repeat\message{\the\i}\def\r#1{\ifnum#1>0 \expandafter\r\expandafter{\number\numexpr#1-1\relax}\fi}\r{100}',
 'tex-deep-recursion': r'\def\a#1{\a{#1#1}}\a x',
 'tex-infinite-expansion': r'\def\a{\a\a}\a',
 'tex-runaway': r'\def\a#1{x}\a{unclosed ' + L(3),
 'tex-par-in-arg': r'\def\a#1{x}\a{a\par b}\long\def\b#1{y}\b{a\par b}\outer\def\o{}\def\c{\o}',
 'tex-macros-params': r'\def\a#1#2#3#4#5#6#7#8#9{#9#8#7}\a123456789 \def\b#1.#2\end{#2#1}\b x.y\end \def\c#10{} \def\d#2{} \def\e#1{#2} \def\f#1#{\g}\def\g{h}\f{} \newcommand\h[2][d]{#1#2}\h x\h[a]b\renewcommand\i{}\providecommand\j{}\newcommand\j{}',
 'tex-grouping-errors': r'}{{\begin{group}\endgroup\begingroup}\egroup\bgroup\hbox{\par}}\end{document}',
 'tex-boxes': r'\setbox0\hbox{a}\setbox1\vbox{\hbox{b}\hbox{c}}\setbox2\vtop{\hbox{d}\hbox{e}}\copy0\box1\unhcopy0\unhbox0\unvcopy1\unvbox1 \wd0=5pt \ht1=2pt \dp2=1pt \message{\the\wd0\the\ht1\the\dp2}\lower3pt\box2 \raise1pt\hbox{r}\moveleft1pt\vbox{}\vcenter{}\hbox to 3pt{\hss a\hss}\hbox spread 3pt{a\hfil b}\vbox to 3pt{\vss\hbox{x}\vss}\vsplit0 to 1pt',
 'tex-leaders': r'\leaders\hrule\hskip 3cm \cleaders\hbox{a}\hskip3cm \xleaders\hbox{ab}\hskip 3cm\leaders\vrule\vskip 1cm \hrule height 2pt depth 1pt width 3cm \vrule width 1pt height 5pt depth 2pt',
 'tex-penalties': r'\penalty-10000 \penalty10000 \nobreak \break\allowbreak \hyphenpenalty=-10000 \exhyphenpenalty=10000 \linepenalty=-1000 \tolerance=10000 \pretolerance=-1 \emergencystretch=3em \looseness=-1 \hangindent=1cm \hangafter=-2 \parshape 3 1cm 5cm 2cm 4cm 0pt 3cm ' + L(5),
 'tex-halign-valign': r'\halign{#\hfil&\hfil#\cr a&b\cr\noalign{\hrule}cc&dd\cr}\halign to 5cm{#\tabskip=0pt plus 1fil&#\cr x&y\cr}\valign{#\vfil&#\cr \hbox{a}&\hbox{b}\cr}\halign spread 1cm{#&#\cr1\span2\cr\omit x&\omit\cr}',
 'tex-write-read': r'\immediate\openout3=wr.tmp \immediate\write3{line one}\immediate\write3{\string\def\string\x{y}}\immediate\closeout3 \openin4=wr.tmp \read4 to \a \show\a \ifeof4 \else\read4 to \b\show\b\fi \read4 to \c\show\c \ifeof4 \message{eof}\fi\closein4 \input wr.tmp \show\x \immediate\write16{terminal}\immediate\write-1{log only}\immediate\write18{ls}',
 'tex-write-late': r'\write3{deferred \thepage}\openout5=late.tmp \write5{late \the\count0}\closeout5 \shipout\hbox{}',
 'tex-openin-missing': r'\openin5=nonexistent.tex \ifeof5 \message{no file}\fi \read5 to \a \input nonexistent.tex x',
 'tex-input-variants': r'\input{main.aux} \InputIfFileExists{nonexistent}{yes}{no}\IfFileExists{main.tex}{yes}{no}\input main \input{./main} x',
 'tex-endinput': r'\begingroup\endlinechar=-1 \endgroup x \endinput this is ignored',
 'tex-end-early': r'x\end y',
 'tex-stop-with-open-group': r'\begingroup x',
 'tex-missing-end-document': 'x',   # replaced below (no \end{document})
 'tex-tracingall': r'\tracingall \def\a#1{#1}\a{x} \hbox{y} \par ' + L(1),
 'tex-showthe': r'\showthe\count0 \showthe\skip0 \showthe\catcode`\a \show\par \show\relax \showthe\font \showbox0 \show\undefinedcs \showthe\hsize \showthe\year',
 'tex-errors-stream': r'\undefinedcs \relax $ \par } {{} & # ^ _ \foo{ \hbox{ \vrule ## } \end{center} \item \\ \cr \omit \noalign',
 'tex-error-100': ''.join(r'\undefined%d ' % i for i in range(120)),
 'tex-error-context': r'\errorcontextlines=100 \def\a{\b}\def\b{\c}\def\c{\undefined}\a \errorcontextlines=0 \a \errorcontextlines=-1 \a',
 'tex-errmessage': r'\errmessage{custom error} \errhelp{help text} \errmessage{with help} \newcommand\x{\GenericError{}{err}{h}{m}}\x \PackageError{p}{e}{h}\PackageWarning{p}{w}\ClassWarning{c}{w}\@latex@error{x}{y}',
 'tex-warning-line': r'\PackageWarningNoLine{p}{w}\PackageInfo{p}{i}\GenericWarning{}{gw}\typeout{typeout}\message{msg}\wlog{wlog}\@warning{x}',
 'tex-lowercase': r'\lowercase{ABC}\uppercase{def}\lccode`A=`b \lowercase{A}\uccode`b=`Z \uppercase{b}\MakeUppercase{straße}\MakeLowercase{ÄÖ}',
 'tex-string-meaning': r'\def\a{x#1}\message{\meaning\a}\message{\string\a}\message{\meaning a}\message{\meaning\relax}\message{\meaning\hbox}\message{\meaning\count}\message{\meaning\par}\message{\fontname\nullfont}\message{\jobname}\message{\number`\a}\message{\romannumeral 1984}\message{\the\inputlineno}',
 'tex-fontnames': r'\message{\fontname\font}\font\a=cmr10 scaled 2000 \message{\fontname\a}\font\b=cmr10 at 5pt \font\c=cmr10 at 0.5pt \font\d=nonexistentfont \font\e=cmr10 at 2048pt \font\f=cmr10 at -1pt \a x\b y\fontdimen2\a=3pt \message{\the\fontdimen6\a}\hyphenchar\a=`- \skewchar\b=-1 \textfont0=\a',
 'tex-fontdimen-grow': r'\font\a=cmr10 \fontdimen30\a=1pt \message{\the\fontdimen30\a}\font\b=cmr7 \fontdimen30\b=1pt',
 'tex-count-limits': r'\count1=2147483647 \advance\count1 by 1 \count2=-2147483648 \multiply\count2 by -1 \dimen0=16383pt \advance\dimen0 by 1pt \dimen1=16384pt \divide\count1 by 0 \dimen2=1pt \multiply\dimen2 by 100000 \skip0=1pt plus 1fil plus 1fill \count3="7FFFFFFF \count4="80000000 \count5=\'177777777777 \dimen3=1in \message{\the\dimen3,\the\count3}',
 'tex-number-parsing': r'\count0=- - + 3 \count1=`\a \count2="FF \count3=\'77 \dimen0=1.5\dimen0 \dimen1=-.5pt \dimen2=1,5pt \dimen3=1truept \dimen4=1sp \dimen5=3.14159265358979pt \skip0=1pt plus -1fil minus 2.5fill \message{\the\dimen5}\dimen6=1em \dimen7=1ex \dimen8=1mu',
 'tex-ifx-variants': r'\def\a{x}\def\b{x}\ifx\a\b e\fi \let\c\a \ifx\a\c e2\fi \if\a\b e3\fi \ifcat a1 \else n\fi \if aA \else n2\fi \ifnum1<2 l\fi \ifdim1pt=1pt s\fi \ifvoid0 v\fi \ifhbox0 \else nh\fi \ifeof3 e\fi \ifnum1=1 \else\else\fi \fi',
 'tex-unmatched-conditionals': r'\fi \else \or \iftrue \ifnum 1<2 x\fi',
 'tex-nesting-limit': ''.join(r'\iftrue ' for _ in range(200)) + 'x' + ''.join(r'\fi ' for _ in range(200)),
 'tex-group-limit': '{' * 300 + 'x' + '}' * 300,
 'tex-group-limit-over': '{' * 150000 + 'x',
 'tex-long-line': 'a' * 100000,
 'tex-long-line-over': 'a' * 300000,
 'tex-long-macro-name': r'\expandafter\def\csname ' + 'x' * 5000 + r'\endcsname{y}\csname ' + 'x' * 5000 + r'\endcsname',
 'tex-many-macros': ''.join(r'\expandafter\def\csname m%d\endcsname{%d}' % (i, i) for i in range(5000)) + r'\csname m4999\endcsname',
 'tex-token-flood': r'\def\a{\a}\toks0={' + 'x' * 50000 + r'}\edef\b{\the\toks0 \the\toks0}\message{\the\count0}',
 'tex-mem-exhaust': r'\def\a{\setbox0\hbox{\copy0 \copy0 x}\a}\setbox0\hbox{x}\a',
 'tex-box-explosion': r'\setbox0\hbox{x}' + r'\setbox0\hbox{\copy0\copy0}' * 40,
 'tex-save-stack': r'\def\a{\begingroup\count1=1 \a}\a',
 'tex-input-stack': r'\def\a{\input main }\a',
 'tex-nest-bomb': r'\def\a{\hbox\bgroup\a}\a',
 'tex-ligkern-loops': r'\font\a=cmr10 \a AVAVAVAVAV  ffffffffi ' + 'f' * 50 + r'---------',
 'tex-unicode-nontex': 'ÀÉÎÕÜ ñ ß 你好 привет 日本語 😀 \u200b \u00a0 \ufeff x',
 'tex-null-bytes': 'a\x00b\x01c\x7fd\x80e\xff',
 'tex-cr-lf': 'a\r\nb\r\n\r\nc\rd\n\ne',
 'tex-tabs-trailing': 'a\t\tb   \n  \t c   \n\n\n\nd',
 'tex-comment-tricks': 'a%comment\nb %\n c% x\n\n%\n d\\%e',
 'tex-endlinechar': r'\endlinechar=-1 a\par b\endlinechar=`x c\endlinechar=13 d',
 'tex-newlinechar': r'\newlinechar=`\^^J \message{a^^Jb}\immediate\write16{c^^Jd}\newlinechar=-1 \message{a^^Jb}',
 'tex-lccode-sfcode': r'\sfcode`.=3000 a. b\nonfrenchspacing a. b\frenchspacing a. b\sfcode`A=999 A. \spacefactor=2000 x\xspaceskip=5pt \spaceskip=3pt plus 1pt a b',
 'tex-vadjust-insert': r'\vadjust{\kern3pt}\insert100{x}\insert254{y}\insert255{z}\vtop{\hbox{\insert100{a}}}\mark{m}\hbox{\mark{n}\vadjust{q}}',
 'tex-discretionary': r'a\discretionary{x}{y}{z}b\-c\discretionary{}{}{}\hbox{\discretionary{a}{b}{c}}\discretionary{\hbox{}}{\vrule}{}',
 'tex-accent-char': r'\accent`a b \accent"7F x \char"41 \char`\^^M \chardef\a=65 \a \mathchardef\b="0141 $\b$ \delcode`(="028300 \mathcode`a="8000 \delimiter"4162362 $\fam1 a\mathchar"1234$',
 'tex-spaces-in-names': r'\expandafter\def\csname a b\endcsname{x}\csname a b\endcsname \input{"main"} \jobname',
 'tex-immediate-closeout': r'\immediate\write5{no file open}\immediate\closeout5 \immediate\openout5=\jobname.dum \write5{x}\immediate\closeout5 \openout6=.hidden \openout7=../escape \openout8=/tmp/abs.tmp \openout9=sub/dir.tmp',
 'tex-shell-escape': r'\immediate\write18{echo hi}\input|"echo x" \openin3=|"ls" \immediate\openout4=|"cat"',
 'tex-jobname-weird': r'\message{[\jobname]}',
 'tex-time-date': r'\message{\the\time:\the\day.\the\month.\the\year}',
 'tex-everyjob-etc': r'\everypar{E}\everymath{M}\everydisplay{D}\everyhbox{H}\everyvbox{V}\everycr{C}\everyeof{}\errhelp{h}\output={\shipout\box255 \global\advance\count0 1 }x\newpage y\output={\setbox0\box255 \deadcycles=0 }z\newpage',
 'tex-output-routine-bugs': r'\output={x}a\newpage \output={\shipout\box255 \unvbox255}b\newpage \output={\box255}c\newpage \output={\global\setbox1\box255 \deadcycles=0}d\newpage',
 'tex-shipout-box': r'\shipout\hbox{boxed} \shipout\vbox{\hrule width 3cm height 3cm}\shipout\hbox{\vrule width 1pt height 1pt depth 1pt}',
 'tex-special': r'\special{hello}\special{ps: 1 2 3}\write-1{\string\special}\pdfliteral{q Q}',
 'tex-mag': r'\mag=2000 x \mag=100 \mag=0 y',
 'tex-prefixed': r'\global\long\outer\def\a{} \long\let\b=\relax \global\global x \long\count1=2 \protected x \outer x',
 'tex-assign-errors': r'\count300=1 \count-1=2 \dimen256=1pt \box256 \wd256=3pt \catcode`a=16 \catcode256=1 \lccode`a=300 \mathcode`a="8001 \delcode`a=-2 \count1=\relax',
 'tex-hash-errors': r'\def\a#1#3{} \def\b#1{#2} \def\c{#} \def\d#1{##1}\d x \edef\e{#}',
 'tex-let-futurelet': r'\let\a= x \let\b== \futurelet\c\d xy \def\d#1#2{[\meaning#1]}\futurelet\n\show ab',
 'tex-csname-errors': r'\csname\relax\endcsname \csname \hbox\endcsname \csname a\undefinedcs\endcsname \endcsname \expandafter\csname\string\a\endcsname',
 'tex-the-errors': r'\the\relax \the\par \the \the\font \the\toks \the\hbox \number\relax \romannumeral\relax \string',
 'tex-math-char-errors': r'$\mathchar"8000 \fam16 \mathcode`a="7FFF \delimiter"7FFFFFF \radical"7FFFFFF{}\mathaccent"7FFF{}x$ $$ $ \par$$a\halign{#\cr}$$',
 'tex-vsize-zero': r'\vsize=0pt x \newpage \textheight=-1pt y \hsize=0pt a b c \textwidth=0pt \linewidth=0pt abc',
 'tex-hsize-huge': r'\hsize=16383pt x \hsize=20000pt y \hsize=-100pt z',
 'tex-box-dimens-huge': r'\setbox0\hbox to 16383pt{x}\setbox0\hbox to 16384pt{x}\setbox0\hbox to -1pt{x}\setbox0\vbox to 16383pt{}\vskip 16383pt \hskip 16383pt\hskip 16383pt',
 'tex-fil-stretch': r'\hbox to 3cm{a\hskip 0pt plus 1fil\hskip 0pt plus 1fill b\hskip 0pt plus -1fil\hskip 0pt plus 1filll c}\hbox to 3cm{\hskip 0pt plus 1fil minus 1fil}\vbox to 3cm{\vskip 0pt minus 1fil}',
 'tex-parshape-extreme': r'\parshape 100 ' + '1pt 2cm ' * 100 + L(30) + r'\parshape -1 1pt 1pt x \parshape 0 \hangindent -3cm \hangafter -10 ' + L(5),
 'tex-looseness-extreme': r'\looseness=100 ' + L(5) + r'\par\looseness=-100 ' + L(5) + r'\par\tolerance=-5000 \pretolerance=100000 ' + L(10),
 'tex-line-breaking-huge': 'word ' * 20000,   # (runs out of memory at a point that depends on path lengths: log not compared)
 'tex-line-breaking-nobreak': 'a' * 6000 + r'\par\hbox{' + 'b ' * 2000 + '}',
 'tex-math-huge': '$' + '+'.join(['x'] * 3000) + '$',
 'tex-penalty-ranges': r'\penalty2147483647 \penalty-2147483648 \penalty0 \interlinepenalty=10000 \clubpenalty=-10000 \widowpenalty=1 ' + L(10),
 'tex-delimiter-nesting': '$' + r'\left(' * 40 + 'x' + r'\right)' * 40 + '$',
 'tex-math-nesting': '$' + '{' * 100 + 'x' + '}' * 100 + '$' + '$' + 'x^{' * 40 + 'y' + '}' * 40 + '$',
 'tex-fraction-nesting': '$' + r'\frac{1}{' * 30 + 'x' + '}' * 30 + '$',
 'tex-hyphenation-weird': r'\hyphenation{a--b ab-} \hyphenation{\relax} \hyphenation{} \hyphenation{x-x x-x} \hyphenation{éé} \lefthyphenmin=0 \righthyphenmin=9 \uchyph=0 \hyphenchar\font=-1 abcdef \hyphenchar\font=`- \language=0 \language=99 \language=-1 abcdefghijkl',
 'tex-patterns-after-ini': r'\patterns{a1b}\lccode`a=`a x',
 'tex-lastbox-lastskip': r'\setbox0\lastbox\message{\the\lastskip,\the\lastkern,\the\lastpenalty}\hskip1pt\unskip\kern1pt\unkern\penalty1\unpenalty \unskip\unkern\unpenalty \vskip 1pt \unskip',
 'tex-vtop-vcenter': r'\vtop{}\vcenter{}\vtop to 1pt{\vss}\hbox{\vcenter{}}$\vcenter{\hbox{x}}$$$\vcenter{}$$',
 'tex-aligned-eqno': r'$$\halign{#\cr a\cr}\eqno(1)$$ $$\displaylines{a\cr b\cr}$$ $$\eqalign{a&b\cr c&d\cr}\leqno x$$ $$\matrix{a&b\cr}\pmatrix{a}\cases{a&b\cr}$$',
 'tex-uppercase-braces': r'\uppercase{\def\a{x}}\a \uppercase\expandafter{\a} \MakeUppercase{\ae\oe\ss\i\j}',
 'tex-skips-total': r'\baselineskip=-5pt x\par \lineskip=-100pt \lineskiplimit=-1000pt a\par\baselineskip=1000pt b\par',
}
for k, body in ET.items():
    if k == 'tex-line-breaking-huge':
        D(k, body, opts='nolog=1'); continue
    if k == 'tex-missing-end-document':
        RAW(k, '\\documentclass{article}\n\\begin{document}\nx\n'); continue
    D(k, body)

# ------------------------------------------------------------------ plain TeX, ini mode, odd entry points
for i, nm in enumerate(['.hidden', '../escape', '/tmp/abs-out.tmp', 'sub/dir.tmp', 'ok.tmp', './dot.tmp', 'a/../b.tmp', '..', '.', '~/home.tmp', 'noext', 'UPPER.TMP', 'sp ace.tmp', '.tex']):
    D('openout-%d' % i, r'\immediate\openout3=%s \immediate\write3{data}\immediate\closeout3 \openin3=%s \ifeof3 \message{NOREAD}\else\message{READ}\fi \input{%s}' % (nm, nm, nm), r'\usepackage{etoolbox}')
RAW('plain-basic', r'\input plain \hrule\vskip1cm Hello, plain TeX! $$\int_0^1 x\,dx={1\over2}$$ \bye', opts='nofmt=1')
RAW('plain-fonts', r'\input plain \font\big=cmr10 scaled 2000 {\big Big} {\bf bold} {\it italic} {\tt tt} {\sl slanted} $\cal ABC$ $\mit abc$ \bye', opts='nofmt=1')
RAW('plain-tables', r'\input plain \halign{#\hfil&\hfil#\cr a&b\cr\noalign{\hrule}c&d\cr}\settabs 3\columns\+a&b&c\cr \bye', opts='nofmt=1')
RAW('plain-output', r'\input plain \headline={\hfil Head \hfil}\footline={\hfil\folio\hfil}\hsize=3in\parindent=0pt ' + ('Lorem ipsum dolor sit amet. ' * 200) + r'\bye', opts='nofmt=1')
RAW('plain-errors', r'\input plain \undefined $ \hbox{ } \bye', opts='nofmt=1')
RAW('plain-eplain-missing', r'\input eplain \bye', opts='nofmt=1')
RAW('plain-pdf', r'\input plain \pdfoutput=1 \pdfcompresslevel=0 \pdfpagewidth=5cm \pdfpageheight=5cm \shipout\hbox{\vrule height 1cm width 1cm}\bye', opts='nofmt=1')
RAW('plain-etex', r'\input plain \message{\the\numexpr 1+2\relax}\bye', opts='nofmt=1')
RAW('latex-no-document', r'\documentclass{article}' + '\n' + r'\typeout{only preamble}')
RAW('latex-empty-document', r'\documentclass{article}\begin{document}\end{document}')
RAW('latex-empty-file', '')
RAW('latex-only-comment', '% nothing\n')
RAW('latex-begin-twice', r'\documentclass{article}\begin{document}\begin{document}x\end{document}')
RAW('latex-text-before-document', r'\documentclass{article}\usepackage{amsmath} text before\begin{document}x\end{document}')
RAW('latex-content-after-end', r'\documentclass{article}\begin{document}x\end{document} trailing \bye text')
RAW('latex-two-documentclass', r'\documentclass{article}\documentclass{report}\begin{document}x\end{document}')
RAW('latex-preamble-only-cmds', r'\documentclass{article}\begin{document}\usepackage{amsmath}x\end{document}')
RAW('latex-nested-input-depth', r'\documentclass{article}\begin{document}\input{a1}\end{document}', files={f'a{i}.tex': (r'\input{a%d}' % (i + 1) if i < 20 else 'deep end') for i in range(1, 21)})
RAW('latex-input-loop', r'\documentclass{article}\begin{document}\input{loop}\end{document}', files={'loop.tex': r'\input{loop}'})
RAW('latex-input-self', r'\documentclass{article}\begin{document}x\input{main}\end{document}')
RAW('latex-pdfoutput-first-line', '%&pdflatex\n\\documentclass{article}\\begin{document}x\\end{document}')
RAW('latex-first-line-fmt', '%&nonexistentformat\n\\documentclass{article}\\begin{document}x\\end{document}')
RAW('latex-percent-first-line', '%!TEX program = xelatex\n\\documentclass{article}\\begin{document}x\\end{document}')

# ------------------------------------------------------------------ multi-file projects
def project(name, main, files, opts=''):
    RAW(name, main, files=files, opts=opts)
project('proj-input-include', r'\documentclass{article}\usepackage{graphicx}\begin{document}\tableofcontents\include{ch1}\include{ch2}\input{sec/s1}\input{sec/s2.tex}\end{document}',
        {'ch1.tex': r'\section{One}\label{c1}' + L(5), 'ch2.tex': r'\section{Two}\ref{c1}' + L(5), 'sec/s1.tex': 'S1 text', 'sec/s2.tex': 'S2 text'})
project('proj-includeonly', r'\documentclass{article}\includeonly{ch2}\begin{document}\include{ch1}\include{ch2}\include{ch3}\end{document}',
        {'ch1.tex': 'one', 'ch2.tex': r'\section{two}' + L(2), 'ch3.tex': 'three'})
project('proj-include-missing', r'\documentclass{article}\begin{document}\include{nonexistent}\input{nonexistent2}\end{document}', {})
project('proj-local-class', r'\documentclass{myclass}\begin{document}x\end{document}', {'myclass.cls': r'\NeedsTeXFormat{LaTeX2e}\ProvidesClass{myclass}\LoadClass{article}\newcommand\hello{hi}'})
project('proj-local-sty', r'\documentclass{article}\usepackage{mine}\begin{document}\mine\end{document}', {'mine.sty': r'\ProvidesPackage{mine}\newcommand\mine{MINE}'})
project('proj-local-sty-error', r'\documentclass{article}\usepackage{bad}\begin{document}x\end{document}', {'bad.sty': r'\ProvidesPackage{bad}\undefinedmacro \endinput'})
project('proj-override-system', r'\documentclass{article}\usepackage{amsmath}\begin{document}$a$\end{document}', {'amsmath.sty': r'\ProvidesPackage{amsmath}\message{LOCAL amsmath}'})
project('proj-bib-aux', r'\documentclass{article}\begin{document}\cite{k}\bibliographystyle{plain}\bibliography{refs}\end{document}', {'refs.bib': '@book{k,author={A},title={T},year=2000,publisher={P}}', 'main.bbl': r'\begin{thebibliography}{1}\bibitem{k}A. T. P, 2000.\end{thebibliography}'})
project('proj-cfg', r'\documentclass{article}\usepackage{graphicx}\begin{document}x\end{document}', {'graphics.cfg': r'\ProvidesFile{graphics.cfg}\message{LOCAL cfg}'})
project('proj-subdirs-graphics', r'\documentclass{article}\usepackage{graphicx}\graphicspath{{figs/}}\begin{document}\includegraphics{rgb8.png}\includegraphics{figs/rgb8.png}\includegraphics{../x.png}\end{document}', {'figs/readme.txt': 'x'})
project('proj-filename-spaces', r'\documentclass{article}\begin{document}\input{"my file"}\input{my\space file}\end{document}', {'my file.tex': 'spaced'})
project('proj-uppercase-ext', r'\documentclass{article}\begin{document}\input{UP.TEX}\input{lower}\end{document}', {'UP.TEX': 'upper', 'lower.TEX': 'low'})
project('proj-dots', r'\documentclass{article}\begin{document}\input{a.b.c}\input{a.b}\input{.hidden}\end{document}', {'a.b.c.tex': 'abc', 'a.b.tex': 'ab', '.hidden.tex': 'h'})
project('proj-read-data', r'\documentclass{article}\begin{document}\openin1=data.txt \def\go{\ifeof1\else\read1 to\l \l\par\expandafter\go\fi}\go\closein1\end{document}', {'data.txt': 'line1\nline2\n\nline4 {braces}\n%not a comment\n'})
project('proj-csv-readline', r'\documentclass{article}\begin{document}\openin1=d.csv \readline1 to \a \show\a \readline1 to \b \message{\detokenize\expandafter{\b}}\end{document}', {'d.csv': 'a,b,c\n1,2,3\n'})
project('proj-write-then-input', r'\documentclass{article}\begin{document}\immediate\openout1=gen.tex \immediate\write1{Generated \string\textbf{text}}\immediate\closeout1 \input{gen}\input{gen.tex}\end{document}', {})

print(f'{n} corpus documents written to {OUT}')
