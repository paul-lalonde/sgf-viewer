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

        # --- scenario 2: vs engine within a problem file ---
        print("files loaded:", js("document.querySelectorAll('#filelist .entry').length"))
        # open a problem file by clicking it in the browser pane
        js("[...document.querySelectorAll('#filelist .entry')].find(e => e.textContent === 'tsumego/').click()")
        time.sleep(0.5)
        js("[...document.querySelectorAll('#filelist .entry')].find(e => e.textContent === 'gogameguru-easy/').click()")
        time.sleep(0.5)
        js("[...document.querySelectorAll('#filelist .entry')].find(e => e.textContent.endsWith('.sgf')).click()")
        time.sleep(0.8)
        print("file loaded:", js("document.title"))

        # enable vs engine mode
        js("document.getElementById('enginemode').click()")
        time.sleep(0.3)
        print("engine mode active:", js("document.getElementById('enginemode').classList.contains('active')"))
        print("feedback:", js("document.getElementById('feedback').textContent"))
        print("movecount before click:", js("document.getElementById('movecount').textContent"))

        # click tengen on the board canvas
        clicked = js("""
          (() => {
            const c = document.getElementById('board');
            const r = c.getBoundingClientRect();
            const size = 19, cell = r.width / (size + 1.7), origin = cell * 1.35;
            const x = r.left + origin + 9 * cell, y = r.top + origin + 9 * cell;
            c.dispatchEvent(new MouseEvent('click', {clientX: x, clientY: y, bubbles: true}));
            return `dispatched at ${Math.round(x)},${Math.round(y)}`;
          })()
        """)
        print("click:", clicked)
        time.sleep(0.5)
        print("movecount after click:", js("document.getElementById('movecount').textContent"))
        print("feedback after click:", js("document.getElementById('feedback').textContent"))
        time.sleep(4)
        print("movecount after engine:", js("document.getElementById('movecount').textContent"))
        print("feedback after engine:", js("document.getElementById('feedback').textContent"))
        ws.close()
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
