"""InstaRX automated checks.

Runs against a LIVE server and creates throw-away accounts (qa.*@example.com),
so point it at a copy of the site, never at the database you want to keep:

    python tests/run_checks.py http://127.0.0.1:5055

Groups: accounts and security, catalogue and cart, orders, prescription chat,
and the JavaScript that reads medicines from a prescription (needs Node.js).
"""
import http.cookiejar, json, os, re, struct, subprocess, sys, time, urllib.error, urllib.request, uuid, zlib

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5055").rstrip("/")
PW = "Qatest42xyz"
RUN = str(int(time.time()))[-7:]
# Each run uses its own spot on the map, so chemists left over from earlier runs
# (the server notifies only the 6 nearest) can never crowd out this run's chemists.
AHD = {"lat": round(21.0 + (int(RUN) % 9000) * 0.0005, 5), "lng": round(70.0 + (int(RUN) % 7000) * 0.0007, 5)}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results = []          # (group, name, ok)
group = ["-"]


def check(name, cond, detail=""):
    results.append((group[0], name, bool(cond)))
    if not cond:
        print(f"  FAIL  {name}  {detail}")


def section(name):
    group[0] = name
    print(f"\n{name}")


def session():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, path, body=None, raw=None, ctype="application/json", method=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data is not None else "GET"))
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with op.open(req) as r:
            t = r.read()
            return r.status, (json.loads(t) if t[:1] in (b"{", b"[") else t)
    except urllib.error.HTTPError as e:
        t = e.read()
        try:
            return e.code, json.loads(t)
        except Exception:
            return e.code, t[:200]


def png():
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b""))


