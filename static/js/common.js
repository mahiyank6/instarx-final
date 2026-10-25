// Shared helpers used across every page.

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const msg = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function currency(n) {
  return "₹" + Number(n).toFixed(0);
}

const STATUS_LABELS = {
  pending: "Order Placed",
  accepted: "Accepted by Chemist",
  packed: "Packed",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

const STATUS_STEPS = ["pending", "accepted", "packed", "out_for_delivery", "delivered"];
const STATUS_STEP_LABELS = ["Confirmed", "Accepted", "Packed", "Out for Delivery", "Delivered"];

function stepperHtml(status) {
  const idx = STATUS_STEPS.indexOf(status);
  return STATUS_STEPS.map((s, i) => {
    let cls = "step";
    const isLastAndReached = i === idx && i === STATUS_STEPS.length - 1;
    if (i < idx || isLastAndReached) cls += " done";
    else if (i === idx) cls += " current";
    const dotContent = (i < idx || isLastAndReached) ? "✓" : i + 1;
    return `<div class="${cls}"><div class="dot">${dotContent}</div><div class="label">${STATUS_STEP_LABELS[i]}</div></div>`;
  }).join("");
}

// ---------- location detection (Geolocation API + OpenStreetMap Nominatim, both free) ----------

async function detectLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data && data.display_name) label = data.display_name;
          }
        } catch (e) { /* fall back to coordinates */ }
        resolve({ lat: latitude, lng: longitude, label });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ---------- address search ----------
// Free-text geocoding fails on exactly the addresses people type: a building
// name OpenStreetMap has never heard of ("Krishna Heights"), or a misspelt city
// ("Ahemdabad"). Nominatim returns nothing for either, so we:
//   1. fix common city misspellings,
//   2. ask two services at once (Nominatim is exact, Photon forgives typos),
//   3. if the full string finds nothing, drop the most specific part and retry,
//      keeping the dropped part as "near <landmark>" so the chemist still reads
//      the building name the customer typed,
//   4. rank results near the customer's saved location, and discard far-away
//      namesakes unless the customer actually typed that region.
// The customer always picks from the list; nothing is chosen silently.

const CITY_FIXES = {
  ahemdabad: "ahmedabad", ahemedabad: "ahmedabad", ahemadabad: "ahmedabad", ahmdabad: "ahmedabad",
  ahmedbad: "ahmedabad", amdavad: "ahmedabad", bangaluru: "bengaluru", bangalore: "bengaluru",
  hydrebad: "hyderabad", hyderbad: "hyderabad", gandhinagr: "gandhinagar", gandinagar: "gandhinagar",
  vadodra: "vadodara", baroda: "vadodara", sorat: "surat", rajkot: "rajkot", gurgaon: "gurugram",
};
const NEARBY_KM = 120;
const GEO_TIMEOUT_MS = 7000;
let _lastNominatimAt = 0;

function normaliseAddressQuery(q) {
  return String(q).replace(/[.]+/g, " ").replace(/\s+/g, " ").trim()
    .split(/\b/).map((w) => CITY_FIXES[w.toLowerCase()] || w).join("");
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s,-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function geoFetchJson(url, headers) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) { return null; }       // null = the service was unreachable
  finally { clearTimeout(timer); }
}

function splitLabel(label) {
  const parts = label.split(",").map((s) => s.trim()).filter(Boolean);   // also drops empty parts like ",,"
  return { title: parts[0] || label, sub: parts.slice(1).join(", "), parts };
}

async function nominatimSearch(text, near) {
  // Nominatim's usage policy is one request a second.
  const wait = _lastNominatimAt + 1050 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastNominatimAt = Date.now();
  let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&accept-language=en&q=${encodeURIComponent(text)}`;
  if (near) {
    const d = 0.8;   // soft bias box, not a hard limit
    url += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=0`;
  }
  const data = await geoFetchJson(url);
  if (data === null) return null;
  return data.map((r) => {
    const s = splitLabel(r.display_name);
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name, title: s.title, sub: s.sub,
             regions: s.parts.slice(1).filter((p) => !/^\d+$/.test(p)).map((p) => p.toLowerCase()), name: s.title.toLowerCase() };
  });
}

