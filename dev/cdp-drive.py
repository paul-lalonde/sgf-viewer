#!/usr/bin/env python3
"""Dev harness: drive the viewer through headless Chrome via CDP.

Reproduces interactive flows that static screenshots can't: enables
vs-engine mode, clicks a board point, and reports what happened.
Usage: python3 dev/cdp-drive.py
"""
import json
import subprocess
import tempfile
import time
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9223  # off the default 9222 to dodge stray instances


def main():
    profile = tempfile.mkdtemp(prefix="cdp-profile-")
    proc = subprocess.Popen(
        [CHROME, "--headless", "--disable-gpu", f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*", f"--user-data-dir={profile}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        page = None
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next((t for t in tabs if t.get("type") == "page"), None)
                if page:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        if not page:
            raise RuntimeError("no page target")
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15)
        mid = [0]

        def cmd(method, **params):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == mid[0]:
                    return msg.get("result", {})
                if msg.get("method") == "Runtime.exceptionThrown":
                    print("PAGE EXCEPTION:", json.dumps(msg["params"])[:400])

        def js(expr):
            r = cmd("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
            if "exceptionDetails" in r:
                return f"JS ERROR: {json.dumps(r['exceptionDetails'])[:300]}"
            return r.get("result", {}).get("value")

        cmd("Runtime.enable")
        cmd("Page.enable")
        cmd("Page.navigate", url="http://127.0.0.1:8000/")
        for _ in range(50):  # wait until the app actually initialized
            if js("document.querySelectorAll('#filelist .entry').length") or 0:
                break
            time.sleep(0.2)
        else:
            print("location:", js("document.location.href"))
            print("body snippet:", js("document.body?.innerHTML.slice(0, 200)"))
            raise RuntimeError("viewer never became ready")

        # --- scenario 1: vs engine with NO file loaded ---
        js("document.getElementById('enginemode').click()")
        time.sleep(0.3)
        print("S1 no-file engine mode:", js("document.getElementById('feedback').textContent"))
        clicked = js("""
          (() => {
            const c = document.getElementById('board');
            const r = c.getBoundingClientRect();
            const size = 19, cell = r.width / (size + 1.7), origin = cell * 1.35;
            c.dispatchEvent(new MouseEvent('click', {
              clientX: r.left + origin + 3 * cell, clientY: r.top + origin + 3 * cell, bubbles: true}));
            return 'ok';
          })()
        """)
        time.sleep(3)
        print("S1 after click + engine:", js("document.getElementById('movecount').textContent"))
        js("document.getElementById('enginemode').click()")  # mode off again
        time.sleep(0.2)

        # --- scenario 2: score estimate on the current position ---
        # (stay on this fresh game so no file-load confirm() can block us)
        js("document.getElementById('scorebtn').click()")
        time.sleep(3)
        print("S2 score active:", js("document.getElementById('scorebtn').classList.contains('active')"))
        print("S2 feedback:", js("document.getElementById('feedback').textContent"))
        import base64
        shot = cmd("Page.captureScreenshot")["data"]
        with open("/tmp/sgf-score.png", "wb") as f:
            f.write(base64.b64decode(shot))
        print("S2 screenshot saved")
        js("document.getElementById('scorebtn').click()")  # toggle off
        time.sleep(0.3)
        print("S2 after toggle off, active:", js("document.getElementById('scorebtn').classList.contains('active')"))

        # --- scenario 3: explore mode (top-3 candidate overlay) ---
        js("document.getElementById('exploremode').click()")
        time.sleep(6)  # analysis engine cold-loads a model on first query
        print("S3 explore active:", js("document.getElementById('exploremode').classList.contains('active')"))
        print("S3 feedback:", js("document.getElementById('feedback').textContent"))
        shot = cmd("Page.captureScreenshot")["data"]
        with open("/tmp/sgf-explore.png", "wb") as f:
            f.write(base64.b64decode(shot))
        print("S3 screenshot saved")
        ws.close()
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
