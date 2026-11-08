#!/usr/bin/env python3
"""Static file server with HTTP Range support (python's http.server has none, and the app fetches
the TeX tree from texlive.data with range requests).   usage: serve.py [port] [dir]"""
import http.server, os, re, sys

class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416); return None
        f = open(path, 'rb'); f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        self._range = (start, end)
        return f
    def copyfile(self, src, dst):
        r = getattr(self, '_range', None)
        if r:
            n = r[1] - r[0] + 1
            while n > 0:
                b = src.read(min(65536, n))
                if not b: break
                dst.write(b); n -= len(b)
            self._range = None
        else:
            super().copyfile(src, dst)
    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a): pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(sys.argv[2] if len(sys.argv) > 2 else '.')
http.server.ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
