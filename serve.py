"""Optional local server for PenPlot Studio.

The app also works by simply double-clicking index.html. Use this if your
browser restricts local files, or to always get the latest files (no caching).

    python serve.py            # serves on http://127.0.0.1:8791 and opens the browser
    python serve.py 9000       # custom port
    python serve.py --no-open  # do not open a browser window
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8791
    open_browser = "--no-open" not in sys.argv
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), NoCacheHandler) as httpd:
        url = "http://127.0.0.1:%d/" % port
        print("PenPlot Studio running at " + url + "  (Ctrl+C to stop)")
        if open_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
