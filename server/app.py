import hmac
import os
import random
import re
import secrets
from datetime import timedelta
from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from store import read, write, next_id, now, haversine_km
from images import get_image_cache, pick_image
from mailer import send_code, SMTP_READY

BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", "instarx-university-project-demo-secret")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# "Remember me" keeps the session cookie alive for 30 days; without it the
# cookie lasts only until the browser closes.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
# Prescription photos from phones run 2-8 MB; 10 MB plus form overhead.
RX_MAX_MB = 10
app.config["MAX_CONTENT_LENGTH"] = RX_MAX_MB * 1024 * 1024 + 512 * 1024

IMAGE_CACHE = get_image_cache()


@app.after_request
def no_stale_pages(resp):
    # Pages, scripts and styles change while the project is being built, and a
    # browser holding an old copy shows features that silently don't work.
    # Photos under /media/ and uploads are left cacheable.
    if request.path == "/" or request.path.endswith((".html", ".js", ".css", ".webmanifest")):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(413)
def too_large(_e):
    return jsonify({"error": f"That file is too big. Please send one under {RX_MAX_MB} MB."}), 413


def with_image(m):
    return {**m, "image": pick_image(IMAGE_CACHE, m["category"], m["id"])}


# ---------- static frontend ----------

@app.route("/")
def home():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    full = os.path.join(STATIC_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(STATIC_DIR, path)
    # fall back to index for unknown frontend routes (none used currently)
    return send_from_directory(STATIC_DIR, "index.html")


# ---------- helpers ----------

def current_user(data):
    uid = session.get("user_id")
    if not uid:
        return None
    return next((u for u in data["users"] if u["id"] == uid), None)


def public_user(u):
    return {
        "id": u["id"], "role": u["role"], "name": u["name"], "email": u["email"],
        "phone": u.get("phone"), "verified": bool(u.get("verified")),
    }


def order_public(o, data, include_otp=False):
    chemist_name = None
    chemist_location = None
    if o.get("chemist_id"):
        c = next((u for u in data["users"] if u["id"] == o["chemist_id"]), None)
        chemist_name = c["name"] if c else None
        cc = next((c for c in data["chemists"] if c["user_id"] == o["chemist_id"]), None)
        if cc and cc.get("lat") is not None:
            chemist_location = {"lat": cc["lat"], "lng": cc["lng"], "address": cc.get("address")}
    out = {**o, "chemist_name": chemist_name, "chemist_location": chemist_location}
    if not include_otp:
        out.pop("otp", None)
    return out


# ---------- auth ----------

CODE_TTL_SECONDS = 15 * 60       # verification codes expire after 15 minutes
MAX_FAILED_LOGINS = 5            # then the account locks briefly
LOCKOUT_SECONDS = 15 * 60
RESEND_COOLDOWN = 60             # seconds between code resends
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def new_code():
    return f"{secrets.randbelow(1000000):06d}"


def password_problem(pw):
    """Returns a human message if the password is too weak, else None."""
    if len(pw) < 8:
        return "Password must be at least 8 characters"
    if pw.isdigit() or pw.isalpha():
        return "Password must mix letters and numbers"
    if pw.lower() in {"password", "12345678", "instarx1", "qwerty123"}:
        return "That password is too common, pick another"
    return None


def issue_code(user, purpose):
    """Stamps a fresh code on the user dict and emails it. Returns dev code."""
    code = new_code()
    user["verify_code_hash"] = generate_password_hash(code)
    user["verify_expires"] = now() + CODE_TTL_SECONDS
    user["verify_sent_at"] = now()
    user["verify_purpose"] = purpose
    _, dev_code = send_code(user["email"], user["name"], code, purpose)
    return dev_code


@app.route("/api/signup", methods=["POST"])
def signup():
    body = request.get_json(force=True)
    role = body.get("role")
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    phone = (body.get("phone") or "").strip()

    if role not in ("customer", "chemist"):
        return jsonify({"error": "Invalid role"}), 400
    if not name:
        return jsonify({"error": "Please enter your name"}), 400
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Enter a valid email address"}), 400
    weak = password_problem(password)
    if weak:
        return jsonify({"error": weak}), 400

    def mutate(data):
        existing = next((u for u in data["users"] if u["email"] == email), None)
        if existing:
            if existing.get("verified"):
                return {"error": "An account with this email already exists"}
            # Unverified signup being retried - refresh it rather than block.
            existing["name"] = name
            existing["role"] = role
            existing["password_hash"] = generate_password_hash(password)
            existing["phone"] = phone
            dev = issue_code(existing, "signup")
            return {"user": existing, "dev_code": dev, "resumed": True}

        uid = next_id(data, "user")
        user = {
            "id": uid, "role": role, "name": name, "email": email,
            "password_hash": generate_password_hash(password),
            "phone": phone, "created_at": now(),
            "verified": False,
            "failed_logins": 0,
            "locked_until": 0,
        }
        dev = issue_code(user, "signup")
        data["users"].append(user)
        if role == "chemist":
            data["chemists"].append({
                "user_id": uid,
                "shop_name": body.get("shop_name") or name,
                "license_no": body.get("license_no") or "",
                "address": body.get("address") or "",
                "lat": body.get("lat"),
                "lng": body.get("lng"),
                "online": False,
                "commission_pct": 8,
            })
        return {"user": user, "dev_code": dev}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 409
    # No session yet - the account is not usable until the email is verified.
    return jsonify({
        "pending_verification": True,
        "email": email,
        "dev_code": result.get("dev_code"),
        "smtp_configured": SMTP_READY,
    })


@app.route("/api/verify", methods=["POST"])
def verify_email():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()

    def mutate(data):
        user = next((u for u in data["users"] if u["email"] == email), None)
        if not user:
            return {"error": "No account found for that email"}
        if user.get("verified"):
            return {"user": user, "already": True}
        if not user.get("verify_code_hash"):
            return {"error": "No code outstanding - request a new one"}
        if now() > user.get("verify_expires", 0):
            return {"error": "That code has expired - request a new one"}
        if not check_password_hash(user["verify_code_hash"], code):
            return {"error": "Incorrect code"}
        user["verified"] = True
        user["verified_at"] = now()
        for k in ("verify_code_hash", "verify_expires", "verify_sent_at", "verify_purpose"):
            user.pop(k, None)
        return {"user": user}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 400
    session["user_id"] = result["user"]["id"]
    session.permanent = True
    return jsonify({"user": public_user(result["user"])})


@app.route("/api/resend-code", methods=["POST"])
def resend_code():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()

    def mutate(data):
        user = next((u for u in data["users"] if u["email"] == email), None)
        if not user:
            return {"error": "No account found for that email"}
        if user.get("verified"):
            return {"error": "That email is already verified - just log in"}
        waited = now() - user.get("verify_sent_at", 0)
        if waited < RESEND_COOLDOWN:
            return {"error": f"Please wait {RESEND_COOLDOWN - waited}s before asking for another code"}
        dev = issue_code(user, "signup")
        return {"ok": True, "dev_code": dev}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 429
    return jsonify({**result, "smtp_configured": SMTP_READY})


@app.route("/api/login", methods=["POST"])
def login():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    remember = bool(body.get("remember"))

    def mutate(data):
        user = next((u for u in data["users"] if u["email"] == email), None)
        # Same generic message whether the email exists or not, so the form
        # cannot be used to discover which emails are registered.
        if not user:
            return {"error": "Invalid email or password"}

        locked_for = user.get("locked_until", 0) - now()
        if locked_for > 0:
            mins = -(-locked_for // 60)          # ceiling division
            return {"error": f"Too many failed attempts. Try again in {mins} minute(s)."}

        if not check_password_hash(user["password_hash"], password):
            user["failed_logins"] = user.get("failed_logins", 0) + 1
            left = MAX_FAILED_LOGINS - user["failed_logins"]
            if user["failed_logins"] >= MAX_FAILED_LOGINS:
                user["locked_until"] = now() + LOCKOUT_SECONDS
                user["failed_logins"] = 0
                return {"error": "Too many failed attempts. This account is locked for 15 minutes."}
            return {"error": f"Invalid email or password ({left} attempt(s) left)"}

        user["failed_logins"] = 0
        user["locked_until"] = 0

        if not user.get("verified"):
            dev = issue_code(user, "signup")
            return {"needs_verification": True, "email": user["email"], "dev_code": dev}

        return {"user": user}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 401
    if result.get("needs_verification"):
        return jsonify({
            "pending_verification": True,
            "email": result["email"],
            "dev_code": result.get("dev_code"),
            "smtp_configured": SMTP_READY,
        }), 403

    session["user_id"] = result["user"]["id"]
    session.permanent = bool(remember)
    return jsonify({"user": public_user(result["user"])})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    data = read()
    user = current_user(data)
    if not user:
        return jsonify({"user": None})
    resp = {"user": public_user(user)}
    if user["role"] == "chemist":
        c = next((c for c in data["chemists"] if c["user_id"] == user["id"]), None)
        resp["chemist"] = c
    return jsonify(resp)


# ---------- catalog ----------

@app.route("/api/categories")
def categories():
    data = read()
    cats = []
    seen = set()
    for m in data["medicines"]:
        if m["category"] not in seen:
            seen.add(m["category"])
            cats.append({"name": m["category"], "icon": m["icon"]})
    return jsonify({"categories": cats})


@app.route("/api/concerns")
def concerns():
    """Quick Select rail - health concerns, ordered as defined in seed.py."""
    from seed import CONCERNS
    data = read()
    counts = {}
    for m in data["medicines"]:
        if m.get("concern"):
            counts[m["concern"]] = counts.get(m["concern"], 0) + 1
    return jsonify({"concerns": [
        {"name": name, "icon": icon, "count": counts.get(name, 0)}
        for name, icon in CONCERNS if counts.get(name)
    ]})


@app.route("/api/medicines")
def medicines():
    q = (request.args.get("q") or "").strip().lower()
    category = request.args.get("category")
    concern = request.args.get("concern")
    popular = request.args.get("popular")
    limit = request.args.get("limit")
    data = read()
    items = data["medicines"]
    if q:
        items = [m for m in items if q in m["name"].lower() or q in m["brand"].lower()
                 or q in m["category"].lower() or q in (m.get("concern") or "").lower()]
    if category:
        items = [m for m in items if m["category"] == category]
    if concern:
        items = [m for m in items if m.get("concern") == concern]
    if popular == "1":
        items = [m for m in items if m["popular"]]
    if limit:
        try:
            items = items[: int(limit)]
        except ValueError:
            pass
    return jsonify({"medicines": [with_image(m) for m in items]})


@app.route("/api/medicines/<int:mid>")
def medicine_detail(mid):
    data = read()
    m = next((m for m in data["medicines"] if m["id"] == mid), None)
    if not m:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"medicine": with_image(m)})


