#!/usr/bin/env python3
"""Serve the SGF viewer plus a JSON directory-listing API and a KataGo
GTP proxy for play mode.

Usage: python3 serve.py [port]     (default 8000; serves the CWD)

Engine discovery (override with env vars):
  KATAGO_BIN         katago binary      (default: `which katago`)
  KATAGO_MODEL       network file       (default: newest kata1*.bin.gz next to the binary)
  KATAGO_HUMAN_MODEL human SL network   (default: ~/.katago/b18c384nbt-humanv0.bin.gz)
  KATAGO_CFG         gtp config         (default: gtp_human5k_example.cfg when the human
                                         model is present, else gtp_example.cfg)
  KATAGO_VISITS      playout cap        (default: config's own value)
  KATAGO_EXPLORE_VISITS  analysis-engine playouts per query (default: 100)

With the human model loaded, /api/engine/move accepts "profile":
"rank_10k" etc. for human-like play at that rank, or "" for maximum
strength.
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


def _newest_model(share):
    models = sorted(glob.glob(os.path.join(share, "kata1*.bin.gz"))) \
        or sorted(glob.glob(os.path.join(share, "*.bin.gz")))
    if not models:
        raise RuntimeError(f"no KataGo model under {share} (set KATAGO_MODEL)")
    return models[-1]


def katago_paths():
    """(binary, share dir, model) for KataGo, honoring env overrides."""
    binary = os.environ.get("KATAGO_BIN") or shutil.which("katago")
    if not binary:
        raise RuntimeError("katago not found (brew install katago, or set KATAGO_BIN)")
    share = os.path.join(
        os.path.dirname(os.path.dirname(os.path.realpath(binary))), "share", "katago"
    )
    model = os.environ.get("KATAGO_MODEL") or _newest_model(share)
    return binary, share, model


class Engine:
    """One persistent KataGo GTP subprocess, serialized by a lock.

    Requests are stateless: each one replays the whole game, so the
    engine can never drift out of sync with the browser.
    """

    def __init__(self):
        binary, share, model = katago_paths()
        human = os.environ.get("KATAGO_HUMAN_MODEL") or os.path.expanduser(
            "~/.katago/b18c384nbt-humanv0.bin.gz"
        )
        self.has_human = os.path.exists(human)
        default_cfg = "gtp_human5k_example.cfg" if self.has_human else "gtp_example.cfg"
        config = os.environ.get("KATAGO_CFG") or os.path.join(share, "configs", default_cfg)
        # no artificial thinking delay; keep KataGo's logs out of the repo
        overrides = ["delayMoveScale=0", "delayMoveMax=0", "logDir=/tmp/katago-gtp-logs"]
        if os.environ.get("KATAGO_VISITS"):
            overrides.append(f"maxVisits={os.environ['KATAGO_VISITS']}")
        args = [binary, "gtp", "-model", model, "-config", config,
                "-override-config", ",".join(overrides)]
        if self.has_human:
            args[4:4] = ["-human-model", human]
        self.lock = threading.Lock()
        self.profile = None  # humanSLProfile currently applied
        self.proc = subprocess.Popen(
            args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )

    def cmd_lines(self, line):
        """Send a GTP command, return its full response as a list of
        non-empty lines (the leading '=' stripped from the first)."""
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
        lines[0] = lines[0][1:].strip()
        return lines

    def cmd(self, line):
        return self.cmd_lines(line)[0]

    def _setup(self, payload):
        self.cmd(f"boardsize {int(payload['size'])}")
        self.cmd("clear_board")
        self.cmd(f"komi {float(payload.get('komi', 6.5))}")
        for color, vertex in payload.get("moves", []):
            self.cmd(f"play {color} {vertex}")

    def genmove(self, payload):
        with self.lock:
            self._apply_profile(payload.get("profile", ""))
            self._setup(payload)
            return self.cmd(f"genmove {payload['color']}")

    # Approximate score + per-point territory from the raw neural net
    # (no search): whiteLead points and a size*size ownership map in
    # [-1, 1], positive = White, in row-major (top-left first) order.
    def score(self, payload):
        with self.lock:
            self._setup(payload)
            tokens = " ".join(self.cmd_lines("kata-raw-nn 0")).split()
        lead = float(tokens[tokens.index("whiteLead") + 1])
        start = tokens.index("whiteOwnership") + 1
        n = int(payload["size"]) ** 2
        ownership = [float(v) for v in tokens[start:start + n]]
        return {"lead": lead, "ownership": ownership}

    # profile "rank_10k" etc. = human-like play at that rank; "" = full
    # strength (the human policy stops choosing the move).
    def _apply_profile(self, profile):
        if profile and not self.has_human:
            raise RuntimeError(
                "human model not found — download b18c384nbt-humanv0.bin.gz "
                "to ~/.katago/ (see README) for rank-calibrated play"
            )
        if not self.has_human or profile == self.profile:
            return
        if profile:
            self.cmd("kata-set-param humanSLChosenMoveProp 1.0")
            self.cmd(f"kata-set-param humanSLProfile {profile}")
        else:
            self.cmd("kata-set-param humanSLChosenMoveProp 0")
        self.profile = profile


class Analysis:
    """One persistent KataGo analysis-engine subprocess (JSON in/out),
    serialized by a lock. Used for candidate-move study (explore mode).
    """

    def __init__(self):
        binary, share, model = katago_paths()
        config = os.environ.get("KATAGO_ANALYSIS_CFG") or os.path.join(
            share, "configs", "analysis_example.cfg"
        )
        visits = os.environ.get("KATAGO_EXPLORE_VISITS", "100")
        self.lock = threading.Lock()
        self.qid = 0
        self.proc = subprocess.Popen(
            [binary, "analysis", "-model", model, "-config", config,
             "-override-config", f"maxVisits={visits},logDir=/tmp/katago-analysis-logs"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )

    # Top candidate moves for the position after payload["moves"], sorted
    # best-first. Returns {currentPlayer, candidates:[{move, scoreLead,
    # winrate, order, pv, visits}]} — scoreLead is White's perspective.
    def candidates(self, payload):
        size = int(payload["size"])
        n_moves = len(payload.get("moves", []))
        query = {
            "id": None,
            "moves": payload.get("moves", []),
            "rules": "japanese",
            "komi": float(payload.get("komi", 6.5)),
            "boardXSize": size,
            "boardYSize": size,
            "analyzeTurns": [n_moves],
            "maxVisits": int(payload.get("visits", os.environ.get("KATAGO_EXPLORE_VISITS", 100))),
        }
        with self.lock:
            self.qid += 1
            query["id"] = f"q{self.qid}"
            self.proc.stdin.write(json.dumps(query) + "\n")
            self.proc.stdin.flush()
            resp = self._read_response(query["id"])
        keep = int(payload.get("maxmoves", 3))
        infos = sorted(resp.get("moveInfos", []), key=lambda m: m["order"])[:keep]
        return {
            "currentPlayer": resp.get("rootInfo", {}).get("currentPlayer"),
            "candidates": [
                {"move": m["move"], "scoreLead": m["scoreLead"], "winrate": m["winrate"],
                 "order": m["order"], "visits": m["visits"], "pv": m.get("pv", [])}
                for m in infos
            ],
        }

    def _read_response(self, qid):
        while True:
            line = self.proc.stdout.readline()
            if line == "":
                raise RuntimeError("analysis engine exited")
            try:
                msg = json.loads(line)
            except ValueError:
                continue  # startup noise / non-JSON
            if msg.get("error") or msg.get("warning"):
                raise RuntimeError(msg.get("error") or msg.get("warning"))
            if msg.get("id") == qid and not msg.get("isDuringSearch"):
                return msg


ENGINE = None
ANALYSIS = None
ENGINE_INIT = threading.Lock()


def engine():
    global ENGINE
    with ENGINE_INIT:
        if ENGINE is None:
            ENGINE = Engine()
        return ENGINE


def analysis():
    global ANALYSIS
    with ENGINE_INIT:
        if ANALYSIS is None:
            ANALYSIS = Analysis()
        return ANALYSIS


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
            self.engine_call(lambda p: {"move": engine().genmove(p)})
            return
        if url.path == "/api/engine/score":
            self.engine_call(lambda p: engine().score(p))
            return
        if url.path == "/api/engine/candidates":
            self.engine_call(lambda p: analysis().candidates(p))
            return
        if url.path != "/api/save":
            self.send_error(404)
            return
        rel = parse_qs(url.query).get("path", [""])[0]
        root = os.path.abspath(os.getcwd())
        target = os.path.abspath(os.path.join(root, rel.strip("/")))
        ok = os.path.commonpath([root, target]) == root and target.lower().endswith(".sgf")
        if not ok:
            self.send_error(400, "bad save path")
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)  # e.g. autosaves/
        length = int(self.headers.get("Content-Length", 0))
        with open(target, "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def engine_call(self, run):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length))
            body = json.dumps(run(payload)).encode()
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
