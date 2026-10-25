/* InstaRX phone web app — single-page, hash-routed, same Flask backend. */

const view = () => document.querySelector("#app-view .container");
let me = { user: null };
let cartCache = { items: [], total: 0 };
let activeConcern = null;

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  showSplash();
  wireChrome();
  await refreshMe();
  await refreshCart();
  route();
  window.addEventListener("hashchange", route);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
});

async function refreshMe() {
  try { me = await api("/api/me"); } catch (e) { me = { user: null }; }
}

async function refreshCart() {
  if (!me.user || me.user.role !== "customer") { cartCache = { items: [], total: 0 }; }
  else {
    try { cartCache = await api("/api/cart"); } catch (e) { cartCache = { items: [], total: 0 }; }
  }
  paintCartChrome();
}

function cartCount() { return cartCache.items.reduce((s, i) => s + i.qty, 0); }

function paintCartChrome() {
  const n = cartCount();
  const badge = document.getElementById("tab-badge");
  badge.style.display = n ? "flex" : "none";
  badge.textContent = n;

  const bar = document.getElementById("checkout-bar");
  const onCart = location.hash.startsWith("#/cart");
  document.getElementById("cb-amt").textContent = currency(cartCache.total);
  document.getElementById("cb-sub").textContent = `${n} item${n === 1 ? "" : "s"}`;
  bar.classList.toggle("show", n > 0 && !onCart);
}

function wireChrome() {
  document.getElementById("cb-go").addEventListener("click", () => (location.hash = "#/cart"));
  document.getElementById("app-loc-btn").addEventListener("click", detectAndSave);
  paintWhere();
  wireAppSearch();
}

function paintWhere() {
  const a = getSavedAddress();
  document.getElementById("app-where").textContent = a ? truncate(a.label, 38) : "Set your location";
}

async function detectAndSave() {
  const el = document.getElementById("app-where");
  el.textContent = "Detecting…";
  try {
    const a = await detectLocation();
    saveAddress(a); paintWhere(); toast("Location updated");
  } catch (e) {
    el.textContent = "Tap to set location";
    openSheet("Set your address", addressSheetHtml(), wireAddressSheet);
  }
}

/* ---------- search ---------- */

function wireAppSearch() {
  const input = document.getElementById("app-search-input");
  const box = document.getElementById("app-suggest");
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { box.classList.remove("show"); return; }
    t = setTimeout(async () => {
      try {
        const { medicines } = await api(`/api/medicines?q=${encodeURIComponent(q)}&limit=8`);
        box.innerHTML = medicines.length ? medicines.map((m) => `
          <a class="row" href="#/product/${m.id}">
            <span class="ic">${m.image ? `<img src="${m.image}" alt="">` : productIllustration(m.category, m.unit)}</span>
            <span><span class="nm">${escapeHtml(m.name)}</span><br><span class="mt">${escapeHtml(m.unit)}</span></span>
            <span class="pz">${currency(m.price)}</span>
          </a>`).join("")
          : `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:13.5px;">No matches for "${escapeHtml(q)}"</div>`;
        box.classList.add("show");
      } catch (e) { /* ignore */ }
    }, 220);
  });
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) box.classList.remove("show");
  });
}

/* ---------- router ---------- */

function route() {
  const hash = location.hash || "#/home";
  const [, path, arg] = hash.replace("#/", "").split("/").reduce(
    (acc, part, i) => (i === 0 ? ["", part, ""] : [acc[0], acc[1], part]), ["", "", ""]);
  document.querySelectorAll(".tabbar a").forEach((a) =>
    a.classList.toggle("on", a.dataset.tab === path));
  document.getElementById("app-suggest").classList.remove("show");
  window.scrollTo(0, 0);

  const views = {
    home: viewHome, shop: viewShop, cart: viewCart,
    orders: viewOrders, account: viewAccount, product: viewProduct,
  };
  (views[path] || viewHome)(arg);
  paintCartChrome();
}

/* ---------- home ---------- */

