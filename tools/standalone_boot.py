"""Runs inside Pyodide (Python in the browser). Starts the real InstaRX Flask app and
exposes handle()/dump() to the page. Nothing here touches the network."""
import base64
import io
import json
import os
import sys

os.chdir("/srv/server")
sys.path.insert(0, "/srv/server")

# Pyodide has neither scrypt nor hashlib.pbkdf2_hmac, so supply PBKDF2 (a salted one-way hash)
# in plain Python with fewer rounds to stay quick in the browser.
import hashlib
import hmac as _hmac


def _pbkdf2_hmac(hash_name, password, salt, iterations, dklen=None):
    prf = _hmac.new(password, digestmod=hash_name)
    size = prf.digest_size
    dklen = dklen or size
    out = b""
    block = 1
    while len(out) < dklen:
        h = prf.copy()
        h.update(salt + block.to_bytes(4, "big"))
        u = h.digest()
        acc = int.from_bytes(u, "big")
        for _ in range(iterations - 1):
            h = prf.copy()
            h.update(u)
            u = h.digest()
            acc ^= int.from_bytes(u, "big")
        out += acc.to_bytes(size, "big")
        block += 1
    return out[:dklen]


hashlib.pbkdf2_hmac = _pbkdf2_hmac

import werkzeug.security as _ws  # noqa: E402
_orig_hash = _ws.generate_password_hash


def _gen(password, method="pbkdf2:sha256:20000", salt_length=16):
    return _orig_hash(password, method=method, salt_length=salt_length)


_ws.generate_password_hash = _gen

import seed          # noqa: E402
seed.seed()          # builds the 64-medicine catalogue unless saved data was restored

import app as appmod  # noqa: E402
from store import DATA_FILE  # noqa: E402

client = appmod.app.test_client()
clients = {"main": client}      # extra named sessions are only used by the automated checks
UPLOAD_DIR = appmod.UPLOAD_DIR


def restore_cookie(value):
    if value:
        client.set_cookie("session", value)


def handle(req_json):
    req = json.loads(req_json)
    kw = {"method": req["method"]}
    headers = dict(req.get("headers") or {})
    ctype = headers.pop("Content-Type", None) or headers.pop("content-type", None)
    if req.get("parts") is not None:
        data = {}
        for p in req["parts"]:
            if "file" in p:
                with open(p["file"], "rb") as fh:
                    data[p["name"]] = (io.BytesIO(fh.read()), p["filename"], p["type"])
            else:
                data[p["name"]] = p["value"]
        kw["data"] = data
        kw["content_type"] = "multipart/form-data"
    elif req.get("raw"):
        with open(req["raw"], "rb") as fh:
            kw["data"] = fh.read()
        if ctype:
            kw["content_type"] = ctype
    elif req.get("body") is not None:
        kw["data"] = req["body"]
        if ctype:
            kw["content_type"] = ctype
    kw["headers"] = headers
    sid = req.get("sid") or "main"
    if sid not in clients:
        clients[sid] = appmod.app.test_client()
    resp = clients[sid].open(req["path"], **kw)
    return json.dumps({
        "status": resp.status_code,
        "headers": {k: v for k, v in resp.headers.items()},
        "body": base64.b64encode(resp.get_data()).decode("ascii"),
    })


def dump():
    data = open(DATA_FILE, encoding="utf-8").read() if os.path.exists(DATA_FILE) else None
    uploads = {}
    if os.path.isdir(UPLOAD_DIR):
        for name in os.listdir(UPLOAD_DIR):
            if name != ".gitkeep":
                with open(os.path.join(UPLOAD_DIR, name), "rb") as fh:
                    uploads[name] = base64.b64encode(fh.read()).decode("ascii")
    c = client.get_cookie("session")
    return json.dumps({"data": data, "uploads": uploads, "cookie": c.decoded_value if c else None})