async function photonSearch(text, near) {
  let url = `https://photon.komoot.io/api/?limit=6&lang=en&bbox=68,6,98,36&q=${encodeURIComponent(text)}`;
  if (near) url += `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.6`;
  const data = await geoFetchJson(url);
  if (data === null) return null;
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const street = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street;
    const title = p.name || street || p.district || p.city || "";
    const bits = [p.name ? street : null, p.locality, p.district, p.city, p.county, p.state, p.postcode]
      .filter(Boolean).filter((v, i, a) => v !== title && a.indexOf(v) === i);
    return {
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      label: [title, ...bits].join(", ").replace(/,(\s*,)+/g, ","), title, sub: bits.join(", ").replace(/,(\s*,)+/g, ","),
      regions: [p.locality, p.district, p.city, p.county, p.state].filter(Boolean).map((v) => v.toLowerCase()),
      name: title.toLowerCase(),
    };
  });
}

function dedupeResults(list) {
  const seen = new Set();
  return list.filter((r) => {
    const key = `${r.title.toLowerCase()}|${r.lat.toFixed(3)}|${r.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Keep a result if there is no known location, it is close to it, or the
// customer typed the region it sits in.
function relevantTo(query, near, r) {
  if (!near) return true;
  if (distanceKm(near, r) <= NEARBY_KM) return true;
  const q = query.toLowerCase();
  return r.regions.some((reg) => reg.length >= 3 && q.includes(reg));
}

async function searchAddresses(raw, opts = {}) {
  const near = opts.near === undefined ? getSavedAddress() : opts.near;
  const query = normaliseAddressQuery(raw);
  if (query.length < 3) return { results: [], offline: false };

  // Progressively less specific versions of what they typed.
  const attempts = [];
  const parts = query.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (let i = 0; i < Math.min(parts.length - 1, 3); i++) {
      attempts.push({ text: parts.slice(i).join(", "), dropped: parts.slice(0, i).join(", ") });
    }
  } else {
    const words = query.split(" ");
    attempts.push({ text: query, dropped: "" });
    if (words.length >= 4) attempts.push({ text: words.slice(2).join(" "), dropped: words.slice(0, 2).join(" ") });
  }

  let reachable = false;
  for (const a of attempts) {
    if (opts.signal && opts.signal.aborted) return { results: [], aborted: true };
    const [nom, pho] = await Promise.all([nominatimSearch(a.text, near), photonSearch(a.text, near)]);
    if (nom !== null || pho !== null) reachable = true;
    let found = dedupeResults([...(nom || []), ...(pho || [])]).filter((r) => relevantTo(query, near, r));
    if (near) found.sort((x, y) => distanceKm(near, x) - distanceKm(near, y));
    if (found.length) {
      found = found.slice(0, 6).map((r) => (a.dropped
        ? { ...r, approx: true, label: `${titleCase(a.dropped)}, near ${r.label}`, typed: titleCase(a.dropped) }
        : { ...r, approx: false }));
      return { results: found, offline: false };
    }
  }
  return { results: [], offline: !reachable };
}

// Best single match, for callers that just need coordinates.
async function geocodeAddress(query) {
  const { results, offline } = await searchAddresses(query);
  if (!results.length) throw new Error(offline ? "Address search is unreachable, check your connection" : "Couldn't find that address");
  const r = results[0];
  return { lat: r.lat, lng: r.lng, label: r.label };
}

// Wires a text input to a live suggestion list. onPick receives {lat,lng,label}.
function attachAddressSearch({ input, list, onPick }) {
  let timer = null, ctl = null, current = [], active = -1;

  const close = () => { list.classList.remove("show"); active = -1; };
  const paint = (html) => { list.innerHTML = html; list.classList.add("show"); };

  const pick = (i) => {
    const r = current[i];
    if (!r) return;
    close();
    onPick({ lat: r.lat, lng: r.lng, label: r.label });
  };

  async function run(immediate) {
    clearTimeout(timer);
    const q = input.value.trim();
    if (ctl) ctl.abort();
    if (q.length < 3) { close(); return null; }
    return new Promise((resolve) => {
      timer = setTimeout(async () => {
        ctl = new AbortController();
        paint(`<div class="addr-state"><span class="addr-spin"></span>Searching addresses…</div>`);
        const { results, offline, aborted } = await searchAddresses(q, { signal: ctl.signal });
        if (aborted || input.value.trim() !== q) { resolve(null); return; }
        current = results; active = -1;
        if (!results.length) {
          paint(`<div class="addr-state">${offline
            ? "Address search is unreachable. Check your connection, or use your current location."
            : "No match found. Try the area and city, for example &quot;Gota, Ahmedabad&quot;."}</div>`);
        } else {
          paint((results[0].approx
            ? `<div class="addr-hint">Couldn't find &quot;${escapeHtml(results[0].typed)}&quot; on the map. Pick the nearest place and we will keep your building name.</div>` : "") +
            results.map((r, i) => `
            <button type="button" class="addr-item" data-i="${i}">
              <span class="addr-pin">\u{1F4CD}</span>
              <span class="addr-text"><span class="addr-title">${escapeHtml(r.approx ? `${r.typed}, near ${r.title}` : r.title)}</span>
              <span class="addr-sub">${escapeHtml(r.sub)}</span></span>
            </button>`).join(""));
        }
        resolve(results);
      }, immediate ? 0 : 550);
    });
  }

  input.addEventListener("input", () => run(false));
  input.addEventListener("focus", () => { if (current.length && input.value.trim().length >= 3) list.classList.add("show"); });
  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll(".addr-item");
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); active = (active + 1) % items.length; }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) pick(active); else submit(); return; }
    else if (e.key === "Escape") { close(); return; }
    else return;
    items.forEach((el, i) => el.classList.toggle("active", i === active));
    if (items[active]) items[active].scrollIntoView({ block: "nearest" });
  });
  list.addEventListener("mousedown", (e) => e.preventDefault());   // keep focus so the tap registers
  list.addEventListener("click", (e) => {
    const item = e.target.closest(".addr-item");
    if (item) pick(Number(item.dataset.i));
  });
  document.addEventListener("click", (e) => { if (!list.contains(e.target) && e.target !== input) close(); });

  // "Set" button: search now; take the result only when it is an exact hit,
  // otherwise leave the list open so the customer chooses.
  async function submit() {
    const q = input.value.trim();
    if (!q) { toast("Type an address first"); return; }
    const results = await run(true);
    if (results && results.length === 1 && !results[0].approx) pick(0);
    else if (results && results.length) toast("Tap the address that matches yours");
  }
  return { submit };
}

