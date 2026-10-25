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
  if (!cartData.items.length) {
    panel.innerHTML = `<div class="empty-state"><div class="big-emoji">🛒</div>Your cart is empty.<br><a href="/category.html" class="btn btn-primary" style="margin-top:14px;">Browse Medicines</a></div>`;
    document.getElementById("place-order-btn").disabled = true;
  } else {
    const html = cartData.items.map((line) => `
      <div class="cart-line" data-id="${line.medicine.id}">
        ${productThumbHtml(line.medicine)}
        <div class="info">
          <div class="line-name">${escapeHtml(line.medicine.name)}</div>
          <div class="line-price">${currency(line.medicine.price)} each</div>
        </div>
        <div class="qty-control">
          <button data-action="dec" aria-label="Decrease quantity">−</button>
          <span>${line.qty}</span>
          <button data-action="inc" aria-label="Increase quantity">+</button>
        </div>
        <div class="line-total">${currency(line.subtotal)}</div>
        <button class="line-remove" data-action="remove" aria-label="Remove ${escapeHtml(line.medicine.name)}">✕</button>
      </div>`).join("");
    panel.innerHTML = html;
    wireCartControls(panel);
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
    <div class="summary-note">Chemist may add a personal transport charge when your order goes out for delivery.</div>
  `;
}

function renderAddressBlock() {
  const el = document.getElementById("address-block");
  const addr = getSavedAddress();
  el.innerHTML = `
    ${addr ? `<div class="addr-current"><span class="addr-current-pin">📍</span><span>${escapeHtml(addr.label)}</span></div>` : `<div class="form-note">No address set yet.</div>`}
    <button class="btn btn-outline btn-block" id="redetect-btn">📍 Use My Current Location</button>
    <div class="addr-or">or search for it</div>
    <div class="addr-search">
      <div class="addr-input-row">
        <input type="text" id="manual-address-input" placeholder="Building, area, city" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search">
        <button class="btn btn-primary" id="manual-address-btn">Set</button>
      </div>
      <div class="addr-suggest" id="addr-suggest"></div>
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
  const search = attachAddressSearch({
    input: document.getElementById("manual-address-input"),
    list: document.getElementById("addr-suggest"),
    onPick: (addr) => { saveAddress(addr); renderAddressBlock(); renderHeader(); toast("Address set"); },
  });
  document.getElementById("manual-address-btn").addEventListener("click", search.submit);
}

async function placeOrder() {
  const addr = getSavedAddress();
  if (!addr) {
    toast("Please set your delivery location first");
    return;
  }
  window.location.href = "/payment.html";
}
