document.addEventListener("DOMContentLoaded", async () => {
  showSplash();
  renderHeader();
  loadQuickSelect();
  loadCategories();
  loadTopSelling();
  loadLiveTracking();
  wireLocationPill();
});

/* ---------- Quick Select ---------- */

let activeConcern = null;

async function loadQuickSelect() {
  const rail = document.getElementById("concern-rail");
  try {
    const { concerns } = await api("/api/concerns");
    if (!concerns.length) { document.getElementById("quick-select").style.display = "none"; return; }
    activeConcern = concerns[0].name;
    rail.innerHTML = concerns.map((c) => `
      <button class="concern-chip ${c.name === activeConcern ? "active" : ""}" data-concern="${escapeHtml(c.name)}">
        <span class="em">${c.icon}</span>${escapeHtml(c.name)}
      </button>`).join("");
    rail.querySelectorAll(".concern-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeConcern = btn.dataset.concern;
        rail.querySelectorAll(".concern-chip").forEach((b) => b.classList.toggle("active", b === btn));
        loadQuickProducts();
      });
    });
    loadQuickProducts();
  } catch (e) {
    document.getElementById("quick-select").style.display = "none";
  }
}

async function loadQuickProducts() {
  const grid = document.getElementById("quick-grid");
  grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:28px;"><div class="spinner"></div></div>`;
  try {
    const { medicines } = await api(`/api/medicines?concern=${encodeURIComponent(activeConcern)}&limit=5`);
    grid.innerHTML = medicines.map(productCardHtml).join("");
    wireAddToCart(grid);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Couldn't load products.</div>`;
  }
}

/* ---------- rest of the homepage ---------- */

async function wireLocationPill() {
  const pill = document.getElementById("location-pill");
  const btn = document.getElementById("change-location-btn");
  const span = pill.querySelector("span");

  function paint() {
    const addr = getSavedAddress();
    span.textContent = addr ? `📍 ${truncate(addr.label, 58)}` : "📍 Location not set";
  }
  paint();

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    span.textContent = "📍 Detecting your location…";
    try {
      const addr = await detectLocation();
      saveAddress(addr);
      paint();
      renderHeader();
      toast("Location updated");
    } catch (e) {
      toast("Location permission denied — set it manually in your cart");
      paint();
    }
    btn.disabled = false;
  });

  if (!getSavedAddress()) btn.click();
}

async function loadCategories() {
  const el = document.getElementById("category-grid");
  try {
    const { categories } = await api("/api/categories");
    el.innerHTML = categories.map((c) => `
      <a class="category-card" href="/category.html?cat=${encodeURIComponent(c.name)}">
        <div class="emoji">${c.icon}</div>
        <div class="label">${escapeHtml(c.name)}</div>
      </a>`).join("");
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load categories.</div>`;
  }
}

async function loadTopSelling() {
  const el = document.getElementById("top-selling");
  try {
    const { medicines } = await api("/api/medicines?popular=1");
    el.innerHTML = medicines.map(productCardHtml).join("");
    wireAddToCart(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load medicines.</div>`;
  }
}

async function loadLiveTracking() {
  const el = document.getElementById("live-tracking-panel");
  let me;
  try { me = await api("/api/me"); } catch (e) { me = { user: null }; }
  if (!me.user || me.user.role !== "customer") {
    el.innerHTML = `<div class="empty-state" style="padding:22px 0;"><div class="big-emoji">📦</div>Log in as a customer to see live order status here.</div>`;
    return;
  }
  try {
    const { orders } = await api("/api/orders/mine");
    const active = orders.find((o) => o.status !== "delivered");
    if (!active) {
      el.innerHTML = `<div class="empty-state" style="padding:22px 0;"><div class="big-emoji">🛍️</div>No active orders right now.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="stepper">${stepperHtml(active.status)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
        Order #${active.id} · ${active.chemist_name ? escapeHtml(active.chemist_name) : "Finding a nearby chemist"}
      </div>
      <a href="/order-tracking.html?order=${active.id}" class="btn btn-primary btn-sm btn-block">Track live →</a>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="padding:22px 0;">Couldn't load your orders.</div>`;
  }
}
