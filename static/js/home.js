document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  loadCategories();
  loadTopSelling();
  loadLiveTracking();
  wireLocationPill();
});

async function wireLocationPill() {
  const pill = document.getElementById("location-pill");
  const btn = document.getElementById("change-location-btn");
  const span = pill.querySelector("span");

  function paint() {
    const addr = getSavedAddress();
    span.textContent = addr ? `📍 ${truncate(addr.label, 60)}` : "📍 Location not detected";
  }
  paint();

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    span.textContent = "📍 Detecting your location...";
    try {
      const addr = await detectLocation();
      saveAddress(addr);
      paint();
      renderHeader();
      toast("Location updated");
    } catch (e) {
      toast(e.message.includes("denied") ? "Location permission denied" : "Couldn't detect location");
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
      <a class="category-card tilt-card" href="/category.html?cat=${encodeURIComponent(c.name)}">
        <div class="emoji">${c.icon}</div>
        <div class="label">${escapeHtml(c.name)}</div>
      </a>`).join("");
    enable3DTilt(el);
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
    enable3DTilt(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load medicines.</div>`;
  }
}

async function loadLiveTracking() {
  const el = document.getElementById("live-tracking-panel");
  let me;
  try { me = await api("/api/me"); } catch (e) { me = { user: null }; }
  if (!me.user || me.user.role !== "customer") {
    el.innerHTML = `<div class="empty-state" style="padding:20px 0;"><div class="big-emoji">📦</div>Login as a customer to see your live order status here.</div>`;
    return;
  }
  try {
    const { orders } = await api("/api/orders/mine");
    const active = orders.find((o) => o.status !== "delivered");
    if (!active) {
      el.innerHTML = `<div class="empty-state" style="padding:20px 0;"><div class="big-emoji">🛍️</div>No active orders right now.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="stepper">${stepperHtml(active.status)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Order #${active.id} · ${active.chemist_name ? escapeHtml(active.chemist_name) : "Waiting for a nearby chemist to accept"}</div>
      <a href="/order-tracking.html?order=${active.id}" class="btn btn-primary btn-sm btn-block">Track Live &rarr;</a>
    `;
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="padding:20px 0;">Couldn't load your orders.</div>`;
  }
}