async function viewHome() {
  view().innerHTML = `
    <div class="app-hero reveal">
      <h1>Medicines in<span>just 10 minutes</span></h1>
      <p>From your nearest verified local chemist.</p>
      <div class="cta">
        <a href="#/shop" class="btn btn-primary btn-sm">Order now</a>
        <a href="/upload-prescription.html" class="btn btn-outline btn-sm">Upload Rx</a>
      </div>
    </div>

    <div class="app-sec">
      <div class="app-sec-head"><h2>Quick Select</h2><a href="#/shop">View all</a></div>
      <div class="rail" id="q-rail"></div>
      <div class="rail" id="q-items" style="margin-top:12px;"></div>
    </div>

    <div class="app-sec">
      <div class="app-sec-head"><h2>Shop by category</h2></div>
      <div class="ctiles" id="c-tiles"></div>
    </div>

    <div class="app-sec">
      <div class="app-sec-head"><h2>Top selling</h2><a href="#/shop">View all</a></div>
      <div class="rail" id="top-rail"></div>
    </div>
    <div style="height:14px;"></div>`;

  loadConcerns();
  loadTiles();
  loadRail("/api/medicines?popular=1", "top-rail");
}

async function loadConcerns() {
  const rail = document.getElementById("q-rail");
  try {
    const { concerns } = await api("/api/concerns");
    activeConcern = activeConcern || concerns[0]?.name;
    rail.innerHTML = concerns.map((c) => `
      <button class="cchip ${c.name === activeConcern ? "active" : ""}" data-c="${escapeHtml(c.name)}">
        <span>${c.icon}</span>${escapeHtml(c.name)}</button>`).join("");
    rail.querySelectorAll(".cchip").forEach((b) =>
      b.addEventListener("click", () => {
        activeConcern = b.dataset.c;
        rail.querySelectorAll(".cchip").forEach((x) => x.classList.toggle("active", x === b));
        loadRail(`/api/medicines?concern=${encodeURIComponent(activeConcern)}&limit=8`, "q-items");
      }));
    loadRail(`/api/medicines?concern=${encodeURIComponent(activeConcern)}&limit=8`, "q-items");
  } catch (e) { rail.innerHTML = ""; }
}

async function loadTiles() {
  const el = document.getElementById("c-tiles");
  try {
    const { categories } = await api("/api/categories");
    el.innerHTML = categories.map((c) => `
      <a class="ctile" href="#/shop?cat=${encodeURIComponent(c.name)}">
        <div class="cic">${c.icon}</div>
        <div class="clb">${escapeHtml(c.name)}</div>
      </a>`).join("");
  } catch (e) { el.innerHTML = ""; }
}

async function loadRail(url, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = `<div style="padding:26px;width:100%;"><div class="spinner"></div></div>`;
  try {
    const { medicines } = await api(url);
    el.innerHTML = medicines.map(pcard).join("");
    wirePcards(el);
  } catch (e) { el.innerHTML = ""; }
}

function pcard(m) {
  const art = m.image
    ? `<img src="${m.image}" alt="${escapeHtml(m.name)}" loading="lazy">`
    : productIllustration(m.category, m.unit);
  return `
    <div class="pcard">
      ${m.rx ? `<span class="prx">Rx</span>` : ""}
      <a href="#/product/${m.id}" class="pimg">${art}</a>
      <div class="pnm">${escapeHtml(m.name)}</div>
      <div class="pun">${escapeHtml(m.unit)}</div>
      <div class="prow">
        <span class="ppr">${currency(m.price)}</span>
        <span class="pmr">${currency(m.mrp)}</span>
        <span class="pof">${m.discount_pct}% off</span>
      </div>
      <div class="pact" data-id="${m.id}">${pactHtml(m.id)}</div>
    </div>`;
}

/* ADD becomes a - qty + stepper once the item is in the cart. `shownQty`
   holds the number on screen while a request is in flight. */
const shownQty = {};
const pactQueue = {};

function cartQtyOf(id) {
  if (id in shownQty) return shownQty[id];
  const line = cartCache.items.find((i) => i.medicine.id === id);
  return line ? line.qty : 0;
}

