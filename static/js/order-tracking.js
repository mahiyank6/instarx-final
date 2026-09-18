let pollTimer = null;
let currentMap = null;

const PAYMENT_LABELS = {
  paid: "Paid via UPI",
  pending_cod: "Pay on Delivery (Cash)",
};

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  const root = document.getElementById("order-tracking-root");
  if (!me.user || me.user.role !== "customer") {
    root.innerHTML = `<div class="empty-state"><div class="big-emoji">🔒</div>Please <a href="/login.html" style="color:var(--primary-dark);font-weight:700;">login</a> to track your order.</div>`;
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const orderId = Number(params.get("order"));
  if (!orderId) {
    root.innerHTML = `<div class="empty-state"><div class="big-emoji">📦</div>No order specified. <a href="/track-order.html" style="color:var(--primary-dark);font-weight:700;">View all your orders</a>.</div>`;
    return;
  }
  await load(orderId);
  pollTimer = setInterval(() => load(orderId), 3000);
});

const ETA_COPY = {
  pending: { big: "Finding a nearby chemist...", sub: "We've notified chemists near your address" },
  accepted: { big: "Your order is being prepared", sub: "The chemist has accepted and is packing it" },
  packed: { big: "Packed & ready to go", sub: "Your order will be dispatched shortly" },
  out_for_delivery: { big: "Arriving in ~8 minutes", sub: "Your delivery partner is on the way" },
  delivered: { big: "Delivered!", sub: "Hope you feel better soon" },
};

async function load(orderId) {
  const root = document.getElementById("order-tracking-root");
  let order;
  try {
    const res = await api(`/api/orders/${orderId}`);
    order = res.order;
  } catch (e) {
    root.innerHTML = `<div class="empty-state">Couldn't load this order.</div>`;
    if (pollTimer) clearInterval(pollTimer);
    return;
  }
  const eta = ETA_COPY[order.status] || ETA_COPY.pending;
  const showRider = order.status === "out_for_delivery";
  const showOtp = order.status !== "pending" && order.status !== "delivered";

  root.innerHTML = `
    <div class="tracking-card">
      <div class="tracking-route">
        <div class="pin-start">🏪</div>
        <div class="dashed-path"></div>
        <div class="pin-end">🏠</div>
        <div class="rider" style="${showRider ? "" : "display:none;"}">🛵</div>
        ${!showRider ? `<div style="font-size:44px;">${order.status === "delivered" ? "🎉" : "⏳"}</div>` : ""}
      </div>
      <div class="tracking-eta">
        <div class="eta-big">${eta.big}</div>
        <div class="eta-sub">${eta.sub}</div>
      </div>
      <div class="tracking-body">
        <div class="stepper">${stepperHtml(order.status)}</div>

        ${order.chemist_name ? `
          <div class="driver-card">
            <div class="driver-avatar">${order.driver_name ? escapeHtml(order.driver_name[0]) : "🏪"}</div>
            <div>
              <div class="name">${order.driver_name ? escapeHtml(order.driver_name) : escapeHtml(order.chemist_name)}</div>
              <div class="role">${order.driver_name ? `Delivery partner &middot; ${escapeHtml(order.chemist_name)}` : "Preparing your order"}</div>
            </div>
            <a href="tel:" class="btn btn-outline btn-sm call-btn" onclick="return false;" title="Demo only — calling is disabled">📞 Call</a>
          </div>` : `<div class="form-note" style="margin:16px 0;">Waiting for a nearby chemist to accept your order...</div>`}

        ${order.chemist_name ? `<div id="driver-map" class="driver-map"></div><div class="map-caption">Simulated live location for demo purposes — not real GPS tracking</div>` : ""}

        ${showOtp ? `
          <div class="otp-panel">
            <div class="otp-label">Share this OTP with your delivery partner only when your order arrives</div>
            <div class="otp-tiles">${(order.otp || "----").split("").map((d) => `<div class="otp-tile">${d}</div>`).join("")}</div>
            <div class="otp-warning">Never share this code before your order is physically in hand.</div>
          </div>` : ""}

        <div class="section-title" style="margin-top:20px;"><h3 style="font-size:15px;margin:0;">Order #${order.id}</h3></div>
        ${order.items.length ? `<ul>${order.items.map((i) => `<li>${escapeHtml(i.name)} &times; ${i.qty}</li>`).join("")}</ul>` : `<div style="font-size:13px;color:var(--text-muted);">📄 Prescription order</div>`}
        <div style="font-weight:700;margin-top:6px;">${currency(order.total)}${order.delivery_charge ? ` + ${currency(order.delivery_charge)} delivery` : ""}</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">
          ${PAYMENT_LABELS[order.payment_status] || "Payment pending"}${order.transaction_id ? ` &middot; Txn ID: ${escapeHtml(order.transaction_id)}` : ""}
        </div>

        <a href="/track-order.html" class="btn btn-ghost btn-sm" style="margin-top:16px;">&larr; All Orders</a>
      </div>
    </div>
  `;

  initDriverMap(order);

  if (order.status === "delivered" && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function initDriverMap(order) {
  const mapEl = document.getElementById("driver-map");
  if (!mapEl) return;
  if (currentMap) { currentMap.remove(); currentMap = null; }

  const custLatLng = order.address && order.address.lat != null ? [order.address.lat, order.address.lng] : null;
  const shopLatLng = order.chemist_location && order.chemist_location.lat != null ? [order.chemist_location.lat, order.chemist_location.lng] : null;

  if (!custLatLng) {
    mapEl.outerHTML = `<div class="form-note">Map unavailable — no delivery coordinates on this order.</div>`;
    return;
  }

  const points = shopLatLng ? [shopLatLng, custLatLng] : [custLatLng];
  currentMap = L.map("driver-map", { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(currentMap);

  const icon = (emoji) => L.divIcon({ html: emoji, className: "map-emoji-icon", iconSize: [28, 28] });
  L.marker(custLatLng, { icon: icon("🏠") }).addTo(currentMap);
  if (shopLatLng) L.marker(shopLatLng, { icon: icon("🏪") }).addTo(currentMap);

  if (shopLatLng && order.status === "out_for_delivery") {
    const dispatchedAt = order.updated_at;
    const simulatedEtaSeconds = 8 * 60; // matches the "Arriving in ~8 minutes" copy
    const elapsed = Date.now() / 1000 - dispatchedAt;
    const frac = Math.max(0, Math.min(1, elapsed / simulatedEtaSeconds));
    const riderLat = shopLatLng[0] + (custLatLng[0] - shopLatLng[0]) * frac;
    const riderLng = shopLatLng[1] + (custLatLng[1] - shopLatLng[1]) * frac;
    L.marker([riderLat, riderLng], { icon: icon("🛵") }).addTo(currentMap);
  }

  if (points.length > 1) currentMap.fitBounds(points, { padding: [26, 26] });
  else currentMap.setView(points[0], 15);
}
