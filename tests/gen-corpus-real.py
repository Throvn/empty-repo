# Realistic composite documents (executed by gen-corpus.py; uses its D/RAW helpers, L, BIB ...)

def thesis():
    names = ['Introduction', 'Background', 'Method', 'Results', 'Conclusion']
    chapters = {}
    for c in range(1, 6):
        t = '\\chapter{Chapter %d: %s}\\label{ch:%d}\n' % (c, names[c - 1], c)
        for sec in range(1, 4):
            t += '\\section{Section %d.%d}\\label{sec:%d.%d}\n' % (c, sec, c, sec)
            t += L(6) + 'See Section~\\ref{sec:%d.%d} and \\cite{knuth84,lamport86}.\n\n' % (c, max(1, sec - 1))
            t += '\\begin{equation}\\label{eq:%d.%d} \\int_0^{%d} f(x)\\,dx = \\sum_{k=1}^{%d} a_k \\end{equation}\n' % (c, sec, c, sec)
            if sec == 2:
                t += '\\begin{figure}[ht]\\centering\\includegraphics[width=.5\\textwidth]{rgb8.png}\\caption{Figure in chapter %d}\\label{fig:%d}\\end{figure}\n' % (c, c)
                t += '\\begin{table}[ht]\\centering\\caption{Table %d}\\begin{tabular}{lrr}\\toprule A&B&C\\\\\\midrule 1&2&3\\\\4&5&6\\\\\\bottomrule\\end{tabular}\\end{table}\n' % c
            if sec == 3:
                t += '\\begin{theorem}\\label{th:%d} Statement %d with equation~\\eqref{eq:%d.1}.\\end{theorem}\\begin{proof}Trivial.\\end{proof}\n' % (c, c, c)
        t += 'Figure~\\ref{fig:%d} and Theorem~\\ref{th:%d}.\n' % (c, c)
        chapters['ch%d.tex' % c] = t
    main = (
        '\\documentclass[12pt,a4paper,oneside]{report}\n'
        '\\usepackage[T1]{fontenc}\\usepackage[utf8]{inputenc}\\usepackage{lmodern}\n'
        '\\usepackage{amsmath,amssymb,amsthm}\\usepackage{graphicx,booktabs,xcolor,geometry,setspace,fancyhdr}\n'
        '\\usepackage[numbers]{natbib}\\usepackage[colorlinks,linkcolor=blue,citecolor=blue]{hyperref}\n'
        '\\newtheorem{theorem}{Theorem}[chapter]\n'
        '\\pagestyle{fancy}\\onehalfspacing\n'
        '\\title{A Thesis Title}\\author{A. Student}\\date{\\today}\n'
        '\\begin{document}\n\\maketitle\\begin{abstract}' + L(8) + '\\end{abstract}\n'
        '\\tableofcontents\\listoffigures\\listoftables\n'
        '\\include{ch1}\\include{ch2}\\include{ch3}\\include{ch4}\\include{ch5}\n'
        '\\appendix\\chapter{Appendix}' + L(4) + '\n'
        '\\bibliographystyle{plainnat}\\bibliography{refs}\n\\end{document}\n')
    chapters['refs.bib'] = BIB
    return main, chapters

m, f = thesis()
RAW('real-thesis', m, files=f)

RAW('real-paper-ieee', (
    '\\documentclass[conference]{IEEEtran}\n\\usepackage{amsmath,graphicx,cite,booktabs}\n\\begin{document}\n'
    '\\title{A Conference Paper}\\author{\\IEEEauthorblockN{First Author}\\IEEEauthorblockA{Institute}}\\maketitle\n'
    '\\begin{abstract}' + L(5) + '\\end{abstract}\n'
    '\\section{Introduction}' + L(10) + '\\cite{knuth84}\n'
    '\\section{Method}\\begin{equation}E=mc^2\\end{equation}' + L(10) + '\n'
    '\\begin{figure}[t]\\centering\\includegraphics[width=\\columnwidth]{figure.pdf}\\caption{A figure}\\end{figure}\n'
    '\\begin{table}[t]\\caption{T}\\centering\\begin{tabular}{ll}\\toprule a&b\\\\\\bottomrule\\end{tabular}\\end{table}\n'
    '\\section{Results}' + L(20) + '\n\\bibliographystyle{IEEEtran}\\bibliography{refs}\n\\end{document}\n'),
    files={'refs.bib': BIB})