function pactHtml(id) {
  const q = cartQtyOf(id);
  if (!q) return `<button class="padd" data-act="add">ADD</button>`;
  return `<div class="pstep"><button data-act="dec" aria-label="Remove one">−</button><span>${q}</span><button data-act="inc" aria-label="Add one">+</button></div>`;
}

function paintPacts() {
  document.querySelectorAll(".pact").forEach((el) => { el.innerHTML = pactHtml(Number(el.dataset.id)); });
}

function wirePcards(scope) {
  if (!scope.dataset.pactWired) {
    scope.dataset.pactWired = "1";
    scope.addEventListener("click", (e) => {
      const btn = e.target.closest(".pact [data-act]");
      if (!btn) return;
      if (!me.user) { toast("Log in to start ordering"); location.hash = "#/account"; return; }
      const id = Number(btn.closest(".pact").dataset.id);
      const act = btn.dataset.act;
      const prev = cartQtyOf(id);
      const next = act === "dec" ? prev - 1 : prev + 1;
      if (next < 0) return;
      shownQty[id] = next;
      paintPacts();
      pactQueue[id] = (pactQueue[id] || Promise.resolve()).then(async () => {
        try {
          if (next === 0) await api(`/api/cart/${id}`, { method: "DELETE" });
          else await api("/api/cart", { method: "POST", body: JSON.stringify({ medicine_id: id, qty: act === "dec" ? -1 : 1 }) });
          await refreshCart();
        } catch (err) { toast(err.message); }
        if (shownQty[id] === next) delete shownQty[id];   // nothing newer queued; trust the server
        paintPacts();
      });
    });
  }
}

/* ---------- shop ---------- */

async function viewShop() {
  const cat = new URLSearchParams(location.hash.split("?")[1] || "").get("cat");
  view().innerHTML = `
    <div style="padding-top:18px;">
      <h2 style="font-size:20px;color:var(--navy);margin:0 0 12px;">${escapeHtml(cat || "All medicines")}</h2>
      <div class="rail" id="shop-cats" style="margin-bottom:14px;"></div>
      <div class="pgrid" id="shop-grid"></div>
    </div>
    <div style="height:14px;"></div>`;

  const { categories } = await api("/api/categories");
  const rail = document.getElementById("shop-cats");
  rail.innerHTML = `<a class="cchip ${!cat ? "active" : ""}" href="#/shop">All</a>` +
    categories.map((c) => `<a class="cchip ${cat === c.name ? "active" : ""}"
      href="#/shop?cat=${encodeURIComponent(c.name)}">${c.icon} ${escapeHtml(c.name)}</a>`).join("");

  const grid = document.getElementById("shop-grid");
  grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;"><div class="spinner"></div></div>`;
  const { medicines } = await api(`/api/medicines${cat ? "?category=" + encodeURIComponent(cat) : ""}`);
  grid.innerHTML = medicines.map(pcard).join("");
  wirePcards(grid);
}

/* ---------- product ---------- */

async function viewProduct(id) {
  view().innerHTML = `<div style="padding:40px;"><div class="spinner"></div></div>`;
  try {
    const { medicine: m } = await api(`/api/medicines/${id}`);
    const art = m.image ? `<img src="${m.image}" alt="${escapeHtml(m.name)}" style="width:100%;height:100%;object-fit:contain;padding:18px;">`
                        : productIllustration(m.category, m.unit);
    view().innerHTML = `
      <div style="padding-top:16px;">
        <a href="#/shop" class="btn btn-ghost btn-sm" style="padding-left:0;">← Back</a>
        <div style="background:#fff;border:1px solid var(--border);border-radius:18px;height:230px;
                    display:flex;align-items:center;justify-content:center;overflow:hidden;margin:10px 0 16px;">${art}</div>
        ${m.rx ? `<span class="pill" style="background:var(--green-tint);color:var(--green);font-size:11px;font-weight:800;padding:4px 10px;border-radius:6px;">Rx — prescription required</span>` : ""}
        <h2 style="font-size:21px;color:var(--navy);margin:10px 0 4px;">${escapeHtml(m.name)}</h2>
        <div style="font-size:13px;color:var(--text-muted);">${escapeHtml(m.brand)} · ${escapeHtml(m.unit)}</div>
        <div style="display:flex;align-items:baseline;gap:9px;margin:14px 0;">
          <span style="font-size:27px;font-weight:800;font-family:Sora,sans-serif;color:var(--navy);">${currency(m.price)}</span>
          <span style="text-decoration:line-through;color:var(--text-muted);">${currency(m.mrp)}</span>
          <span style="color:var(--green);font-weight:700;">${m.discount_pct}% off</span>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:18px;">
          ★ ${m.rating} · ${m.rating_count} ratings${m.concern ? ` · for ${escapeHtml(m.concern)}` : ""}
        </div>
        <button class="btn btn-primary btn-block padd" data-id="${m.id}">Add to cart</button>
      </div>
      <div style="height:18px;"></div>`;
    wirePcards(view());
  } catch (e) {
    view().innerHTML = `<div class="app-empty"><div class="ae">🔍</div>Product not found.</div>`;
  }
}