// ---------- add to cart + in-card quantity stepper ----------
// After ADD the button turns into a - qty + control, kept in step across every
// card for the same medicine on the page. Requests for one medicine are queued
// so quick taps can't reach the server out of order.

const cartQty = {};            // medicine_id -> quantity in the signed-in customer's cart
let cartQtyPromise = null;
const cartQueue = {};
let cartRole = null;           // "customer", "chemist", or null when signed out
let badgeTimer = null;

function loadCartQty() {
  cartQtyPromise = (async () => {
    try {
      // Ask who is signed in first, so a signed-out visitor never triggers a 401.
      const who = await api("/api/me");
      cartRole = who.user ? who.user.role : null;
      Object.keys(cartQty).forEach((k) => delete cartQty[k]);
      if (cartRole !== "customer") return;
      const cart = await api("/api/cart");
      cart.items.forEach((i) => { cartQty[i.medicine.id] = i.qty; });
    } catch (e) { /* cards simply show ADD */ }
  })();
  return cartQtyPromise;
}

function cardActionHtml(id) {
  const qty = cartQty[id] || 0;
  if (!qty) return `<button class="btn btn-outline btn-sm btn-block add-to-cart-btn" data-act="add" data-id="${id}">ADD</button>`;
  return `<div class="card-stepper" role="group" aria-label="Quantity">
      <button type="button" data-act="dec" aria-label="Remove one">−</button>
      <span class="n">${qty}</span>
      <button type="button" data-act="inc" aria-label="Add one">+</button>
    </div>`;
}