# ---------- cart ----------

@app.route("/api/cart", methods=["GET"])
def get_cart():
    data = read()
    user = current_user(data)
    if not user:
        return jsonify({"error": "Login required"}), 401
    cart = data["carts"].get(str(user["id"]), [])
    by_id = {m["id"]: m for m in data["medicines"]}
    items = []
    total = 0
    for line in cart:
        m = by_id.get(line["medicine_id"])
        if not m:
            continue
        subtotal = m["price"] * line["qty"]
        total += subtotal
        items.append({"medicine": with_image(m), "qty": line["qty"], "subtotal": subtotal})
    return jsonify({"items": items, "total": total})


@app.route("/api/cart", methods=["POST"])
def add_to_cart():
    body = request.get_json(force=True)
    mid = body.get("medicine_id")
    qty = int(body.get("qty", 1))

    def mutate(data):
        user = current_user(data)
        if not user:
            return {"error": "Login required"}
        key = str(user["id"])
        cart = data["carts"].setdefault(key, [])
        line = next((l for l in cart if l["medicine_id"] == mid), None)
        if line:
            line["qty"] = max(1, line["qty"] + qty)
        else:
            cart.append({"medicine_id": mid, "qty": max(1, qty)})
        return {"ok": True}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 401
    return jsonify(result)