/* ---------- cart ---------- */

async function viewCart() {
  if (!me.user) { return requireLogin("See your cart"); }
  await refreshCart();

  if (!cartCache.items.length) {
    view().innerHTML = `<div class="app-empty"><div class="ae">🛒</div>
      Your cart is empty.<br><a href="#/shop" class="btn btn-primary btn-sm" style="margin-top:14px;">Browse medicines</a></div>`;
    return;
  }

  const fee = cartCache.total >= 199 ? 0 : 29;
  view().innerHTML = `
    <div style="padding-top:18px;">
      <h2 style="font-size:20px;color:var(--navy);margin:0 0 4px;">Your cart</h2>
      <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">${cartCount()} item(s) from your nearest chemist</div>
      <div id="cart-items">${cartCache.items.map(cartRow).join("")}</div>

      <div class="scroll-cue">↓ Scroll for price &amp; delivery address</div>

      <div class="panel reveal" style="margin-bottom:14px;">
        <div class="panel-title"><h3>Bill details</h3></div>
        <div class="summary-row"><span>Item total</span><span>${currency(cartCache.total)}</span></div>
        <div class="summary-row"><span>Delivery</span><span class="${fee ? "" : "free"}">${fee ? currency(fee) : "FREE"}</span></div>
        <div class="summary-row total"><span>To pay</span><span>${currency(cartCache.total + fee)}</span></div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px;">
          Your chemist may add a transport charge when the order is dispatched.
        </div>
      </div>

      <div class="panel reveal-2" style="margin-bottom:16px;">
        <div class="panel-title"><h3>Delivery address</h3></div>
        <div id="addr-slot"></div>
      </div>

      <button class="btn btn-primary btn-block" id="place-btn" style="margin-bottom:12px;">Proceed to payment</button>
    </div>
    <div style="height:20px;"></div>`;

  wireCartRows();
  renderAddressSlot();
  document.getElementById("place-btn").addEventListener("click", placeOrder);
}

function cartRow(line) {
  const m = line.medicine;
  const art = m.image ? `<img src="${m.image}" alt="">` : productIllustration(m.category, m.unit);
  return `
    <div class="cart-item" data-id="${m.id}">
      <div class="ci-img">${art}</div>
      <div class="ci-mid">
        <div class="ci-nm">${escapeHtml(m.name)}</div>
        <div class="ci-un">${escapeHtml(m.unit)}</div>
        <div class="ci-pr">${currency(line.subtotal)}</div>
      </div>
      <div class="qty-pill">
        <button data-act="dec">−</button><span>${line.qty}</span><button data-act="inc">+</button>
      </div>
    </div>`;
}

function wireCartRows() {
  document.querySelectorAll(".cart-item").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act="inc"]').addEventListener("click", () => changeQty(id, 1));
    row.querySelector('[data-act="dec"]').addEventListener("click", () => changeQty(id, -1));
  });
}

async function changeQty(id, delta) {
  const line = cartCache.items.find((l) => l.medicine.id === id);
  if (line && line.qty === 1 && delta < 0) {
    await api(`/api/cart/${id}`, { method: "DELETE" });
  } else {
    await api("/api/cart", { method: "POST", body: JSON.stringify({ medicine_id: id, qty: delta }) });
  }
  await viewCart();
}