function paintCardActions(root) {
  (root || document).querySelectorAll(".card-action").forEach((slot) => {
    slot.innerHTML = cardActionHtml(Number(slot.dataset.id));
  });
}

function refreshBadgeSoon() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(renderNavActions, 350);
}

function setCardQty(id, qty) {
  if (qty > 0) cartQty[id] = qty; else delete cartQty[id];
  document.querySelectorAll(`.card-action[data-id="${id}"]`).forEach((slot) => {
    slot.innerHTML = cardActionHtml(id);
  });
}

async function onCardAction(e) {
  const btn = e.target.closest("[data-act]");
  const slot = btn && btn.closest(".card-action");
  if (!slot) return;
  const id = Number(slot.dataset.id);
  const act = btn.dataset.act;
  if (cartQtyPromise) await cartQtyPromise;  // a tap in the first moments must not misread "signed out"
  if (cartRole !== "customer") {            // no stepper flash for someone who can't order
    toast(cartRole ? "Chemist accounts can't place orders" : "Please login to add items to your cart");
    return;
  }
  const prev = cartQty[id] || 0;
  const next = act === "dec" ? prev - 1 : prev + 1;
  if (next < 0) return;
  setCardQty(id, next);                                   // optimistic
  cartQueue[id] = (cartQueue[id] || Promise.resolve()).then(async () => {
    try {
      if (next === 0) await api(`/api/cart/${id}`, { method: "DELETE" });
      else await api("/api/cart", { method: "POST", body: JSON.stringify({ medicine_id: id, qty: act === "dec" ? -1 : 1 }) });
      if (act === "add") toast("Added to cart");
      refreshBadgeSoon();
    } catch (err) {
      toast(err.message.includes("Login") ? "Please login to add items to your cart" : err.message);
      await loadCartQty();
      paintCardActions();
    }
  });
}

function wireAddToCart(scope) {
  if (!scope.dataset.cartWired) {
    scope.dataset.cartWired = "1";
    scope.addEventListener("click", onCardAction);
  }
  (cartQtyPromise || loadCartQty()).then(() => paintCardActions(scope));
}

// Coming back with the browser's back button can show a stale page.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) loadCartQty().then(() => paintCardActions());
});

function getSavedAddress() {
  const raw = localStorage.getItem("instarx_address");
  return raw ? JSON.parse(raw) : null;
}

function saveAddress(addr) {
  localStorage.setItem("instarx_address", JSON.stringify(addr));
}

// ---------- header (navbar) shared across pages ----------

function renderHeader(activeCategory) {
  const el = document.getElementById("site-header");
  if (!el) return;
  const addr = getSavedAddress();
  el.innerHTML = `
    <div class="top-strip">
      <div class="container">
        <span>\u{1F4CD} ${addr ? escapeHtml(truncate(addr.label, 46)) : "Detecting your location..."}</span>
        <span class="strip-credit">Ⓒ Website made by MAYANK GORADIYA</span>
        <span>\u{1F69A} FREE delivery from your nearest local chemist</span>
      </div>
    </div>
    <header class="navbar">
      <div class="container">
        <a href="/" class="brand">
          <span class="logo">Insta<span class="dot">RX</span></span>
          <span class="tagline">Fast relief is what matters the most</span>
        </a>
        <div class="search-wrap">
          <form class="search-box" id="search-form" autocomplete="off">
            <input type="text" id="search-input" placeholder="Search for medicines, health products...">
            <button type="submit">Search</button>
          </form>
          <div class="search-suggestions" id="search-suggestions"></div>
        </div>
        <div class="nav-actions" id="nav-actions"></div>
      </div>
    </header>
    <nav class="category-nav">
      <div class="container" id="category-nav-list"></div>
    </nav>
  `;
  renderNavActions();
  wireSearch();
  renderCategoryNav(activeCategory);
  ensureAddress();
}