@app.route("/api/cart/<int:mid>", methods=["DELETE"])
def remove_from_cart(mid):
    def mutate(data):
        user = current_user(data)
        if not user:
            return {"error": "Login required"}
        key = str(user["id"])
        cart = data["carts"].get(key, [])
        data["carts"][key] = [l for l in cart if l["medicine_id"] != mid]
        return {"ok": True}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 401
    return jsonify(result)


# ---------- prescriptions: customer <-> chemist chat ----------
#
# The customer sends a photo or PDF of a prescription. The nearest online
# chemists are notified; the first to open it claims it, marks each medicine in
# or out of stock and replies. The customer then buys what is available (that
# creates an order, already accepted by the same chemist) or says no. No order
# exists until the chemist has priced it, so prescription orders can't go out
# at Rs 0 any more.

RX_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".pdf"}
RX_CLAIM_SECONDS = 10 * 60      # opened but unanswered for this long: other chemists may take it
RX_MAX_QTY = 20
RX_MAX_ITEMS = 30
RX_MAX_OPEN_PER_CUSTOMER = 5
RX_OPEN = ("new", "reviewing", "awaiting_customer")


def nearby_chemist_ids(data, address):
    """Up to six nearest online chemists. An empty list means every chemist sees it."""
    lat, lng = (address or {}).get("lat"), (address or {}).get("lng")
    if lat is None or lng is None:
        return []
    nearby = []
    for c in data["chemists"]:
        if not c.get("online") or c.get("lat") is None:
            continue
        nearby.append((haversine_km(lat, lng, c["lat"], c["lng"]), c["user_id"]))
    nearby.sort(key=lambda x: x[0])
    return [uid for _, uid in nearby[:6]]


