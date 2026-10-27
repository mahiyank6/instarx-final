"""Builds instarx-standalone.html: the real InstaRX site (pages, scripts, styles, images) plus the
real Flask backend, packed into one file that runs in the browser through Pyodide.
Usage:  python tools/build_standalone.py"""
import base64
import json
import mimetypes
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
SERVER = os.path.join(ROOT, "server")
TOOLS = os.path.join(ROOT, "tools")
OUT = os.path.join(ROOT, "instarx-standalone.html")


def read(path, mode="r"):
    if "b" in mode:
        with open(path, mode) as f:
            return f.read()
    with open(path, mode, encoding="utf-8") as f:
        return f.read()


def rewrite_js(src):
    # Pages live in a frame, so real navigation is routed through the shell.
    src = re.sub(r"(?:window\.)?location\.href\s*=\s*([^;]+);", r"__go(\1);", src)
    src = re.sub(r"(?:window\.)?location\.search\b", "__search()", src)
    return src


pages = {n: read(os.path.join(STATIC, n)) for n in sorted(os.listdir(STATIC)) if n.endswith(".html")}
files = {}
for sub in ("css", "js"):
    for n in sorted(os.listdir(os.path.join(STATIC, sub))):
        txt = read(os.path.join(STATIC, sub, n))
        files[sub + "/" + n] = rewrite_js(txt) if sub == "js" else txt

assets = {}
for base in ("img", "media"):
    for dp, _, fns in os.walk(os.path.join(STATIC, base)):
        for fn in fns:
            full = os.path.join(dp, fn)
            rel = "/" + os.path.relpath(full, STATIC).replace(os.sep, "/")
            kind = mimetypes.guess_type(fn)[0] or "application/octet-stream"
            assets[rel] = {"type": kind, "b64": base64.b64encode(read(full, "rb")).decode("ascii")}

py = {n: read(os.path.join(SERVER, n)) for n in ("app.py", "store.py", "seed.py", "images.py", "mailer.py", "images_cache.json")}

pack = {"pages": pages, "files": files, "assets": assets, "py": py, "boot": read(os.path.join(TOOLS, "standalone_boot.py"))}
blob = json.dumps(pack, separators=(",", ":")).replace("</", "<\\/")
shell = read(os.path.join(TOOLS, "standalone_shell.html"))
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(shell.replace("/*__PACK__*/", blob))
print("wrote %s: %.2f MB, %d pages, %d images" % (OUT, os.path.getsize(OUT) / 1e6, len(pages), len(assets)))