async function renderNavActions() {
  const el = document.getElementById("nav-actions");
  let me = { user: null };
  try { me = await api("/api/me"); } catch (e) { /* ignore */ }
  let cartCount = 0;
  let rxBadge = 0;     // chemist: prescriptions not opened yet; customer: replies waiting for an answer
  if (me.user && me.user.role === "customer") {
    const [cart, rx] = await Promise.all([api("/api/cart").catch(() => null), api("/api/rx-requests/mine").catch(() => null)]);
    if (cart) cartCount = cart.items.reduce((s, i) => s + i.qty, 0);
    if (rx) rxBadge = rx.requests.filter((r) => r.status === "awaiting_customer").length;
  } else if (me.user && me.user.role === "chemist") {
    try { rxBadge = (await api("/api/chemist/rx-requests")).new_count; } catch (e) { /* ignore */ }
  }
  const badge = (n) => (n ? `<span class="cart-badge">${n}</span>` : "");
  // The account link carries `acct-link` so the phone layout can lift it up
  // beside the logo while the other tools stay together in their own row.
  const loginBlock = me.user
    ? `<a href="#" id="logout-link" class="icon-link acct-link" aria-label="Log out" title="Log out"><span class="glyph">\u{1F464}</span><span class="text">${escapeHtml(me.user.name.split(" ")[0])}</span></a>`
    : `<a href="/login.html" class="icon-link acct-link" aria-label="Login or sign up" title="Login or sign up"><span class="glyph">\u{1F464}</span><span class="text">Login/Signup</span></a>`;
  const dashboardLink = me.user && me.user.role === "chemist"
    ? `<a href="/chemist-dashboard.html" class="icon-link" aria-label="Dashboard" title="Dashboard"><span class="glyph">\u{1F3EA}</span><span class="text">Dashboard</span></a>` : "";
  // Chemists don't upload prescriptions, they read them.
  const rxLink = me.user && me.user.role === "chemist"
    ? `<a href="/chemist-dashboard.html#documents" class="icon-link" aria-label="View documents" title="View documents"><span class="glyph">\u{1F4CB}</span><span class="text">View documents</span>${badge(rxBadge)}</a>`
    : `<a href="/upload-prescription.html" class="icon-link" aria-label="Upload prescription" title="Upload prescription"><span class="glyph">\u{1F4C4}</span><span class="text">Upload Rx</span>${badge(rxBadge)}</a>`;
  el.innerHTML = `
    ${rxLink}
    <a href="/track-order.html" class="icon-link" aria-label="Track order" title="Track order"><span class="glyph">\u{1F69A}</span><span class="text">Track Order</span></a>
    ${dashboardLink}
    <a href="/cart.html" class="icon-link" aria-label="Cart" title="Cart"><span class="glyph">\u{1F6D2}</span><span class="text">Cart</span>${badge(cartCount)}</a>
    ${loginBlock}
  `;
  const logoutLink = document.getElementById("logout-link");
  if (logoutLink) {
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      await api("/api/logout", { method: "POST" });
      toast("Logged out");
      window.location.href = "/";
    });
  }
}