def _join_names(items):
    names = [i["name"] for i in items]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def rx_reply(items):
    """(kind, text) the customer receives. Wording as agreed for the project."""
    avail = [i for i in items if i["in_stock"]]
    out = [i for i in items if not i["in_stock"]]
    if not avail:
        return "none", "Medicine not available. We are sorry for the inconvenience."
    if not out:
        n = len(avail)
        what = "your medicine is" if n == 1 else "both medicines are" if n == 2 else f"all {n} medicines are"
        return "all", f"Good news, {what} available."
    return "partial", (f"{_join_names(avail)} {'are' if len(avail) > 1 else 'is'} available but "
                       f"{_join_names(out)} {'are' if len(out) > 1 else 'is'} out of stock. "
                       "Would you like to buy the available stock?")


def rx_claim_active(r):
    if not r.get("chemist_id"):
        return False
    if r["status"] != "reviewing":
        return True             # replied or finished: it belongs to that chemist for good
    return now() - (r.get("claimed_at") or 0) < RX_CLAIM_SECONDS


def rx_visible_to(r, chemist_id):
    if r.get("chemist_id") == chemist_id:
        return True
    if rx_claim_active(r):
        return False
    return r["status"] in ("new", "reviewing") and (
        not r["notified_chemists"] or chemist_id in r["notified_chemists"])


def rx_public(r, data, for_customer=False):
    shop = None
    if r.get("chemist_id"):
        c = next((c for c in data["chemists"] if c["user_id"] == r["chemist_id"]), None)
        shop = c["shop_name"] if c else None
    out = {**r, "shop_name": shop, "file_url": f"/uploads/{r['file']}",
           "available_total": sum(i["price"] * i["qty"] for i in r["items"] if i["in_stock"])}
    if for_customer:
        out.pop("notified_chemists", None)
        out.pop("claimed_at", None)
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    # Prescriptions are health records: only the customer who sent one and the
    # chemists it was sent to may open it.
    data = read()
    user = current_user(data)
    if not user:
        return jsonify({"error": "Login required"}), 401
    allowed = False
    r = next((r for r in data["rx_requests"] if r["file"] == filename), None)
    if r:
        if user["role"] == "customer":
            allowed = r["customer_id"] == user["id"]
        else:
            # A cancelled prescription is withdrawn: chemists lose access to the file.
            allowed = r["status"] != "closed_cancelled" and rx_visible_to(r, user["id"])
    else:
        o = next((o for o in data["orders"] if o.get("prescription_file") == filename), None)
        if o:
            if user["role"] == "customer":
                allowed = o["customer_id"] == user["id"]
            else:
                allowed = o.get("chemist_id") == user["id"] or (
                    o["status"] == "pending" and (not o["notified_chemists"] or user["id"] in o["notified_chemists"]))
    if not allowed:
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/rx-requests", methods=["POST"])
def rx_create():
    data0 = read()
    user = current_user(data0)
    if not user or user["role"] != "customer":
        return jsonify({"error": "Log in as a customer to send a prescription"}), 401
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "Choose a photo or PDF of your prescription"}), 400
    shown_name = secure_filename(f.filename) or "prescription"
    ext = os.path.splitext(shown_name)[1].lower()
    if ext not in RX_EXTENSIONS:
        return jsonify({"error": "Send a photo (JPG, PNG, WEBP or HEIC) or a PDF"}), 400
    open_count = sum(1 for r in data0["rx_requests"] if r["customer_id"] == user["id"] and r["status"] in RX_OPEN)
    if open_count >= RX_MAX_OPEN_PER_CUSTOMER:
        return jsonify({"error": "You already have several prescriptions waiting. Please wait for a reply first."}), 429

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    # Random part so a stored file name can't be guessed.
    stored = f"{now()}_{user['id']}_{secrets.token_hex(6)}{ext}"
    f.save(os.path.join(UPLOAD_DIR, stored))

    address = {"lat": _num(request.form.get("lat")), "lng": _num(request.form.get("lng")),
               "label": (request.form.get("label") or "")[:300]}
    if address["lat"] is None or address["lng"] is None:
        address = None

    def mutate(data):
        rid = next_id(data, "rx")
        r = {
            "id": rid,
            "customer_id": user["id"],
            "customer_name": user["name"],
            "customer_phone": user.get("phone"),
            "file": stored,
            "file_name": shown_name,
            "is_pdf": ext == ".pdf",
            "address": address,
            "notified_chemists": nearby_chemist_ids(data, address),
            "chemist_id": None,
            "claimed_at": None,
            "status": "new",
            "items": [],
            "reply_kind": None,
            "reply_text": None,
            "answer": None,
            "order_id": None,
            "seen_at": None,
            "replied_at": None,
            "answered_at": None,
            "created_at": now(),
            "updated_at": now(),
        }
        data["rx_requests"].append(r)
        return {"request": rx_public(r, data, for_customer=True)}

    return jsonify(write(mutate))


