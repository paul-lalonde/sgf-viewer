#!/usr/bin/env python3
"""Serve the SGF viewer plus a JSON directory-listing API.

Usage: python3 serve.py [port]     (default 8000; serves the CWD)
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class ViewerHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/ls":
            rel = parse_qs(url.query).get("path", [""])[0]
            self.send_listing(rel)
        else:
            super().do_GET()

    def send_listing(self, rel):
        root = os.path.abspath(os.getcwd())
        target = os.path.abspath(os.path.join(root, rel.strip("/")))
        if os.path.commonpath([root, target]) != root or not os.path.isdir(target):
            self.send_error(404, "no such directory")
            return
        dirs, files = [], []
        for entry in sorted(os.scandir(target), key=lambda e: e.name.lower()):
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                dirs.append(entry.name)
            elif entry.name.lower().endswith(".sgf"):
                files.append(entry.name)
        rel_out = os.path.relpath(target, root)
        payload = {"path": "" if rel_out == "." else rel_out, "dirs": dirs, "files": files}
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # dev server: never let the browser run stale viewer modules
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the console quiet


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), ViewerHandler)
    print(f"SGF viewer: http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