function addressSheetHtml() {
  return `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px;">
      We use this to find the chemist closest to you.</p>
    <button class="btn btn-outline btn-block" id="sheet-detect" style="margin-bottom:12px;">📍 Use my current location</button>
    <div style="text-align:center;font-size:12px;color:var(--text-muted);margin-bottom:10px;">or type it in</div>
    <div class="addr-search" style="margin-bottom:16px;">
      <div class="addr-input-row">
        <input id="sheet-addr" placeholder="Building, area, city" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search">
      </div>
      <div class="addr-suggest" id="sheet-suggest"></div>
    </div>
    <button class="btn btn-primary btn-block" id="sheet-save">Find address</button>`;
}

function wireAddressSheet() {
  document.getElementById("sheet-detect").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.outerHTML = `<div class="locating" id="locating"><div class="radar"><i></i></div>
      <div><div style="font-weight:700;font-size:13.5px;">Finding you…</div>
      <div style="font-size:12px;color:var(--text-muted);">Checking your GPS position</div></div></div>`;
    try {
      const a = await detectLocation();
      saveAddress(a); paintWhere(); closeSheet(); renderAddressSlot(); toast("Address set");
    } catch (err) {
      document.getElementById("locating").outerHTML =
        `<div class="form-error">Couldn't get your location — type it below instead.</div>`;
    }
  });
  const search = attachAddressSearch({
    input: document.getElementById("sheet-addr"),
    list: document.getElementById("sheet-suggest"),
    onPick: (a) => { saveAddress(a); paintWhere(); closeSheet(); renderAddressSlot(); toast("Address set"); },
  });
  document.getElementById("sheet-save").addEventListener("click", search.submit);
}

function renderAddressSlot() {
  const slot = document.getElementById("addr-slot");
  if (!slot) return;
  const a = getSavedAddress();
  slot.innerHTML = a
    ? `<div style="font-size:13.5px;margin-bottom:10px;">📍 ${escapeHtml(a.label)}</div>
       <button class="btn btn-outline btn-sm btn-block" id="chg-addr">Change address</button>`
    : `<div class="form-note">No address set yet.</div>
       <button class="btn btn-primary btn-sm btn-block" id="chg-addr">Set delivery address</button>`;
  document.getElementById("chg-addr").addEventListener("click", () =>
    openSheet("Delivery address", addressSheetHtml(), wireAddressSheet));
}

async function placeOrder() {
  const a = getSavedAddress();
  if (!a) { openSheet("Delivery address", addressSheetHtml(), wireAddressSheet); return; }
  const btn = document.getElementById("place-btn");
  btn.disabled = true; btn.textContent = "Placing order…";
  try {
    await api("/api/orders", { method: "POST", body: JSON.stringify({ address: a }) });
    await refreshCart();
    toast("Order placed");
    location.hash = `#/orders`;
  } catch (e) {
    toast(e.message); btn.disabled = false; btn.textContent = "Proceed to payment";
  }
}

/* ---------- orders ---------- */

async function viewOrders() {
  if (!me.user) return requireLogin("Track your orders");
  if (me.user.role === "chemist") {
    view().innerHTML = `<div class="app-empty"><div class="ae">🏪</div>
      You're signed in as a chemist.<br>
      <a href="/chemist-dashboard.html" class="btn btn-primary btn-sm" style="margin-top:14px;">Open chemist dashboard</a></div>`;
    return;
  }
  view().innerHTML = `<div style="padding:40px;"><div class="spinner"></div></div>`;
  const { orders } = await api("/api/orders/mine");
  if (!orders.length) {
    view().innerHTML = `<div class="app-empty"><div class="ae">📦</div>No orders yet.
      <br><a href="#/shop" class="btn btn-primary btn-sm" style="margin-top:14px;">Start shopping</a></div>`;
    return;
  }

  const active = orders.find((o) => o.status !== "delivered");
  view().innerHTML = `
    <div style="padding-top:18px;">
      ${active ? liveOrderHtml(active) : ""}
      <h2 style="font-size:17px;color:var(--navy);margin:22px 0 12px;">All orders</h2>
      ${orders.map(orderRowHtml).join("")}
    </div><div style="height:16px;"></div>`;

  if (active && active.status !== "delivered") {
    clearTimeout(window.__ordPoll);
    window.__ordPoll = setTimeout(() => { if (location.hash.startsWith("#/orders")) viewOrders(); }, 4000);
  }
}