@app.route("/api/rx-requests/mine")
def rx_mine():
    data = read()
    user = current_user(data)
    if not user or user["role"] != "customer":
        return jsonify({"error": "Login required"}), 401
    mine = [rx_public(r, data, for_customer=True) for r in data["rx_requests"] if r["customer_id"] == user["id"]]
    mine.sort(key=lambda r: r["created_at"])
    return jsonify({"requests": mine})


@app.route("/api/rx-requests/<int:rid>")
def rx_detail(rid):
    data = read()
    user = current_user(data)
    if not user or user["role"] != "customer":
        return jsonify({"error": "Login required"}), 401
    r = next((r for r in data["rx_requests"] if r["id"] == rid and r["customer_id"] == user["id"]), None)
    if not r:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"request": rx_public(r, data, for_customer=True)})


@app.route("/api/rx-requests/<int:rid>/cancel", methods=["POST"])
@app.route("/api/rx-requests/<int:rid>/decline", methods=["POST"])
def rx_cancel(rid):
    """The customer changes their mind, at any point before paying.
    Before the chemist has replied it is 'cancelled'; after, it is a 'no' to the offer."""
    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "customer":
            return {"error": "Login required", "code": 401}
        r = next((r for r in data["rx_requests"] if r["id"] == rid and r["customer_id"] == user["id"]), None)
        if not r:
            return {"error": "Not found", "code": 404}
        if r["status"] == "awaiting_customer":
            r["status"] = "closed_declined"
            r["answer"] = "no"
        elif r["status"] in ("new", "reviewing"):
            r["status"] = "closed_cancelled"
            r["answer"] = "cancelled"
        else:
            return {"error": "This prescription is already closed", "code": 409}
        r["answered_at"] = r["updated_at"] = now()
        return {"request": rx_public(r, data, for_customer=True)}

    result = write(mutate)
    if "error" in result:
        return jsonify({"error": result["error"]}), result["code"]
    return jsonify(result)


@app.route("/api/chemist/rx-requests")
def chemist_rx_list():
    data = read()
    user = current_user(data)
    if not user or user["role"] != "chemist":
        return jsonify({"error": "Chemist login required"}), 401
    visible = [rx_public(r, data) for r in data["rx_requests"] if rx_visible_to(r, user["id"])]
    open_ = sorted([r for r in visible if r["status"] in RX_OPEN], key=lambda r: r["created_at"])
    done = sorted([r for r in visible if r["status"] not in RX_OPEN], key=lambda r: r["updated_at"], reverse=True)[:8]
    return jsonify({
        "requests": open_ + done,
        "new_count": sum(1 for r in open_ if r["status"] == "new"),
    })


