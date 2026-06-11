#!/usr/bin/env python3
"""Dev harness: drive the Dojo sector-line quiz through headless Chrome.

Loads Dojo/Sector.wgf record 2 (SECTOR LINE TEST — a YA find-all quiz of
endpoint pairs) and exercises the click-two-endpoints flow: arm, wrong
pair, two correct pairs, solved reveal. Assumes `python3 serve.py 8013`
is already running (or pass a port).
Usage: python3 dev/cdp-quiz-test.py [port]
"""
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT = 9224  # off 9222/9223 to dodge stray instances
APP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8013


def main():
    profile = tempfile.mkdtemp(prefix="cdp-profile-")
    proc = subprocess.Popen(
        [CHROME, "--headless", "--disable-gpu", f"--remote-debugging-port={CDP_PORT}",
         "--remote-allow-origins=*", f"--user-data-dir={profile}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        page = None
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
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
        cmd("Page.navigate", url=f"http://127.0.0.1:{APP_PORT}/#Dojo%2FSector.wgf")
        for _ in range(50):
            if js("document.getElementById('recordsel')?.options.length") or 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Sector.wgf never loaded")

        # record 2 (ELEMENTARY SECTOR) holds the SECTOR LINE TEST slide,
        # a YA quiz of endpoint pairs
        js("const s = document.getElementById('recordsel');"
           "s.value = '1'; s.dispatchEvent(new Event('change'))")
        time.sleep(0.3)
        print("record:", js("document.title"))
        hit = js("""
          (() => {
            for (const el of document.querySelectorAll('#tree .oline, #tree .move, #tree .seg')) {
              if (el.textContent.includes('SECTOR LINE TEST')) { el.click(); return el.textContent.slice(0, 40); }
            }
            return null;
          })()
        """)
        time.sleep(0.3)
        print("slide:", hit)

        def click(pt):  # pt like 'aa' — SGF coords
            x, y = ord(pt[0]) - 97, ord(pt[1]) - 97
            return js(f"""
              (() => {{
                const c = document.getElementById('board');
                const r = c.getBoundingClientRect();
                const cell = r.width / (19 + 1.7);
                const ox = (r.width - 18 * cell) / 2;
                c.dispatchEvent(new MouseEvent('click', {{
                  clientX: r.left + ox + {x} * cell,
                  clientY: r.top + ox + {y} * cell, bubbles: true}}));
                return document.getElementById('feedback').textContent;
              }})()
            """)

        print("arm aa:        ", click("aa"))
        print("wrong aa-fk:   ", click("fk"))
        print("arm aa:        ", click("aa"))
        print("pair aa-ml:    ", click("ml"))
        print("arm jd:        ", click("jd"))
        print("pair jd-aa:    ", click("aa"))
        shot = cmd("Page.captureScreenshot")["data"]
        with open("/tmp/sgf-quiz-pairs.png", "wb") as f:
            f.write(base64.b64decode(shot))
        print("screenshot: /tmp/sgf-quiz-pairs.png")

        # GROUSE TEST: a letter-choice quiz ("click the letter G if there
        # is a grouse") — its G/N labels must be visible and clickable.
        hit = js("""
          (() => {
            for (const el of document.querySelectorAll('#tree .oline, #tree .move, #tree .seg')) {
              if (el.textContent.includes('GROUSE TEST') && !el.textContent.includes('ANSWERS')) {
                el.click(); return el.textContent.slice(0, 40);
              }
            }
            return null;
          })()
        """)
        time.sleep(0.3)
        print("slide:", hit)
        print("click letter:  ", click("aa"))
        shot = cmd("Page.captureScreenshot")["data"]
        with open("/tmp/sgf-quiz-grouse.png", "wb") as f:
            f.write(base64.b64decode(shot))
        print("screenshot: /tmp/sgf-quiz-grouse.png")
        ws.close()
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