function scooterSvg() {
  return `
  <svg class="rider" viewBox="0 0 170 110" xmlns="http://www.w3.org/2000/svg">
    <!-- delivery box -->
    <rect x="22" y="40" width="34" height="30" rx="5" fill="#90E0EF" stroke="#0077B6" stroke-width="3"/>
    <path d="M31 55h16M39 47v16" stroke="#0077B6" stroke-width="3" stroke-linecap="round"/>

    <!-- scooter deck + body -->
    <path d="M52 76h56l14-26h-13l-7 13H56z" fill="#0077B6"/>
    <path d="M104 50h16l4-9h-14z" fill="#00B4D8"/>
    <rect x="112" y="30" width="26" height="5" rx="2.5" fill="#023E8A"/>
    <path d="M122 35v8" stroke="#023E8A" stroke-width="4" stroke-linecap="round"/>

    <!-- rider -->
    <circle cx="82" cy="27" r="11" fill="#03045E"/>
    <path d="M71 27a11 11 0 0 1 22 0z" fill="#0096C7"/>
    <path d="M76 38h14l8 22H72z" fill="#0077B6"/>
    <path d="M90 44l24-8" stroke="#0077B6" stroke-width="6" stroke-linecap="round"/>

    <!-- wheels -->
    <circle class="wheel" cx="58" cy="84" r="17" fill="#fff" stroke="#03045E" stroke-width="5"/>
    <circle class="wheel" cx="130" cy="84" r="17" fill="#fff" stroke="#03045E" stroke-width="5"/>
    <g class="wheel" style="transform-origin:58px 84px;">
      <path d="M58 72v24M46 84h24" stroke="#90E0EF" stroke-width="3.5" stroke-linecap="round"/>
    </g>
    <g class="wheel" style="transform-origin:130px 84px;">
      <path d="M130 72v24M118 84h24" stroke="#90E0EF" stroke-width="3.5" stroke-linecap="round"/>
    </g>
  </svg>`;
}

function liveOrderHtml(o) {
  const copy = {
    pending: ["Finding a nearby chemist", "We've pinged chemists around you"],
    accepted: ["Your order is being packed", "The chemist accepted it"],
    packed: ["Packed and ready", "Dispatching shortly"],
    out_for_delivery: ["Arriving in ~8 minutes", "Your delivery partner is on the way"],
    delivered: ["Delivered", "Hope you feel better soon"],
  }[o.status] || ["Working on it", ""];

  return `
    <div class="panel" style="padding:0;overflow:hidden;">
      <div class="scooter-scene">
        <div class="road"></div>
        ${scooterSvg()}
        <span class="puff" style="left:36%;width:9px;height:9px;"></span>
        <span class="puff" style="left:42%;width:7px;height:7px;animation-delay:.6s;"></span>
      </div>
      <div style="padding:16px 18px 18px;">
        <div style="font-family:Sora,sans-serif;font-size:18px;font-weight:800;color:var(--navy);">${copy[0]}</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin-top:3px;">${copy[1]}</div>
        <div class="stepper" style="margin-top:14px;">${stepperHtml(o.status)}</div>
        ${o.driver_name ? `
          <div class="driver-card" style="margin:10px 0 0;">
            <div class="driver-avatar">${escapeHtml(o.driver_name[0])}</div>
            <div><div class="name">${escapeHtml(o.driver_name)}</div>
            <div class="role">Delivery partner · ${escapeHtml(o.chemist_name || "")}</div></div>
          </div>` : ""}
        ${o.otp && o.status !== "pending" && o.status !== "delivered" ? `
          <div class="otp-panel" style="margin-top:14px;">
            <div class="otp-label">Share this OTP only when your order arrives</div>
            <div class="otp-tiles">${String(o.otp).split("").map((d) => `<div class="otp-tile">${d}</div>`).join("")}</div>
          </div>` : ""}
      </div>
    </div>`;
}