@app.route("/api/chemist/rx-requests/<int:rid>/open", methods=["POST"])
def chemist_rx_open(rid):
    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "chemist":
            return {"error": "Chemist login required", "code": 401}
        r = next((r for r in data["rx_requests"] if r["id"] == rid), None)
        if not r:
            return {"error": "Not found", "code": 404}
        if r["status"] == "closed_cancelled":
            return {"error": "The customer cancelled this prescription", "code": 409}
        if not rx_visible_to(r, user["id"]):
            return {"error": "Another chemist is already handling this prescription", "code": 409}
        if r["status"] in ("new", "reviewing"):
            r["chemist_id"] = user["id"]
            r["claimed_at"] = now()
            r["status"] = "reviewing"
            r["seen_at"] = r.get("seen_at") or now()
            r["updated_at"] = now()
        return {"request": rx_public(r, data)}

    result = write(mutate)
    if "error" in result:
        return jsonify({"error": result["error"]}), result["code"]
    return jsonify(result)


@app.route("/api/chemist/rx-requests/<int:rid>/reply", methods=["POST"])
def chemist_rx_reply(rid):
    body = request.get_json(force=True) or {}
    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify({"error": "List at least one medicine from the prescription"}), 400
    if len(raw_items) > RX_MAX_ITEMS:
        return jsonify({"error": "That is too many medicines for one prescription"}), 400

    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "chemist":
            return {"error": "Chemist login required", "code": 401}
        r = next((r for r in data["rx_requests"] if r["id"] == rid), None)
        if not r or r.get("chemist_id") != user["id"]:
            return {"error": "Open this prescription before replying", "code": 409}
        if r["status"] == "closed_cancelled":
            return {"error": "The customer cancelled this prescription", "code": 409}
        if r["status"] != "reviewing":
            return {"error": "You have already replied to this prescription", "code": 409}
        by_id = {m["id"]: m for m in data["medicines"]}
        items, seen = [], set()
        for it in raw_items:
            try:
                mid, qty = int(it.get("medicine_id")), int(it.get("qty", 1))
            except (TypeError, ValueError, AttributeError):
                return {"error": "Invalid medicine in the list", "code": 400}
            m = by_id.get(mid)
            if not m:
                return {"error": "One of the medicines is not in the catalogue", "code": 400}
            if mid in seen:
                return {"error": f"{m['name']} is listed twice", "code": 400}
            if not 1 <= qty <= RX_MAX_QTY:
                return {"error": f"Quantity for {m['name']} must be between 1 and {RX_MAX_QTY}", "code": 400}
            seen.add(mid)
            # Prices always come from the catalogue, never from the request body.
            items.append({"medicine_id": mid, "name": m["name"], "unit": m["unit"],
                          "price": m["price"], "qty": qty, "in_stock": bool(it.get("in_stock"))})
        kind, text = rx_reply(items)
        r["items"] = items
        r["reply_kind"] = kind
        r["reply_text"] = text
        r["replied_at"] = r["updated_at"] = now()
        r["status"] = "closed_unavailable" if kind == "none" else "awaiting_customer"
        return {"request": rx_public(r, data)}

    result = write(mutate)
    if "error" in result:
        return jsonify({"error": result["error"]}), result["code"]
    return jsonify(result)


# ---------- orders ----------

