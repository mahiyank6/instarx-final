document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  if (!me.user) {
    document.getElementById("orders-list").innerHTML =
      `<div class="empty-state"><div class="big-emoji">🔒</div>Please <a href="/login.html">login</a> to track your orders.</div>`;
    return;
  }
  if (me.user.role !== "customer") {
    document.getElementById("orders-list").innerHTML =
      `<div class="empty-state">Chemist accounts should use the <a href="/chemist-dashboard.html">dashboard</a> to manage orders.</div>`;
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const highlightId = Number(params.get("order")) || null;

  await load(highlightId);
  setInterval(() => load(highlightId), 4000);
});

async function load(highlightId) {
  const el = document.getElementById("orders-list");
  try {
    const { orders } = await api("/api/orders/mine");
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="big-emoji">📦</div>You haven't placed any orders yet.<br><a href="/category.html" class="btn btn-primary" style="margin-top:14px;">Browse Medicines</a></div>`;
      return;
    }
    el.innerHTML = orders.map((o) => `
      <div class="order-card" style="${highlightId === o.id ? "border-color:var(--primary);" : ""}">
        <div class="top-row">
          <b>Order #${o.id}</b>
          <span class="badge ${o.status}">${STATUS_LABELS[o.status]}</span>
        </div>
        <div class="stepper">${stepperHtml(o.status)}</div>
        <div style="font-size:13px;color:var(--text-muted);">
          ${o.chemist_name ? `Being handled by <b>${escapeHtml(o.chemist_name)}</b>` : "Waiting for a nearby chemist to accept..."}
        </div>
        ${o.items.length ? `<ul>${o.items.map((i) => `<li>${escapeHtml(i.name)} × ${i.qty}</li>`).join("")}</ul>` : `<div style="font-size:13px;color:var(--text-muted);margin:6px 0;">📄 Prescription order</div>`}
        <div style="font-weight:700;">${currency(o.total)}${o.delivery_charge ? ` + ${currency(o.delivery_charge)} delivery` : ""}</div>
        ${o.status !== "delivered" ? `<a href="/order-tracking.html?order=${o.id}" class="btn btn-primary btn-sm" style="margin-top:10px;">Track Live &rarr;</a>` : ""}
      </div>`).join("");
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load your orders.</div>`;
  }
}