RAW('real-beamer-talk', (
    '\\documentclass{beamer}\n\\usetheme{Madrid}\\usepackage{tikz}\\usepackage{amsmath}\n'
    '\\title{Talk}\\author{Me}\\institute{Uni}\\date{\\today}\n\\begin{document}\n'
    '\\begin{frame}\\titlepage\\end{frame}\n\\begin{frame}{Outline}\\tableofcontents\\end{frame}\n'
    '\\section{Motivation}\n\\begin{frame}{Why}\\begin{itemize}[<+->]\\item First\\item Second \\item Third\\end{itemize}\\end{frame}\n'
    '\\section{Method}\n\\begin{frame}{Equation}\\begin{align}a&=b\\\\c&=d\\end{align}\\end{frame}\n'
    '\\begin{frame}{Figure}\\begin{tikzpicture}\\draw[thick,->](0,0)--(3,2);\\node at (3,2) {x};\\end{tikzpicture}\\\\ \\includegraphics[width=3cm]{figure.pdf}\\end{frame}\n'
    '\\begin{frame}[fragile]{Code}\\begin{verbatim}int main() {}\\end{verbatim}\\end{frame}\n'
    '\\begin{frame}{References}\\cite{knuth84}\\bibliographystyle{plain}\\bibliography{refs}\\end{frame}\n\\end{document}\n'),
    files={'refs.bib': BIB})

RAW('real-koma-report', (
    '\\documentclass[a4paper,11pt]{scrreprt}\n'
    '\\usepackage[ngerman]{babel}\\usepackage[T1]{fontenc}\\usepackage[utf8]{inputenc}\\usepackage{csquotes,graphicx,booktabs}\n'
    '\\begin{document}\n\\tableofcontents\n\\chapter{Einleitung}\\section{Motivation}'
    + 'Dies ist ein längerer deutscher Text mit Silbentrennung: Donaudampfschifffahrtsgesellschaft und Geschwindigkeitsbegrenzung. ' * 6 +
    '\n\\begin{table}[h]\\centering\\caption{Tabelle}\\begin{tabular}{ll}\\toprule a&b\\\\\\bottomrule\\end{tabular}\\end{table}\n'
    '\\chapter{Methoden}\\section{Daten}\\includegraphics[width=.4\\textwidth]{rgba8.png}\n\\end{document}\n'))

RAW('real-cv', (
    '\\documentclass[11pt]{article}\n\\usepackage[margin=2cm]{geometry}\\usepackage{enumitem,hyperref,xcolor,titlesec}\n'
    '\\titleformat{\\section}{\\large\\bfseries\\color{blue}}{}{0pt}{}[\\titlerule]\n\\begin{document}\n'
    '\\begin{center}{\\LARGE\\bfseries Jane Doe}\\\\ jane@example.org \\quad \\url{https://example.org}\\end{center}\n'
    '\\section{Experience}\\begin{itemize}[leftmargin=*,itemsep=2pt]\\item \\textbf{Engineer} -- Company, 2020--now \\hfill City\\item \\textbf{Intern} -- Other, 2019\\end{itemize}\n'
    '\\section{Education}\\textbf{M.Sc.} University \\hfill 2020\n\\end{document}\n'))

RAW('real-math-notes', (
    '\\documentclass[a4paper,11pt]{amsart}\n\\usepackage{amsmath,amssymb,mathtools,cleveref,enumitem}\n'
    '\\newtheorem{theorem}{Theorem}[section]\\newtheorem{lemma}[theorem]{Lemma}\\theoremstyle{definition}\\newtheorem{definition}[theorem]{Definition}\n'
    '\\DeclareMathOperator{\\Hom}{Hom}\n\\begin{document}\n\\title{Notes}\\author{A}\\maketitle\n'
    '\\section{Setup}\\begin{definition}Let $X$ be a space and $\\Hom(X,Y)$ the morphisms.\\end{definition}\n'
    '\\begin{lemma}\\label{l:a}For all $n\\in\\mathbb{N}$: $\\sum_{k=0}^n\\binom{n}{k}=2^n$.\\end{lemma}\n'
    '\\begin{proof}Induction. \\qedhere\\end{proof}\n'
    '\\begin{theorem}\\label{t:b} By \\cref{l:a}, \\begin{align}\\int_0^1 x^n\\,dx &= \\frac1{n+1},\\\\ \\prod_{p}\\frac{1}{1-p^{-s}} &= \\zeta(s).\\end{align}\\end{theorem}\n'
    '\\begin{enumerate}[label=(\\roman*)]\\item one\\item two\\end{enumerate}\n\\end{document}\n'))

RAW('real-longtable-report', (
    '\\documentclass[a4paper]{article}\n\\usepackage{longtable,booktabs,array,multicol,lastpage,fancyhdr}\n\\pagestyle{fancy}\\cfoot{\\thepage}\n\\begin{document}\n'
    '\\begin{longtable}{@{}rlp{6cm}@{}}\\toprule N&Name&Description\\\\\\midrule\\endhead\n'
    + ''.join('%d&Item %d&%s\\\\\n' % (i, i, L(1)) for i in range(150)) +
    '\\bottomrule\\end{longtable}\n\\begin{multicols}{2}' + L(60) + '\\end{multicols}\n\\end{document}\n'))