@app.route("/api/orders", methods=["POST"])
def place_order():
    body = request.get_json(force=True)
    address = body.get("address") or {}
    payment_method = body.get("payment_method") or "cod"
    upi_id = (body.get("upi_id") or "").strip()
    rx_id = body.get("rx_request_id")
    try:
        rx_id = int(rx_id) if rx_id is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid prescription request"}), 400

    if payment_method not in ("upi", "cod"):
        return jsonify({"error": "Invalid payment method"}), 400

    def mutate(data):
        user = current_user(data)
        if not user:
            return {"error": "Login required"}
        if user["role"] != "customer":
            return {"error": "Only customers can place orders"}

        rx = None
        if rx_id is not None:
            # Buying from a prescription the chemist has already checked: the
            # order is priced from their reply and goes straight to that chemist.
            rx = next((r for r in data["rx_requests"] if r["id"] == rx_id and r["customer_id"] == user["id"]), None)
            if not rx:
                return {"error": "Prescription request not found"}
            if rx["status"] != "awaiting_customer":
                return {"error": "This prescription offer is no longer open"}
            items = [{"medicine_id": i["medicine_id"], "name": i["name"], "qty": i["qty"], "price": i["price"]}
                     for i in rx["items"] if i["in_stock"]]
            if not items:
                return {"error": "Nothing on this prescription is available"}
            total = sum(i["price"] * i["qty"] for i in items)
            notified = [rx["chemist_id"]]
        else:
            cart = data["carts"].get(str(user["id"]), [])
            if not cart:
                return {"error": "Your cart is empty"}
            by_id = {m["id"]: m for m in data["medicines"]}
            items = []
            total = 0
            for line in cart:
                m = by_id.get(line["medicine_id"])
                if not m:
                    continue
                items.append({"medicine_id": m["id"], "name": m["name"], "qty": line["qty"], "price": m["price"]})
                total += m["price"] * line["qty"]
            if not items:
                return {"error": "Your cart is empty"}
            notified = nearby_chemist_ids(data, address)

        oid = next_id(data, "order")
        # Simulated payment only — this is a local demo, not a real payment
        # gateway. No money moves and nothing is sent to any bank or UPI network.
        payment_status = "paid" if payment_method == "upi" else "pending_cod"
        transaction_id = f"SIM-{oid:05d}-{random.randint(100000, 999999)}" if payment_method == "upi" else None

        order = {
            "id": oid,
            "customer_id": user["id"],
            "customer_name": user["name"],
            "customer_phone": user.get("phone"),
            "items": items,
            "total": total,
            "prescription_file": rx["file"] if rx else None,
            "rx_request_id": rx["id"] if rx else None,
            "address": address,
            "status": "accepted" if rx else "pending",
            "chemist_id": rx["chemist_id"] if rx else None,
            "delivery_charge": None,
            "driver_name": None,
            "otp": f"{random.randint(0, 9999):04d}",
            "notified_chemists": notified,
            "payment_method": payment_method,
            "payment_status": payment_status,
            "upi_id": upi_id or None,
            "transaction_id": transaction_id,
            "created_at": now(),
            "updated_at": now(),
        }
        data["orders"].append(order)
        if rx:
            rx["status"] = "accepted"
            rx["answer"] = "yes"
            rx["order_id"] = oid
            rx["answered_at"] = rx["updated_at"] = now()
        else:
            data["carts"][str(user["id"])] = []
        return {"order": order}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/orders/mine")
def my_orders():
    data = read()
    user = current_user(data)
    if not user:
        return jsonify({"error": "Login required"}), 401
    mine = [order_public(o, data, include_otp=True) for o in data["orders"] if o["customer_id"] == user["id"]]
    mine.sort(key=lambda o: o["created_at"], reverse=True)
    return jsonify({"orders": mine})


@app.route("/api/orders/<int:oid>")
def order_detail(oid):
    data = read()
    user = current_user(data)
    if not user:
        return jsonify({"error": "Login required"}), 401
    o = next((o for o in data["orders"] if o["id"] == oid), None)
    if not o:
        return jsonify({"error": "Not found"}), 404
    if user["role"] == "customer" and o["customer_id"] != user["id"]:
        return jsonify({"error": "Forbidden"}), 403
    is_owner_customer = user["role"] == "customer" and o["customer_id"] == user["id"]
    return jsonify({"order": order_public(o, data, include_otp=is_owner_customer)})


# ---------- chemist portal ----------

@app.route("/api/chemist/online", methods=["POST"])
def chemist_online():
    body = request.get_json(force=True)
    online = bool(body.get("online"))

    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "chemist":
            return {"error": "Chemist login required"}
        c = next((c for c in data["chemists"] if c["user_id"] == user["id"]), None)
        if not c:
            return {"error": "Chemist profile not found"}
        c["online"] = online
        return {"chemist": c}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 401
    return jsonify(result)


@app.route("/api/chemist/orders/incoming")
def chemist_incoming():
    data = read()
    user = current_user(data)
    if not user or user["role"] != "chemist":
        return jsonify({"error": "Chemist login required"}), 401
    incoming = [
        order_public(o, data) for o in data["orders"]
        if o["status"] == "pending" and (not o["notified_chemists"] or user["id"] in o["notified_chemists"])
    ]
    incoming.sort(key=lambda o: o["created_at"])
    return jsonify({"orders": incoming})


@app.route("/api/chemist/orders/mine")
def chemist_mine():
    data = read()
    user = current_user(data)
    if not user or user["role"] != "chemist":
        return jsonify({"error": "Chemist login required"}), 401
    mine = [order_public(o, data) for o in data["orders"] if o.get("chemist_id") == user["id"]]
    mine.sort(key=lambda o: o["updated_at"], reverse=True)
    return jsonify({"orders": mine})