function orderRowHtml(o) {
  return `
    <div class="order-card" style="padding:14px;">
      <div class="top-row">
        <b style="font-size:13.5px;">Order #${o.id}</b>
        <span class="badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
      </div>
      <div style="font-size:12.5px;color:var(--text-muted);">
        ${o.items.length ? o.items.map((i) => `${escapeHtml(i.name)} ×${i.qty}`).join(", ") : "Prescription order"}
      </div>
      <div style="font-weight:800;margin-top:7px;color:var(--navy);">
        ${currency((o.total || 0) + (o.delivery_charge || 0))}
      </div>
    </div>`;
}

/* ---------- account ---------- */

async function viewAccount() {
  if (!me.user) return requireLogin("Manage your account");
  const u = me.user;
  view().innerHTML = `
    <div style="padding-top:20px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;">
        <div class="driver-avatar" style="width:58px;height:58px;font-size:22px;">
          ${escapeHtml((u.name || "?")[0].toUpperCase())}</div>
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--navy);font-family:Sora,sans-serif;">${escapeHtml(u.name)}</div>
          <div style="font-size:12.5px;color:var(--text-muted);">${escapeHtml(u.email)}</div>
          <span class="badge ${u.verified ? "online" : "pending"}" style="margin-top:5px;">
            ${u.verified ? "Email verified" : "Not verified"}</span>
        </div>
      </div>
      <div class="panel" style="padding:6px 0;margin-bottom:14px;">
        ${acctRow("📄", "Upload prescription", "/upload-prescription.html")}
        ${acctRow("🚚", "My orders", "#/orders")}
        ${u.role === "chemist" ? acctRow("🏪", "Chemist dashboard", "/chemist-dashboard.html") : ""}
        ${acctRow("📋", "Terms & conditions", "#", "terms")}
        ${acctRow("👥", "Contact us", "#", "contact")}
      </div>
      <button class="btn btn-outline btn-block" id="logout-btn">Log out</button>
    </div><div style="height:16px;"></div>`;

  view().querySelectorAll("[data-sheet]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const k = el.dataset.sheet;
      openSheet(k === "terms" ? "Terms & Conditions" : "Contact Us",
                k === "terms" ? TERMS_HTML : CONTACT_HTML);
    }));

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    me = { user: null }; await refreshCart();
    toast("Logged out"); location.hash = "#/home";
  });
}

function acctRow(icon, label, href, sheet) {
  return `<a href="${href}" ${sheet ? `data-sheet="${sheet}"` : ""}
     style="display:flex;align-items:center;gap:13px;padding:14px 18px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600;color:var(--text);">
     <span style="font-size:18px;">${icon}</span>${label}
     <span style="margin-left:auto;color:var(--text-muted);">›</span></a>`;
}

function requireLogin(what) {
  view().innerHTML = `
    <div class="app-empty">
      <div class="ae">🔒</div>
      <div style="font-size:15px;font-weight:700;color:var(--navy);margin-bottom:5px;">${escapeHtml(what)}</div>
      <div style="margin-bottom:18px;">Log in or create an account to continue.</div>
      <a href="/login.html" class="btn btn-primary">Log in / Sign up</a>
    </div>`;
}

/* ---------- bottom sheet ---------- */

function openSheet(title, html, onReady) {
  closeSheet();
  const back = document.createElement("div");
  back.className = "sheet-back"; back.id = "app-sheet";
  back.innerHTML = `<div class="sheet"><div class="sheet-grab"></div>
    <h3>${escapeHtml(title)}</h3><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(back);
  document.body.style.overflow = "hidden";
  back.addEventListener("click", (e) => { if (e.target === back) closeSheet(); });
  if (onReady) onReady();
}
function closeSheet() {
  const s = document.getElementById("app-sheet");
  if (s) s.remove();
  document.body.style.overflow = "";
}
