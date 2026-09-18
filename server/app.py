import os
import random
from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from store import read, write, next_id, now, haversine_km
from images import get_image_cache, pick_image

BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
NEARBY_RADIUS_KM = 15

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", "instarx-university-project-demo-secret")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

IMAGE_CACHE = get_image_cache()


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
    return {"id": u["id"], "role": u["role"], "name": u["name"], "email": u["email"], "phone": u.get("phone")}


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
    if not name or not email or len(password) < 4:
        return jsonify({"error": "Name, email and a password (4+ chars) are required"}), 400

    def mutate(data):
        if any(u["email"] == email for u in data["users"]):
            return {"error": "An account with this email already exists"}
        uid = next_id(data, "user")
        user = {
            "id": uid, "role": role, "name": name, "email": email,
            "password_hash": generate_password_hash(password),
            "phone": phone, "created_at": now(),
        }
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
        return {"user": user}

    result = write(mutate)
    if "error" in result:
        return jsonify(result), 409
    session["user_id"] = result["user"]["id"]
    return jsonify({"user": public_user(result["user"])})


@app.route("/api/login", methods=["POST"])
def login():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    data = read()
    user = next((u for u in data["users"] if u["email"] == email), None)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401
    session["user_id"] = user["id"]
    return jsonify({"user": public_user(user)})


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


@app.route("/api/medicines")
def medicines():
    q = (request.args.get("q") or "").strip().lower()
    category = request.args.get("category")
    popular = request.args.get("popular")
    data = read()
    items = data["medicines"]
    if q:
        items = [m for m in items if q in m["name"].lower() or q in m["brand"].lower() or q in m["category"].lower()]
    if category:
        items = [m for m in items if m["category"] == category]
    if popular == "1":
        items = [m for m in items if m["popular"]]
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


# ---------- prescription upload ----------

@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/upload-prescription", methods=["POST"])
def upload_prescription():
    data0 = read()
    user = current_user(data0)
    if not user:
        return jsonify({"error": "Login required"}), 401
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No file selected"}), 400
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    safe_name = f"{now()}_{user['id']}_{secure_filename(f.filename)}"
    f.save(os.path.join(UPLOAD_DIR, safe_name))
    return jsonify({"filename": safe_name})


# ---------- orders ----------

@app.route("/api/orders", methods=["POST"])
def place_order():
    body = request.get_json(force=True)
    address = body.get("address") or {}
    prescription_file = body.get("prescription_file")
    payment_method = body.get("payment_method") or "cod"
    upi_id = (body.get("upi_id") or "").strip()

    if payment_method not in ("upi", "cod"):
        return jsonify({"error": "Invalid payment method"}), 400

    def mutate(data):
        user = current_user(data)
        if not user:
            return {"error": "Login required"}
        if user["role"] != "customer":
            return {"error": "Only customers can place orders"}
        cart = data["carts"].get(str(user["id"]), [])
        if not cart and not prescription_file:
            return {"error": "Your cart is empty and no prescription was attached"}
        by_id = {m["id"]: m for m in data["medicines"]}
        items = []
        total = 0
        for line in cart:
            m = by_id.get(line["medicine_id"])
            if not m:
                continue
            items.append({"medicine_id": m["id"], "name": m["name"], "qty": line["qty"], "price": m["price"]})
            total += m["price"] * line["qty"]

        lat, lng = address.get("lat"), address.get("lng")
        nearby = []
        if lat is not None and lng is not None:
            for c in data["chemists"]:
                if not c.get("online") or c.get("lat") is None:
                    continue
                dist = haversine_km(lat, lng, c["lat"], c["lng"])
                nearby.append((dist, c["user_id"]))
            nearby.sort(key=lambda x: x[0])
            if nearby and nearby[0][0] > NEARBY_RADIUS_KM:
                pass  # none strictly within radius; still broadcast to closest ones below
        notified = [uid for _, uid in nearby[:6]]

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
            "prescription_file": prescription_file,
            "address": address,
            "status": "pending",
            "chemist_id": None,
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


# ---------- admin data viewer (local/demo use only, no auth) ----------

@app.route("/api/admin/overview")
def admin_overview():
    data = read()
    users = [{
        "id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"],
        "phone": u.get("phone"), "created_at": u.get("created_at"),
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