def send_rx(op, name="rx.png", content=None, ctype="image/png"):
    b = uuid.uuid4().hex
    fields = {"lat": AHD["lat"], "lng": AHD["lng"], "label": "Gota, Ahmedabad"}
    body = b"".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items())
    body += (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n').encode() + (content or png()) + f"\r\n--{b}--\r\n".encode()
    return call(op, "/api/rx-requests", raw=body, ctype=f"multipart/form-data; boundary={b}")


def make_account(role, tag, extra=None, verify=True):
    op = session()
    email = f"qa.{tag}{RUN}@example.com"
    s, j = call(op, "/api/signup", {"role": role, "name": f"QA {tag}", "email": email, "password": PW, "phone": "9000000000", **(extra or {})})
    if verify:
        call(op, "/api/verify", {"email": email, "code": j.get("dev_code")})
        call(op, "/api/login", {"email": email, "password": PW})
    return op, email, j


def chemist(tag):
    op, email, _ = make_account("chemist", tag, {"shop_name": f"QA Shop {tag}", "license_no": "GJ-QA", "address": "Gota", **AHD})
    call(op, "/api/chemist/online", {"online": True})
    return op


# ===================================================================== 1. accounts and security
section("1. Accounts and security")
anon = session()
for pw, why in (("12345678", "digits only"), ("abcdefgh", "letters only"), ("Ab1", "too short"), ("instarx1", "too common")):
    s, j = call(anon, "/api/signup", {"role": "customer", "name": "QA", "email": f"qa.weak{RUN}@example.com", "password": pw})
    check(f"weak password refused ({why})", s == 400, j)
s, j = call(anon, "/api/signup", {"role": "customer", "name": "QA", "email": "not-an-email", "password": PW})
check("invalid email refused", s == 400, j)
s, j = call(anon, "/api/signup", {"role": "customer", "name": "", "email": f"qa.noname{RUN}@example.com", "password": PW})
check("empty name refused", s == 400, j)

op = session()
email = f"qa.acct{RUN}@example.com"
s, j = call(op, "/api/signup", {"role": "customer", "name": "QA acct", "email": email, "password": PW, "phone": "9000000000"})
check("sign-up asks for email verification", s == 200 and j.get("pending_verification") and len(j.get("dev_code", "")) == 6, j)
check("sign-up does not log the user in", call(op, "/api/me")[1].get("user") is None)
s, j = call(op, "/api/login", {"email": email, "password": PW})
check("log-in is blocked until the email is verified", s == 403 and j.get("pending_verification"), j)
code = j.get("dev_code")
s, j = call(op, "/api/verify", {"email": email, "code": "000000" if code != "000000" else "111111"})
check("wrong verification code is refused", s == 400, j)
s, j = call(op, "/api/resend-code", {"email": email})
check("a new code cannot be requested within 60 seconds", s == 429, j)
s, j = call(op, "/api/verify", {"email": email, "code": code})
check("correct code verifies the account", s == 200 and j["user"]["verified"], j)
call(op, "/api/logout", method="POST", body={})
s, j = call(op, "/api/login", {"email": email, "password": PW, "remember": True})
check("verified account can log in", s == 200 and j["user"]["role"] == "customer", j)
check("session shows the signed-in user", call(op, "/api/me")[1]["user"]["email"] == email)
s, j = call(anon, "/api/signup", {"role": "customer", "name": "QA", "email": email, "password": PW})
check("a verified email cannot be registered again", s == 409, j)

op2 = session()
s1, j1 = call(op2, "/api/login", {"email": f"nobody{RUN}@example.com", "password": PW})
s2, j2 = call(op2, "/api/login", {"email": email, "password": "Wrongpass99"})
check("unknown email and wrong password give the same kind of error (no account discovery)", s1 == 401 and s2 == 401 and "Invalid email or password" in j1["error"] and "Invalid email or password" in j2["error"], (j1, j2))
for _ in range(3):
    call(op2, "/api/login", {"email": email, "password": "Wrongpass99"})
s, j = call(op2, "/api/login", {"email": email, "password": "Wrongpass99"})   # this is the 5th wrong try (one above + three here + this one)
check("the 5th wrong password locks the account", s == 401 and "locked" in j["error"].lower(), j)
s, j = call(op2, "/api/login", {"email": email, "password": PW})
check("the correct password is refused while locked", s == 401 and "Too many" in j["error"], j)
s, j = call(anon, "/api/admin/overview")
check("the admin overview never exposes passwords or password hashes", s == 200 and "password" not in json.dumps(j).lower() and PW not in json.dumps(j), "")

# ===================================================================== 2. catalogue and cart
section("2. Catalogue and cart")
s, j = call(anon, "/api/medicines")
meds = j["medicines"]
check("catalogue holds 64 medicines", len(meds) == 64, len(meds))
ids = {m["name"]: m["id"] for m in meds}
s, j = call(anon, "/api/categories")
check("catalogue has 8 categories", len(j["categories"]) == 8, len(j["categories"]))
s, j = call(anon, "/api/concerns")
check("Quick Select offers 8 health concerns", len(j["concerns"]) == 8, len(j["concerns"]))
s, j = call(anon, "/api/medicines?q=dolo")
check("search finds Dolo 650mg", any(m["name"] == "Dolo 650mg" for m in j["medicines"]))
s, j = call(anon, "/api/medicines?concern=Fever%20%26%20Pain")
check("Quick Select filter returns only that concern", j["medicines"] and all(m["concern"] == "Fever & Pain" for m in j["medicines"]))
s, j = call(anon, "/api/medicines?limit=5")
check("limit parameter is respected", len(j["medicines"]) == 5)
check("every product has an image or a drawn fallback field", all("image" in m for m in meds))
check("cart needs a signed-in user", call(anon, "/api/cart")[0] == 401)
cust, cemail, _ = make_account("customer", "cart")
call(cust, "/api/cart", {"medicine_id": ids["Dolo 650mg"], "qty": 1})
call(cust, "/api/cart", {"medicine_id": ids["Dolo 650mg"], "qty": 2})
s, j = call(cust, "/api/cart")
check("adding the same medicine twice adds up the quantity", j["items"][0]["qty"] == 3, j)
check("cart total is price times quantity", j["total"] == 32 * 3, j["total"])
call(cust, "/api/cart", {"medicine_id": ids["Dolo 650mg"], "qty": -1})
check("quantity can be reduced", call(cust, "/api/cart")[1]["items"][0]["qty"] == 2)
call(cust, f"/api/cart/{ids['Dolo 650mg']}", method="DELETE")
check("an item can be removed", call(cust, "/api/cart")[1]["items"] == [])

# ===================================================================== 3. orders
section("3. Orders and delivery")
shopA, shopB = chemist("shopA"), chemist("shopB")
buyer, _, _ = make_account("customer", "buyer")
other, _, _ = make_account("customer", "other")
s, j = call(buyer, "/api/orders", {"address": {**AHD, "label": "Gota"}, "payment_method": "cod"})
check("an empty cart cannot be ordered", s == 400, j)
call(buyer, "/api/cart", {"medicine_id": ids["Crocin Advance 500mg"], "qty": 2})
s, j = call(buyer, "/api/orders", {"address": {**AHD, "label": "Gota"}, "payment_method": "bitcoin"})
check("an unknown payment method is refused", s == 400, j)
s, j = call(buyer, "/api/orders", {"address": {**AHD, "label": "Gota"}, "payment_method": "cod"})
o = j.get("order", {})
check("order is placed as Pending with a 4-digit OTP", s == 200 and o.get("status") == "pending" and re.fullmatch(r"\d{4}", o.get("otp", "")), j)
check("order total is calculated by the server", o.get("total") == 120, o.get("total"))
check("the cart is emptied after ordering", call(buyer, "/api/cart")[1]["items"] == [])
oid = o["id"]
s, j = call(shopA, "/api/chemist/orders/incoming")
check("a nearby online chemist sees the new order", any(x["id"] == oid for x in j["orders"]))
check("the customer's OTP is hidden from the chemist", all("otp" not in x for x in j["orders"]))
s, j = call(shopA, f"/api/chemist/orders/{oid}/accept", method="POST")
check("the first chemist can accept it", s == 200 and j["order"]["status"] == "accepted", j)
s, j = call(shopB, f"/api/chemist/orders/{oid}/accept", method="POST")
check("a second chemist cannot accept the same order", s == 400, j)
s, j = call(shopA, f"/api/chemist/orders/{oid}/status", {})
check("the order moves to Packed", j["order"]["status"] == "packed", j)
s, j = call(shopA, f"/api/chemist/orders/{oid}/status", {"driver_name": "Ravi", "delivery_charge": 25})
check("the order moves to Out for delivery with driver and charge", j["order"]["status"] == "out_for_delivery" and j["order"]["driver_name"] == "Ravi" and j["order"]["delivery_charge"] == 25, j)
s, j = call(shopA, f"/api/chemist/orders/{oid}/status", {"otp": "0000" if o["otp"] != "0000" else "1111"})
check("a wrong OTP cannot complete the delivery", s == 400, j)
s, j = call(shopA, f"/api/chemist/orders/{oid}/status", {"otp": o["otp"]})
check("the correct OTP completes the delivery", s == 200 and j["order"]["status"] == "delivered", j)
check("another customer cannot open this order", call(other, f"/api/orders/{oid}")[0] == 403)
check("the customer can open their own order", call(buyer, f"/api/orders/{oid}")[0] == 200)
check("a chemist account cannot place an order", call(shopA, "/api/orders", {"address": AHD, "payment_method": "cod"})[0] == 400)
call(buyer, "/api/cart", {"medicine_id": ids["Eno Fruit Salt"], "qty": 1})
far = {"lat": 28.6139, "lng": 77.2090, "label": "Delhi"}
s, j = call(buyer, "/api/orders", {"address": far, "payment_method": "cod"})
check("nearest-chemist matching still reaches online chemists for a far address", s == 200 and j["order"]["notified_chemists"] is not None)

# ===================================================================== 4. prescription chat
section("4. Prescription chat")
chemX, chemY = chemist("rxX"), chemist("rxY")
cust, _, _ = make_account("customer", "rx1")
other, _, _ = make_account("customer", "rx2")
s, j = send_rx(cust, "virus.exe", b"MZ", "application/octet-stream")
check("a non-image, non-PDF file is refused", s == 400, j)
s, j = send_rx(cust)
r1 = j["request"]
check("a prescription is sent and starts as 'new'", s == 200 and r1["status"] == "new", j)
check("the stored file name is random, not the original", r1["file"] != "rx.png" and r1["file_name"] == "rx.png")
check("the customer's view hides which chemists were notified", "notified_chemists" not in r1)
check("a signed-out visitor cannot open the file", call(anon, r1["file_url"])[0] == 401)
check("another customer cannot open the file", call(other, r1["file_url"])[0] == 404)
check("the owner can open the file", call(cust, r1["file_url"])[0] == 200)
s, j = call(chemX, "/api/chemist/rx-requests")
check("the nearby chemist sees it and the new count", any(r["id"] == r1["id"] for r in j["requests"]) and j["new_count"] >= 1)
s, j = call(chemX, f"/api/chemist/rx-requests/{r1['id']}/open", method="POST")
check("opening it claims it (status reviewing, Seen time set)", j["request"]["status"] == "reviewing" and j["request"]["seen_at"], j)
check("a second chemist is blocked while the first holds it", call(chemY, f"/api/chemist/rx-requests/{r1['id']}/open", method="POST")[0] == 409)
check("it disappears from the second chemist's list", not any(r["id"] == r1["id"] for r in call(chemY, "/api/chemist/rx-requests")[1]["requests"]))
check("the second chemist can no longer open the file", call(chemY, r1["file_url"])[0] == 404)
check("the second chemist cannot reply to it", call(chemY, f"/api/chemist/rx-requests/{r1['id']}/reply", {"items": [{"medicine_id": ids["Dolo 650mg"], "qty": 1, "in_stock": True}]})[0] == 409)
s, j = call(chemX, f"/api/chemist/rx-requests/{r1['id']}/reply", {"items": [{"medicine_id": ids["Dolo 650mg"], "qty": 99, "in_stock": True}]})
check("a quantity above 20 is refused", s == 400, j)
s, j = call(chemX, f"/api/chemist/rx-requests/{r1['id']}/reply", {"items": [{"medicine_id": ids["Dolo 650mg"], "qty": 1, "in_stock": True}] * 2})
check("the same medicine listed twice is refused", s == 400, j)
s, j = call(chemX, f"/api/chemist/rx-requests/{r1['id']}/reply", {"items": [
    {"medicine_id": ids["Dolo 650mg"], "qty": 2, "in_stock": True, "price": 1},
    {"medicine_id": ids["Pan 40mg"], "qty": 1, "in_stock": True},
    {"medicine_id": ids["Cetirizine 10mg"], "qty": 1, "in_stock": False}]})
rr = j["request"]
check("a partial reply waits for the customer", rr["status"] == "awaiting_customer" and rr["reply_kind"] == "partial", j)
check("the reply text names the available and the missing medicines", rr["reply_text"] == "Dolo 650mg and Pan 40mg are available but Cetirizine 10mg is out of stock. Would you like to buy the available stock?", rr["reply_text"])
check("prices come from the catalogue, not from the request", rr["available_total"] == 32 * 2 + 135, rr["available_total"])
check("a chemist cannot reply twice", call(chemX, f"/api/chemist/rx-requests/{r1['id']}/reply", {"items": [{"medicine_id": ids["Dolo 650mg"], "qty": 1, "in_stock": True}]})[0] == 409)
check("another customer cannot buy this offer", call(other, "/api/orders", {"rx_request_id": r1["id"], "address": {**AHD, "label": "x"}, "payment_method": "cod"})[0] == 400)
s, j = call(cust, "/api/orders", {"rx_request_id": r1["id"], "address": {**AHD, "label": "Gota"}, "payment_method": "upi", "upi_id": "qa@okbank"})
po = j.get("order", {})
check("saying yes creates an order, already accepted by that chemist", s == 200 and po.get("status") == "accepted" and po.get("total") == 199 and len(po.get("items", [])) == 2, j)
check("the same offer cannot be bought twice", call(cust, "/api/orders", {"rx_request_id": r1["id"], "address": {**AHD, "label": "Gota"}, "payment_method": "cod"})[0] == 400)
check("the order appears in that chemist's own orders", any(x["id"] == po.get("id") for x in call(chemX, "/api/chemist/orders/mine")[1]["orders"]))
check("it is not announced to other chemists as a new request", not any(x["id"] == po.get("id") for x in call(chemY, "/api/chemist/orders/incoming")[1]["orders"]))
check("the normal delivery flow continues from there", call(chemX, f"/api/chemist/orders/{po['id']}/status", {})[1]["order"]["status"] == "packed")

s, j = send_rx(cust); r2 = j["request"]
call(chemY, f"/api/chemist/rx-requests/{r2['id']}/open", method="POST")
s, j = call(chemY, f"/api/chemist/rx-requests/{r2['id']}/reply", {"items": [{"medicine_id": ids["Combiflam"], "qty": 1, "in_stock": False}]})
check("nothing available closes the request with the apology", j["request"]["status"] == "closed_unavailable" and j["request"]["reply_text"] == "Medicine not available. We are sorry for the inconvenience.", j)
check("an unavailable prescription cannot be ordered", call(cust, "/api/orders", {"rx_request_id": r2["id"], "address": {**AHD, "label": "x"}, "payment_method": "cod"})[0] == 400)

s, j = send_rx(cust); r3 = j["request"]
call(chemX, f"/api/chemist/rx-requests/{r3['id']}/open", method="POST")
call(chemX, f"/api/chemist/rx-requests/{r3['id']}/reply", {"items": [{"medicine_id": ids["Combiflam"], "qty": 1, "in_stock": True}, {"medicine_id": ids["Benadryl Cough Syrup"], "qty": 1, "in_stock": False}]})
check("another customer cannot decline someone else's offer", call(other, f"/api/rx-requests/{r3['id']}/cancel", method="POST")[0] == 404)
s, j = call(cust, f"/api/rx-requests/{r3['id']}/cancel", method="POST")
check("the customer can say no to an offer", s == 200 and j["request"]["status"] == "closed_declined", j)

s, j = send_rx(cust); r4 = j["request"]
s, j = call(cust, f"/api/rx-requests/{r4['id']}/cancel", method="POST")
check("the customer can cancel before any chemist opens it", s == 200 and j["request"]["status"] == "closed_cancelled", j)
check("a cancelled request vanishes from chemists who had not opened it", not any(r["id"] == r4["id"] for r in call(chemX, "/api/chemist/rx-requests")[1]["requests"]))
check("opening a cancelled request gives a clear message", "cancelled" in call(chemX, f"/api/chemist/rx-requests/{r4['id']}/open", method="POST")[1]["error"])
check("cancelling twice is refused", call(cust, f"/api/rx-requests/{r4['id']}/cancel", method="POST")[0] == 409)
s, j = send_rx(cust); r5 = j["request"]
call(chemX, f"/api/chemist/rx-requests/{r5['id']}/open", method="POST")
call(cust, f"/api/rx-requests/{r5['id']}/cancel", method="POST")
s, j = call(chemX, f"/api/chemist/rx-requests/{r5['id']}/reply", {"items": [{"medicine_id": ids["Combiflam"], "qty": 1, "in_stock": True}]})
check("a chemist replying after a cancellation is told so", s == 409 and "cancelled" in j["error"], j)
check("the chemist loses access to a cancelled prescription's file", call(chemX, r5["file_url"])[0] == 404)
s, j = send_rx(cust); r6 = j["request"]
call(chemX, f"/api/chemist/rx-requests/{r6['id']}/open", method="POST")
call(chemX, f"/api/chemist/rx-requests/{r6['id']}/reply", {"items": [{"medicine_id": ids["Combiflam"], "qty": 1, "in_stock": True}]})
call(cust, "/api/orders", {"rx_request_id": r6["id"], "address": {**AHD, "label": "Gota"}, "payment_method": "cod"})
check("a prescription cannot be cancelled after the order is placed", call(cust, f"/api/rx-requests/{r6['id']}/cancel", method="POST")[0] == 409)
mine = call(cust, "/api/rx-requests/mine")[1]["requests"]
check("the customer's history lists every prescription sent", len(mine) == 6, len(mine))

# ===================================================================== 5. reading medicines from a prescription
section("5. Reading medicines from prescription text (JavaScript)")
js = os.path.join(ROOT, "static", "js", "chemist-rx.js")
data_file = os.path.join(ROOT, "server", "data.json")
node_ok = subprocess.run(["node", "--version"], capture_output=True).returncode == 0 if os.name != "nt" else subprocess.run("node --version", shell=True, capture_output=True).returncode == 0
if node_ok and os.path.exists(js):
    runner = r"""
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
eval(src.slice(src.indexOf("function ocrNormalise"), src.indexOf("async function ocrBlob")) + "; global.matchMedicines = matchMedicines;");
const cat = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const cases = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const names = (t) => matchMedicines(t, cat).map((m) => m.name).sort();
console.log(JSON.stringify(cases.map((c) => [c.name, JSON.stringify(names(c.text)) === JSON.stringify(c.want.slice().sort()), names(c.text)])));
"""
    # The text of the demo prescription as it comes out of the reader, header and footer included.
    page = """City Care Clinic
Dr. Anil Mehta, M.B.B.S., M.D. (General Medicine)
Patient: Rohit Kumar Age / Sex: 24 / M
Diagnosis: Viral fever with cold and cough, acidity
Rx
1. Tab. Dolo 650 mg
1-0-1 after food x 5 days
2. Tab. Pan 40 mg
1-0-0 before breakfast
3. Tab. Cetirizine 10 mg
0-0-1 at bedtime
4. Benadryl Cough Syrup
10 ml three times a day
Advice: plenty of fluids, rest, avoid cold drinks.
Dr. Anil Mehta"""
    catalogue = call(anon, "/api/medicines?limit=200")[1]["medicines"]
    all_names = [m["name"] for m in catalogue]
    cases = [
        dict(name="the full demo prescription finds exactly the four prescribed medicines", text=page, want=["Benadryl Cough Syrup", "Cetirizine 10mg", "Dolo 650mg", "Pan 40mg"]),
        dict(name="a one-letter misreading in a long name is tolerated", text="Tab. Cetirizlne 10 mg", want=["Cetirizine 10mg"]),
        dict(name="a different strength is not matched (Dolo 500 is not Dolo 650)", text="Tab. Dolo 500 mg", want=[]),
        dict(name="short words inside other words do not trigger a match", text="company panel panic", want=[]),
        dict(name="text with no medicines finds nothing", text="Advice: plenty of fluids and rest.", want=[]),
        dict(name="a brand shared by several products needs the full name", text="Vicks Inhaler", want=["Vicks Inhaler"]),
        dict(name="a shared brand alone is not guessed", text="Vicks", want=[]),
        dict(name="name and strength written without a space are still found", text="Dolo650mg and Pan40mg", want=["Dolo 650mg", "Pan 40mg"]),
        dict(name="ordinary words (Dr, A, Clinic, hot) do not trigger products", text="Dr. Mehta, City Clinic, three times a day, avoid hot food", want=[]),
        dict(name="a product that starts with an ordinary word is found by its full name", text="A to Z Multivitamin", want=["A to Z Multivitamin"]),
        dict(name="every one of the 64 catalogue names is found from its own name", text=chr(10).join(all_names), want=all_names),
    ]
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        files = {}
        for key, payload in (("runner.js", None), ("cat.json", catalogue), ("cases.json", cases)):
            path = os.path.join(tmp, key)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(runner if payload is None else json.dumps(payload))
            files[key] = path
        out = subprocess.run(["node", files["runner.js"], js, files["cat.json"], files["cases.json"]], capture_output=True, text=True, shell=(os.name == "nt"))
    try:
        for name, ok, got in json.loads(out.stdout.strip().splitlines()[-1]):
            check(name, ok, got)
    except Exception as e:
        check("the matching script ran", False, (out.stderr or "")[:300] + str(e))
else:
    print("  (Node.js not found, skipped)")

# ===================================================================== summary
print("\n" + "=" * 62)
groups = []
for g, n, ok in results:
    if g not in groups:
        groups.append(g)
total_ok = 0
for g in groups:
    rows = [ok for gg, _, ok in results if gg == g]
    total_ok += sum(rows)
    print(f"{g:<58}{sum(rows):>3}/{len(rows)}")
print("-" * 62)
print(f"{'TOTAL':<58}{total_ok:>3}/{len(results)}")
sys.exit(0 if total_ok == len(results) else 1)
