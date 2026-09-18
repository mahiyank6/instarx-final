document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "";
  const q = params.get("q") || "";

  renderHeader(activeCat);
  await loadFilters(activeCat);
  await loadProducts(activeCat, q);

  document.getElementById("page-title").textContent = q
    ? `Search results for "${q}"`
    : (activeCat || "All Medicines");
});

async function loadFilters(activeCat) {
  const el = document.getElementById("category-filters");
  try {
    const { categories } = await api("/api/categories");
    el.innerHTML = `<a class="chip ${!activeCat ? "active" : ""}" href="/category.html">All</a>` +
      categories.map((c) => `<a class="chip ${activeCat === c.name ? "active" : ""}" href="/category.html?cat=${encodeURIComponent(c.name)}">${c.icon} ${escapeHtml(c.name)}</a>`).join("");
  } catch (e) { el.innerHTML = ""; }
}

async function loadProducts(cat, q) {
  const el = document.getElementById("product-grid");
  const qs = new URLSearchParams();
  if (cat) qs.set("category", cat);
  if (q) qs.set("q", q);
  try {
    const { medicines } = await api(`/api/medicines?${qs.toString()}`);
    if (!medicines.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big-emoji">🔍</div>No medicines found.</div>`;
      return;
    }
    el.innerHTML = medicines.map(productCardHtml).join("");
    wireAddToCart(el);
    enable3DTilt(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Couldn't load medicines.</div>`;
  }
}
