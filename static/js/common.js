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

async function geocodeAddress(query) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Address lookup failed");
  const results = await res.json();
  if (!results.length) throw new Error("Couldn't find that address");
  const r = results[0];
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name };
}

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
  if (me.user && me.user.role === "customer") {
    try {
      const cart = await api("/api/cart");
      cartCount = cart.items.reduce((s, i) => s + i.qty, 0);
    } catch (e) { /* ignore */ }
  }
  const loginBlock = me.user
    ? `<a href="#" id="logout-link" class="icon-link"><span class="glyph">\u{1F464}</span><span class="text">${escapeHtml(me.user.name.split(" ")[0])}</span></a>`
    : `<a href="/login.html" class="icon-link"><span class="glyph">\u{1F464}</span><span class="text">Login/Signup</span></a>`;
  const dashboardLink = me.user && me.user.role === "chemist"
    ? `<a href="/chemist-dashboard.html" class="icon-link"><span class="glyph">\u{1F3EA}</span><span class="text">Dashboard</span></a>` : "";
  el.innerHTML = `
    <a href="/upload-prescription.html" class="icon-link"><span class="glyph">\u{1F4C4}</span><span class="text">Upload Rx</span></a>
    <a href="/track-order.html" class="icon-link"><span class="glyph">\u{1F69A}</span><span class="text">Track Order</span></a>
    ${dashboardLink}
    <a href="/cart.html" class="icon-link"><span class="glyph">\u{1F6D2}</span><span class="text">Cart</span>${cartCount ? `<span class="cart-badge">${cartCount}</span>` : ""}</a>
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
  const emojiFallback = `<span class="thumb-emoji">${m.icon}</span>`;
  if (!m.image) return `<div class="thumb ${sizeClass || ""}">${emojiFallback}</div>`;
  return `<div class="thumb ${sizeClass || ""}">
    <img src="${m.image}" alt="${escapeHtml(m.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'thumb-emoji',textContent:'${m.icon}'}))">
  </div>`;
}

function productCardHtml(m) {
  return `
    <div class="product-card tilt-card">
      ${productThumbHtml(m)}
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="unit">${escapeHtml(m.unit)}</div>
      <div class="price-row">
        <span class="price">${currency(m.price)}</span>
        <span class="mrp">${currency(m.mrp)}</span>
        <span class="off">${m.discount_pct}% OFF</span>
      </div>
      <div class="rating">⭐ ${m.rating} (${m.rating_count})</div>
      <button class="btn btn-outline btn-sm btn-block add-to-cart-btn" data-id="${m.id}">🛒 Add to Cart</button>
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

function wireAddToCart(scope) {
  scope.querySelectorAll(".add-to-cart-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      try {
        await api("/api/cart", { method: "POST", body: JSON.stringify({ medicine_id: id, qty: 1 }) });
        toast("Added to cart");
        renderNavActions();
      } catch (e) {
        if (e.message.includes("Login")) {
          toast("Please login to add items to your cart");
        } else {
          toast(e.message);
        }
      }
    });
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
            <a href="/">About InstaRX</a>
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
            <a href="#">Help Center</a>
            <a href="#">Contact Us</a>
            <a href="#">Terms & Privacy</a>
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

document.addEventListener("DOMContentLoaded", () => {
  renderFooter();
});