@app.route("/api/chemist/orders/<int:oid>/accept", methods=["POST"])
def accept_order(oid):
    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "chemist":
            return {"error": "Chemist login required"}
        o = next((o for o in data["orders"] if o["id"] == oid), None)
        if not o:
            return {"error": "Not found"}
        if o["status"] != "pending":
            return {"error": "Order already taken"}
        o["status"] = "accepted"
        o["chemist_id"] = user["id"]
        o["updated_at"] = now()
        return {"order": order_public(o, data)}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


VALID_TRANSITIONS = {
    "accepted": "packed",
    "packed": "out_for_delivery",
    "out_for_delivery": "delivered",
}


@app.route("/api/chemist/orders/<int:oid>/status", methods=["POST"])
def update_status(oid):
    body = request.get_json(force=True)
    delivery_charge = body.get("delivery_charge")
    driver_name = body.get("driver_name")
    entered_otp = (body.get("otp") or "").strip()

    def mutate(data):
        user = current_user(data)
        if not user or user["role"] != "chemist":
            return {"error": "Chemist login required"}
        o = next((o for o in data["orders"] if o["id"] == oid), None)
        if not o or o.get("chemist_id") != user["id"]:
            return {"error": "Not found"}
        next_status = VALID_TRANSITIONS.get(o["status"])
        if not next_status:
            return {"error": "Order cannot be advanced further"}
        if next_status == "out_for_delivery":
            if delivery_charge is not None:
                o["delivery_charge"] = float(delivery_charge)
            if driver_name:
                o["driver_name"] = driver_name.strip()
        if next_status == "delivered":
            if entered_otp != o.get("otp"):
                return {"error": "Incorrect OTP — ask the customer for the 4-digit code on their tracking page"}
        o["status"] = next_status
        o["updated_at"] = now()
        return {"order": order_public(o, data)}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/chemists/nearby")
def chemists_nearby():
    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lng are required"}), 400
    data = read()
    result = []
    for c in data["chemists"]:
        if c.get("lat") is None:
            continue
        dist = haversine_km(lat, lng, c["lat"], c["lng"])
        result.append({**c, "distance_km": round(dist, 1)})
    result.sort(key=lambda c: c["distance_km"])
    return jsonify({"chemists": result})


# ---------- admin data viewer ----------
# Closed by default. With ADMIN_PASSWORD set (e.g. on Render) the caller must send it in
# the X-Admin-Password header. Without it, only the machine running the server may open it.

def _admin_allowed():
    expected = os.environ.get("ADMIN_PASSWORD", "")
    if expected:
        given = request.headers.get("X-Admin-Password", "")
        return hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))
    return request.remote_addr in ("127.0.0.1", "::1")


@app.route("/api/admin/overview")
def admin_overview():
    if not _admin_allowed():
        return jsonify({"error": "Admin login required"}), 403
    data = read()
    users = [{
        "id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"],
        "phone": u.get("phone"), "created_at": u.get("created_at"),
        "verified": bool(u.get("verified")),
        "locked": u.get("locked_until", 0) > now(),
    } for u in data["users"]]

    chemists = []
    for c in data["chemists"]:
        owner = next((u for u in data["users"] if u["id"] == c["user_id"]), None)
        chemists.append({**c, "owner_name": owner["name"] if owner else None, "owner_email": owner["email"] if owner else None})

    orders = []
    for o in data["orders"]:
        customer = next((u for u in data["users"] if u["id"] == o["customer_id"]), None)
        chemist = next((u for u in data["users"] if u["id"] == o.get("chemist_id")), None)
        orders.append({**o, "customer_email": customer["email"] if customer else None, "chemist_name": chemist["name"] if chemist else None})

    return jsonify({
        "generated_at": now(),
        "users": sorted(users, key=lambda u: u["created_at"] or 0, reverse=True),
        "chemists": chemists,
        "orders": sorted(orders, key=lambda o: o["created_at"], reverse=True),
        "medicines_count": len(data["medicines"]),
    })


def _lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


if __name__ == "__main__":
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    lan_ip = _lan_ip()
    print("\n  InstaRX is running:")
    print("  On this PC:        http://localhost:5000")
    if lan_ip:
        print(f"  On your network:   http://{lan_ip}:5000   <-- share this with colleagues on the same WiFi")
    else:
        print("  (couldn't detect a network IP — colleagues will need to be on this PC)")
    print()
    app.run(debug=True, port=5000, host="0.0.0.0")
