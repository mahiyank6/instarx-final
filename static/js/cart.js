let cartData = null;

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  if (!me.user) {
    document.querySelector(".section .container").innerHTML =
      `<div class="empty-state"><div class="big-emoji">🔒</div>Please <a href="/login.html" style="color:var(--primary-dark);font-weight:700;">login</a> to view your cart.</div>`;
    return;
  }
  if (me.user.role !== "customer") {
    document.querySelector(".section .container").innerHTML =
      `<div class="empty-state"><div class="big-emoji">🏪</div>Chemist accounts don't use the shopping cart.</div>`;
    return;
  }
  await loadCart();
  renderAddressBlock();
  document.getElementById("place-order-btn").addEventListener("click", placeOrder);
});

async function loadCart() {
  const panel = document.getElementById("cart-panel");
  try {
    cartData = await api("/api/cart");
  } catch (e) {
    panel.innerHTML = `<div class="empty-state">Couldn't load your cart.</div>`;
    return;
  }
  const pendingRx = localStorage.getItem("instarx_pending_prescription");
  if (!cartData.items.length && !pendingRx) {
    panel.innerHTML = `<div class="empty-state"><div class="big-emoji">🛒</div>Your cart is empty.<br><a href="/category.html" class="btn btn-primary" style="margin-top:14px;">Browse Medicines</a></div>`;
    document.getElementById("place-order-btn").disabled = true;
  } else {
    let html = cartData.items.map((line) => `
      <div class="cart-line" data-id="${line.medicine.id}">
        ${productThumbHtml(line.medicine)}
        <div class="info">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(line.medicine.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);">${currency(line.medicine.price)} each</div>
        </div>
        <div class="qty-control">
          <button data-action="dec">−</button>
          <span>${line.qty}</span>
          <button data-action="inc">+</button>
        </div>
        <div style="font-weight:700;width:70px;text-align:right;">${currency(line.subtotal)}</div>
        <button class="btn btn-ghost btn-sm" data-action="remove">✕</button>
      </div>`).join("");
    if (pendingRx) {
      html += `<div class="cart-line"><div class="thumb">📄</div><div class="info"><div style="font-weight:700;font-size:14px;">Uploaded prescription attached</div><div style="font-size:12px;color:var(--text-muted);">Chemist will confirm items & price</div></div><button class="btn btn-ghost btn-sm" id="remove-rx">✕</button></div>`;
    }
    panel.innerHTML = html;
    wireCartControls(panel);
    const removeRx = document.getElementById("remove-rx");
    if (removeRx) removeRx.addEventListener("click", () => {
      localStorage.removeItem("instarx_pending_prescription");
      loadCart(); renderSummary();
    });
  }
  renderSummary();
}

function wireCartControls(panel) {
  panel.querySelectorAll(".cart-line[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="inc"]').addEventListener("click", () => changeQty(id, 1));
    row.querySelector('[data-action="dec"]').addEventListener("click", () => changeQty(id, -1));
    row.querySelector('[data-action="remove"]').addEventListener("click", () => removeLine(id));
  });
}

async function changeQty(id, delta) {
  await api("/api/cart", { method: "POST", body: JSON.stringify({ medicine_id: id, qty: delta }) });
  await loadCart();
  renderNavActions();
}

async function removeLine(id) {
  await api(`/api/cart/${id}`, { method: "DELETE" });
  await loadCart();
  renderNavActions();
}

function renderSummary() {
  const el = document.getElementById("summary-block");
  const total = cartData ? cartData.total : 0;
  const deliveryFee = total >= 199 || total === 0 ? 0 : 29;
  const deliveryNote = deliveryFee === 0 ? "FREE" : currency(deliveryFee);
  el.innerHTML = `
    <div class="summary-row"><span>Item Total</span><span>${currency(total)}</span></div>
    <div class="summary-row"><span>Delivery</span><span>${deliveryNote}</span></div>
    <div class="summary-row total"><span>To Pay</span><span>${currency(total + deliveryFee)}</span></div>
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px;">Chemist may add a personal transport charge when your order goes out for delivery.</div>
  `;
}

function renderAddressBlock() {
  const el = document.getElementById("address-block");
  const addr = getSavedAddress();
  el.innerHTML = `
    ${addr ? `<div style="font-size:13.5px;margin-bottom:10px;">📍 ${escapeHtml(addr.label)}</div>` : `<div class="form-note">No address set yet.</div>`}
    <button class="btn btn-outline btn-sm btn-block" id="redetect-btn">📍 Use My Current Location</button>
    <div style="font-size:12px;color:var(--text-muted);text-align:center;margin:10px 0 6px;">or enter it manually</div>
    <div style="display:flex;gap:6px;">
      <input type="text" id="manual-address-input" placeholder="Street, area, city" style="flex:1;padding:9px 10px;border-radius:8px;border:1.5px solid var(--border);font-size:13px;">
      <button class="btn btn-primary btn-sm" id="manual-address-btn">Set</button>
    </div>
  `;
  document.getElementById("redetect-btn").addEventListener("click", async () => {
    try {
      const addr = await detectLocation();
      saveAddress(addr);
      renderAddressBlock();
      toast("Address updated");
    } catch (e) { toast("Location access denied — enter your address manually below"); }
  });
  document.getElementById("manual-address-btn").addEventListener("click", async () => {
    const input = document.getElementById("manual-address-input");
    const query = input.value.trim();
    if (!query) { toast("Type an address first"); return; }
    try {
      const addr = await geocodeAddress(query);
      saveAddress(addr);
      renderAddressBlock();
      toast("Address set");
    } catch (e) { toast(e.message); }
  });
}

async function placeOrder() {
  const addr = getSavedAddress();
  if (!addr) {
    toast("Please set your delivery location first");
    return;
  }
  window.location.href = "/payment.html";
}
