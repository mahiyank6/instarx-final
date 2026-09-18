let pollTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  if (!me.user || me.user.role !== "chemist") {
    document.querySelector(".section .container").innerHTML =
      `<div class="empty-state"><div class="big-emoji">🔒</div>Please <a href="/login.html?role=chemist">login as a chemist</a> to view this dashboard.</div>`;
    document.querySelector(".page-header").style.display = "none";
    return;
  }
  document.getElementById("shop-name").textContent = me.chemist.shop_name;
  document.getElementById("shop-address").textContent = me.chemist.address || "No address on file";

  const toggle = document.getElementById("online-toggle");
  toggle.checked = !!me.chemist.online;
  updateOnlineLabel(toggle.checked);
  toggle.addEventListener("change", async () => {
    try {
      await api("/api/chemist/online", { method: "POST", body: JSON.stringify({ online: toggle.checked }) });
      updateOnlineLabel(toggle.checked);
      toast(toggle.checked ? "You're online — you'll now receive nearby orders" : "You're offline");
      refresh();
    } catch (e) { toast(e.message); toggle.checked = !toggle.checked; }
  });

  refresh();
  pollTimer = setInterval(refresh, 4000);
});

function updateOnlineLabel(online) {
  const el = document.getElementById("online-label");
  el.textContent = online ? "Online" : "Offline";
  el.style.color = online ? "var(--accent-green)" : "var(--text-muted)";
}

async function refresh() {
  loadIncoming();
  // Don't blow away the driver-name/charge/OTP fields while the chemist is
  // actively typing into them — the 4s poll was wiping keystrokes mid-type.
  const myOrdersEl = document.getElementById("my-orders");
  const isTyping = myOrdersEl.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  if (!isTyping) loadMine();
}

async function loadIncoming() {
  const el = document.getElementById("incoming-orders");
  try {
    const { orders } = await api("/api/chemist/orders/incoming");
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="big-emoji">📭</div>No pending order requests right now.</div>`;
      return;
    }
    el.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div class="top-row">
          <b>Order #${o.id}</b>
          <span class="badge pending">${STATUS_LABELS[o.status]}</span>
        </div>
        <div style="font-size:13px;">${escapeHtml(o.customer_name)} · ${o.address && o.address.label ? escapeHtml(truncate(o.address.label, 50)) : "Address unavailable"}</div>
        ${o.items.length ? `<ul>${o.items.map((i) => `<li>${escapeHtml(i.name)} × ${i.qty}</li>`).join("")}</ul>` : `<div style="font-size:13px;color:var(--text-muted);margin:8px 0;">📄 Prescription order — review attached file before pricing.</div>`}
        ${o.prescription_file ? `<a href="/uploads/${encodeURIComponent(o.prescription_file)}" target="_blank" style="font-size:12.5px;color:var(--primary-dark);font-weight:700;">View Prescription →</a>` : ""}
        <div style="font-weight:700;margin-top:6px;">Order value: ${currency(o.total)}</div>
        <div class="order-actions">
          <button class="btn btn-primary btn-sm accept-btn" data-id="${o.id}">Accept Order</button>
        </div>
      </div>`).join("");
    el.querySelectorAll(".accept-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`/api/chemist/orders/${btn.dataset.id}/accept`, { method: "POST" });
          toast("Order accepted — start packing it!");
          refresh();
        } catch (e) { toast(e.message); btn.disabled = false; }
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load incoming orders.</div>`;
  }
}

async function loadMine() {
  const el = document.getElementById("my-orders");
  try {
    const { orders } = await api("/api/chemist/orders/mine");
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="big-emoji">🧾</div>You haven't accepted any orders yet.</div>`;
      return;
    }
    el.innerHTML = orders.map((o) => {
      const next = { accepted: "packed", packed: "out_for_delivery", out_for_delivery: "delivered" }[o.status];
      let actionHtml = "";
      if (next === "out_for_delivery") {
        actionHtml = `
          <div class="field" style="margin:10px 0 6px;">
            <label style="font-size:12px;">Delivery partner's name</label>
            <input type="text" placeholder="e.g. Rohit Kumar" class="driver-input" data-id="${o.id}" style="max-width:220px;">
          </div>
          <div class="field" style="margin:0 0 6px;">
            <label style="font-size:12px;">Personal transport charge (₹)</label>
            <input type="number" min="0" step="1" placeholder="e.g. 30" class="charge-input" data-id="${o.id}" style="max-width:140px;">
          </div>
          <button class="btn btn-secondary btn-sm advance-btn" data-id="${o.id}">Mark Out for Delivery</button>`;
      } else if (next === "delivered") {
        actionHtml = `
          <div class="field" style="margin:10px 0 6px;">
            <label style="font-size:12px;">OTP from customer (ask them for the code on their tracking page)</label>
            <input type="text" maxlength="4" placeholder="4-digit code" class="otp-input" data-id="${o.id}" style="max-width:140px;">
          </div>
          <button class="btn btn-secondary btn-sm advance-btn" data-id="${o.id}">Mark Delivered</button>`;
      } else if (next) {
        actionHtml = `<button class="btn btn-secondary btn-sm advance-btn" data-id="${o.id}">Mark ${STATUS_LABELS[next]}</button>`;
      }
      return `
      <div class="order-card">
        <div class="top-row">
          <b>Order #${o.id}</b>
          <span class="badge ${o.status}">${STATUS_LABELS[o.status]}</span>
        </div>
        <div style="font-size:13px;">${escapeHtml(o.customer_name)}</div>
        ${o.items.length ? `<ul>${o.items.map((i) => `<li>${escapeHtml(i.name)} × ${i.qty}</li>`).join("")}</ul>` : ""}
        <div style="font-weight:700;">${currency(o.total)}${o.delivery_charge ? ` + ${currency(o.delivery_charge)} delivery` : ""}</div>
        <div class="order-actions">${actionHtml}</div>
      </div>`;
    }).join("");
    el.querySelectorAll(".advance-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const chargeInput = el.querySelector(`.charge-input[data-id="${btn.dataset.id}"]`);
        const driverInput = el.querySelector(`.driver-input[data-id="${btn.dataset.id}"]`);
        const otpInput = el.querySelector(`.otp-input[data-id="${btn.dataset.id}"]`);
        const body = {};
        if (chargeInput) body.delivery_charge = Number(chargeInput.value || 0);
        if (driverInput) body.driver_name = driverInput.value.trim();
        if (otpInput) body.otp = otpInput.value.trim();
        try {
          await api(`/api/chemist/orders/${btn.dataset.id}/status`, { method: "POST", body: JSON.stringify(body) });
          toast("Order status updated");
          refresh();
        } catch (e) { toast(e.message); btn.disabled = false; }
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load your orders.</div>`;
  }
}
