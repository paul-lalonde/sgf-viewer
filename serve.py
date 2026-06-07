#!/usr/bin/env python3
"""Serve the SGF viewer plus a JSON directory-listing API and a KataGo
GTP proxy for play mode.

Usage: python3 serve.py [port]     (default 8000; serves the CWD)

Engine discovery (override with env vars):
  KATAGO_BIN    katago binary           (default: `which katago`)
  KATAGO_MODEL  network file            (default: newest kata1*.bin.gz next to the binary)
  KATAGO_CFG    gtp config              (default: gtp_example.cfg next to the binary)
  KATAGO_VISITS playout cap per move    (default: 16)
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class Engine:
    """One persistent KataGo GTP subprocess, serialized by a lock.

    Requests are stateless: each one replays the whole game, so the
    engine can never drift out of sync with the browser.
    """

    def __init__(self):
        binary = os.environ.get("KATAGO_BIN") or shutil.which("katago")
        if not binary:
            raise RuntimeError("katago not found (brew install katago, or set KATAGO_BIN)")
        share = os.path.join(
            os.path.dirname(os.path.dirname(os.path.realpath(binary))), "share", "katago"
        )
        model = os.environ.get("KATAGO_MODEL") or self._newest_model(share)
        config = os.environ.get("KATAGO_CFG") or os.path.join(share, "configs", "gtp_example.cfg")
        visits = os.environ.get("KATAGO_VISITS", "16")
        self.lock = threading.Lock()
        self.proc = subprocess.Popen(
            [binary, "gtp", "-model", model, "-config", config,
             "-override-config", f"maxVisits={visits}"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )

    @staticmethod
    def _newest_model(share):
        models = sorted(glob.glob(os.path.join(share, "kata1*.bin.gz"))) \
            or sorted(glob.glob(os.path.join(share, "*.bin.gz")))
        if not models:
            raise RuntimeError(f"no KataGo model under {share} (set KATAGO_MODEL)")
        return models[-1]

    def cmd(self, line):
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
        lines = []
        while True:
            raw = self.proc.stdout.readline()
            if raw == "":
                raise RuntimeError("engine exited")
            raw = raw.rstrip("\n")
            if raw == "" and lines:
                break
            if raw:
                lines.append(raw)
        if lines[0].startswith("?"):
            raise RuntimeError(f"GTP: {lines[0][1:].strip()} (after: {line})")
        return lines[0][1:].strip()

    def genmove(self, payload):
        with self.lock:
            self.cmd(f"boardsize {int(payload['size'])}")
            self.cmd("clear_board")
            self.cmd(f"komi {float(payload.get('komi', 6.5))}")
            for color, vertex in payload.get("moves", []):
                self.cmd(f"play {color} {vertex}")
            return self.cmd(f"genmove {payload['color']}")


ENGINE = None
ENGINE_INIT = threading.Lock()


def engine():
    global ENGINE
    with ENGINE_INIT:
        if ENGINE is None:
            ENGINE = Engine()
        return ENGINE


class ViewerHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/ls":
            rel = parse_qs(url.query).get("path", [""])[0]
            self.send_listing(rel)
        else:
            super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/engine/move":
            self.engine_move()
            return
        if url.path != "/api/save":
            self.send_error(404)
            return
        rel = parse_qs(url.query).get("path", [""])[0]
        root = os.path.abspath(os.getcwd())
        target = os.path.abspath(os.path.join(root, rel.strip("/")))
        ok = (
            os.path.commonpath([root, target]) == root
            and target.lower().endswith(".sgf")
            and os.path.isdir(os.path.dirname(target))
        )
        if not ok:
            self.send_error(400, "bad save path")
            return
        length = int(self.headers.get("Content-Length", 0))
        with open(target, "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def engine_move(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length))
            move = engine().genmove(payload)
            body = json.dumps({"move": move}).encode()
            status = 200
        except Exception as err:  # surface engine trouble to the UI
            body = json.dumps({"error": str(err)}).encode()
            status = 503
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