async function renderCategoryNav(active) {
  const el = document.getElementById("category-nav-list");
  if (!el) return;
  try {
    const { categories } = await api("/api/categories");
    el.innerHTML = categories.map((c) => `<a href="/category.html?cat=${encodeURIComponent(c.name)}" ${active === c.name ? 'style="color:var(--primary-dark)"' : ""}>${c.icon} ${escapeHtml(c.name)}</a>`).join("");
  } catch (e) {
    el.innerHTML = "";
  }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function productThumbHtml(m, sizeClass) {
  // Real Wikimedia packshot where we have one, otherwise a drawn illustration.
  const illus = productIllustration(m.category, m.unit);
  const rxBadge = m.rx ? `<span class="rx-badge">Rx</span>` : "";
  if (!m.image) {
    return `<div class="thumb ${sizeClass || ""}">${rxBadge}${illus}</div>`;
  }
  const esc = (s) => String(s || "").replace(/'/g, "\\'");
  return `<div class="thumb ${sizeClass || ""}">${rxBadge}
    <img src="${m.image}" alt="${escapeHtml(m.name)}" loading="lazy"
         onerror="this.outerHTML=productIllustration('${esc(m.category)}','${esc(m.unit)}')">
  </div>`;
}

function productCardHtml(m) {
  return `
    <div class="product-card">
      ${productThumbHtml(m)}
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="unit">${escapeHtml(m.unit)}</div>
      <div class="price-row">
        <span class="price">${currency(m.price)}</span>
        <span class="mrp">${currency(m.mrp)}</span>
        <span class="off">${m.discount_pct}% OFF</span>
      </div>
      <div class="rating">★ ${m.rating} (${m.rating_count})</div>
      <div class="card-action" data-id="${m.id}">${cardActionHtml(m.id)}</div>
    </div>`;
}

// ---------- 3D tilt-on-hover (pure CSS transform, no libraries) ----------

function enable3DTilt(root) {
  (root || document).querySelectorAll(".tilt-card:not([data-tilt-wired])").forEach((card) => {
    card.setAttribute("data-tilt-wired", "1");
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(700px) rotateX(${(-py * 10).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg) translateY(-4px)`;
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  });
}

async function ensureAddress() {
  if (getSavedAddress()) return;
  try {
    const addr = await detectLocation();
    saveAddress(addr);
    renderHeader();
  } catch (e) {
    // user may deny permission; that's fine, they can set it manually on checkout
  }
}

function wireSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const box = document.getElementById("search-suggestions");
  if (!form) return;
  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { box.classList.remove("show"); return; }
    debounce = setTimeout(async () => {
      try {
        const { medicines } = await api(`/api/medicines?q=${encodeURIComponent(q)}`);
        if (!medicines.length) {
          box.innerHTML = `<div class="suggestion-empty">No matches for "${escapeHtml(q)}"</div>`;
        } else {
          box.innerHTML = medicines.slice(0, 8).map((m) => `
            <a class="suggestion-item" href="/category.html?cat=${encodeURIComponent(m.category)}">
              <span class="icon">${m.icon}</span>
              <span>
                <div class="name">${escapeHtml(m.name)}</div>
                <div class="meta">${escapeHtml(m.brand)} · ${escapeHtml(m.category)}</div>
              </span>
              <span class="price">${currency(m.price)}</span>
            </a>`).join("");
        }
        box.classList.add("show");
      } catch (e) { /* ignore */ }
    }, 250);
  });
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) box.classList.remove("show");
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) window.location.href = `/category.html?q=${encodeURIComponent(q)}`;
  });
}

function renderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.innerHTML = `
    <div class="trust-strip">
      <div class="container trust-grid">
        <div class="trust-item"><div class="icon">✅</div><div class="t">Verified Local Chemists</div><div class="d">Every partner license-checked</div></div>
        <div class="trust-item"><div class="icon">⏱️</div><div class="t">10-Minute Promise</div><div class="d">Packed and dispatched fast</div></div>
        <div class="trust-item"><div class="icon">\u{1F4CD}</div><div class="t">Hyperlocal Matching</div><div class="d">Ordered from the shop nearest you</div></div>
        <div class="trust-item"><div class="icon">\u{1F510}</div><div class="t">Secure Checkout</div><div class="d">Your data stays protected</div></div>
        <div class="trust-item"><div class="icon">\u{1F4AC}</div><div class="t">Always-On Support</div><div class="d">Help whenever you need it</div></div>
      </div>
    </div>
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <div class="logo">InstaRX</div>
            <p style="margin-top:10px;max-width:280px;">Connecting you to verified local chemists for medicine delivery in minutes, not hours.</p>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/" id="footer-about">About InstaRX</a>
            <a href="/login.html?mode=signup&role=chemist">Partner your Pharmacy</a>
            <a href="/login.html">Careers</a>
          </div>
          <div>
            <h4>For Customers</h4>
            <a href="/category.html">Browse Medicines</a>
            <a href="/upload-prescription.html">Upload Prescription</a>
            <a href="/track-order.html">Track Order</a>
          </div>
          <div>
            <h4>Support</h4>
            <a href="#" id="footer-help">Help Center</a>
            <a href="#" id="footer-contact">Contact Us</a>
            <a href="#" id="footer-terms">Terms &amp; Conditions</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; 2026 InstaRX — A university project prototype, not a real pharmacy service.</span>
          <span>Made with care for faster relief.</span>
        </div>
      </div>
    </footer>
  `;
}

/* ---------- in-screen modal (Terms, Contact, Help) ---------- */

function openModal(title, bodyHtml) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "app-modal";
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = "hidden";
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
  wrap.querySelector(".modal-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() {
  const m = document.getElementById("app-modal");
  if (m) m.remove();
  document.body.style.overflow = "";
  document.removeEventListener("keydown", escClose);
}

const TERMS_HTML = `
  <p class="modal-lead">InstaRX is a student project built for academic evaluation. It is not a
  licensed pharmacy and does not dispense real medicine.</p>
  <h4>1. Nature of the service</h4>
  <p>InstaRX acts only as a digital bridge between a customer and a registered local chemist.
  We do not stock, own, dispense or deliver any medicine ourselves. Every order is fulfilled by
  the partnered chemist who accepts it.</p>
  <h4>2. Prescriptions</h4>
  <p>Products marked <b>Rx</b> legally require a valid prescription. The accepting chemist is
  responsible for verifying it before dispensing. Uploading a prescription does not guarantee
  that an order will be accepted.</p>
  <h4>3. Pricing and payment</h4>
  <p>Prices shown are indicative. The chemist may add a delivery charge for arranging their own
  transport, which is shown to you before dispatch. No real payment is processed anywhere in
  this project.</p>
  <h4>4. Delivery and OTP</h4>
  <p>Delivery timelines are estimates, not guarantees. A one-time password is generated for every
  order and must only be shared with the delivery partner once the order is physically in hand.</p>
  <h4>5. Your data</h4>
  <p>Account details are stored on the server running this project. Passwords are stored as
  one-way hashes and are never readable. Location is used only to find nearby chemists.</p>
  <h4>6. Medical disclaimer</h4>
  <p>Nothing on InstaRX is medical advice. Always consult a qualified doctor or pharmacist
  before taking any medicine.</p>`;

const CONTACT_HTML = `
  <p class="modal-lead">Project team — Diploma in Computer Science &amp; Engineering (AI/ML)</p>
  <div class="contact-grid">
    <div class="contact-card">
      <div class="contact-avatar">01</div>
      <div><div class="cname">Mayank Goradiya</div>
      <div class="cmeta"><a href="mailto:2402021000061@silveroakuni.ac.in">2402021000061@silveroakuni.ac.in</a></div>
      <div class="cmeta">Enrolment: [enrolment no.]</div>
      <div class="cmeta">Phone: [phone number]</div></div>
    </div>
    <div class="contact-card">
      <div class="contact-avatar">02</div>
      <div><div class="cname">Dhruvil Patel</div>
      <div class="cmeta"><a href="mailto:2402021000039@silveroakuni.ac.in">2402021000039@silveroakuni.ac.in</a></div>
      <div class="cmeta">Enrolment: [enrolment no.]</div>
      <div class="cmeta">Phone: [phone number]</div></div>
    </div>
    <div class="contact-card">
      <div class="contact-avatar">03</div>
      <div><div class="cname">Yuvraj Kumar</div>
      <div class="cmeta"><a href="mailto:2402021000055@silveroakuni.ac.in">2402021000055@silveroakuni.ac.in</a></div>
      <div class="cmeta">Enrolment: [enrolment no.]</div>
      <div class="cmeta">Phone: [phone number]</div></div>
    </div>
    <div class="contact-card">
      <div class="contact-avatar">04</div>
      <div><div class="cname">Kshatriya Adarsh</div>
      <div class="cmeta"><a href="mailto:2402021000058@silveroakuni.ac.in">2402021000058@silveroakuni.ac.in</a></div>
      <div class="cmeta">Enrolment: [enrolment no.]</div>
      <div class="cmeta">Phone: [phone number]</div></div>
    </div>
  </div>
  <p class="modal-note">Enrolment and phone numbers to be added.</p>`;

const HELP_HTML = `
  <h4>How do I order?</h4>
  <p>Search or browse, add items to your cart, set your delivery address, then place the order.
  The nearest online chemist receives it and confirms.</p>
  <h4>How long does delivery take?</h4>
  <p>Orders are targeted at 10 minutes, depending on how far your nearest partner chemist is.</p>
  <h4>What is the OTP for?</h4>
  <p>It confirms the handover. Share the 4-digit code with the delivery partner only once your
  order is physically in your hand.</p>
  <h4>I am a chemist — how do I join?</h4>
  <p>Use <b>Partner your Pharmacy</b> in the footer to create a chemist account, then switch
  yourself online to start receiving nearby orders.</p>`;

const ABOUT_HTML = `
  <p>InstaRX is a university project that brings local chemists online. Instead of delivering from a distant
  warehouse, an order goes to the nearest verified chemist, who packs it and delivers it to your door.
  Customers can search medicines, send prescriptions for the chemist to check, and track their order live.
  Local pharmacies gain visibility, and people get medicines faster.</p>`;

function wireFooterLinks() {
  const bind = (id, title, html) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); openModal(title, html); });
  };
  bind("footer-about", "About InstaRX", ABOUT_HTML);
  bind("footer-terms", "Terms & Conditions", TERMS_HTML);
  bind("footer-contact", "Contact Us", CONTACT_HTML);
  bind("footer-help", "Help Centre", HELP_HTML);
}

/* ---------- splash screen ---------- */

function showSplash() {
  if (sessionStorage.getItem("instarx_splash_shown")) return;
  sessionStorage.setItem("instarx_splash_shown", "1");

  const el = document.createElement("div");
  el.className = "splash";
  el.innerHTML = `
    <div class="splash-inner">
      <div class="splash-mark">
        <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="spA" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#00B4D8"/><stop offset="100%" stop-color="#0077B6"/>
            </linearGradient>
            <linearGradient id="spB" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#CAF0F8"/><stop offset="100%" stop-color="#90E0EF"/>
            </linearGradient>
          </defs>
          <g transform="rotate(-28 60 60)">
            <rect class="cap-a" x="15" y="42" width="90" height="36" rx="18" fill="url(#spA)"/>
            <path class="cap-b" d="M60 42h27a18 18 0 0 1 0 36H60z" fill="url(#spB)"/>
            <rect x="58.5" y="42" width="3" height="36" fill="#fff" opacity=".85"/>
          </g>
        </svg>
      </div>
      <div class="splash-name">Insta<span>RX</span></div>
      <div class="splash-tag">Fast relief is what matters the most</div>
      <div class="splash-bar"><i></i></div>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    el.classList.add("splash-out");
    document.body.style.overflow = "";
    setTimeout(() => el.remove(), 650);
  }, 2400);
}

document.addEventListener("DOMContentLoaded", () => {
  renderFooter();
  wireFooterLinks();
});
