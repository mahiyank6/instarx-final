let method = "upi"; // upi | cod
let cartInfo = null;
// Set when paying for a prescription the chemist has already priced (?rx=ID).
let rxRequest = null;
let rxAddress = null;

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  const root = document.getElementById("payment-root");
  if (!me.user) {
    root.innerHTML = `<div class="empty-state"><div class="big-emoji">🔒</div>Please <a href="/login.html" style="color:var(--primary-dark);font-weight:700;">login</a> to continue to payment.</div>`;
    return;
  }
  if (me.user.role !== "customer") {
    root.innerHTML = `<div class="empty-state">Chemist accounts don't place orders.</div>`;
    return;
  }

  const rxId = new URLSearchParams(location.search).get("rx");
  if (rxId) {
    try {
      ({ request: rxRequest } = await api(`/api/rx-requests/${encodeURIComponent(rxId)}`));
    } catch (e) {
      root.innerHTML = `<div class="empty-state">We couldn't find that prescription. <a href="/upload-prescription.html" style="color:var(--primary);font-weight:700;">Back to chat</a></div>`;
      return;
    }
    if (rxRequest.status !== "awaiting_customer") {
      root.innerHTML = `<div class="empty-state">This prescription offer is no longer open. <a href="/upload-prescription.html" style="color:var(--primary);font-weight:700;">Back to chat</a></div>`;
      return;
    }
    cartInfo = { items: rxRequest.items.filter((i) => i.in_stock), total: rxRequest.available_total };
    rxAddress = rxRequest.address;
  } else {
    try {
      cartInfo = await api("/api/cart");
    } catch (e) {
      cartInfo = { items: [], total: 0 };
    }
    if (!cartInfo.items.length) {
      root.innerHTML = `<div class="empty-state"><div class="big-emoji">🛒</div>Your cart is empty.<br><a href="/category.html" class="btn btn-primary" style="margin-top:14px;">Browse Medicines</a></div>`;
      return;
    }
  }
  const addr = getSavedAddress() || rxAddress;
  if (!addr) {
    root.innerHTML = `<div class="empty-state">No delivery address set. <a href="/cart.html" style="color:var(--primary-dark);font-weight:700;">Go back to Cart</a> to set one.</div>`;
    return;
  }

  renderPaymentUI();
});

function renderPaymentUI() {
  const root = document.getElementById("payment-root");
  const total = cartInfo.total || 0;
  const deliveryFee = total >= 199 || total === 0 ? 0 : 29;
  const payable = total + deliveryFee;

  const rxLines = rxRequest
    ? `<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;">From your prescription, checked by ${escapeHtml(rxRequest.shop_name || "your chemist")}</div>`
      + cartInfo.items.map((i) => `<div class="summary-row"><span>${escapeHtml(i.name)} <span style="color:var(--text-muted);">x${i.qty}</span></span><span>${currency(i.price * i.qty)}</span></div>`).join("")
    : "";
  root.innerHTML = `
    <div class="panel" style="margin-bottom:18px;">
      <div class="panel-title"><h3>Order Summary</h3></div>
      ${rxLines}
      <div class="summary-row"><span>Item Total</span><span>${currency(total)}</span></div>
      <div class="summary-row"><span>Delivery (estimated)</span><span>${deliveryFee === 0 ? "FREE" : currency(deliveryFee)}</span></div>
      <div class="summary-row total"><span>Amount Payable</span><span>${currency(payable)}</span></div>
    </div>

    <div class="panel" id="method-panel">
      <div class="panel-title"><h3>Choose Payment Method</h3></div>
      <div class="role-toggle" id="method-toggle">
        <button type="button" data-method="upi" class="active">📱 UPI</button>
        <button type="button" data-method="cod">💵 Cash on Delivery</button>
      </div>

      <div id="upi-panel">
        <div style="display:flex;gap:14px;justify-content:center;margin-bottom:16px;font-size:28px;">
          <span title="Google Pay">🟢</span><span title="PhonePe">🟣</span><span title="Paytm">🔵</span><span title="BHIM">🇮🇳</span>
        </div>
        <div class="field">
          <label>UPI ID</label>
          <input type="text" id="upi-id-input" placeholder="yourname@bank">
        </div>
        <div id="pay-error" class="form-error" style="display:none;"></div>
        <button class="btn btn-primary btn-block" id="pay-btn">Pay ${currency(payable)}</button>
      </div>

      <div id="cod-panel" style="display:none;">
        <p style="font-size:13.5px;color:var(--text-muted);">Pay in cash to the delivery partner when your order arrives. The chemist may add a personal transport charge, payable along with your total.</p>
        <button class="btn btn-primary btn-block" id="cod-btn">Confirm Order (Pay on Delivery)</button>
      </div>
    </div>

    ${rxRequest ? `<div style="text-align:center;margin-top:16px;">
      <button class="btn btn-ghost" id="rx-cancel-pay" style="color:var(--danger);">Don't want these? Cancel this prescription</button></div>` : ""}

    <div id="processing-overlay" style="display:none;text-align:center;padding:40px 0;">
      <div class="spinner"></div>
      <div id="processing-text" style="margin-top:14px;font-weight:700;">Processing payment...</div>
    </div>
  `;

  document.querySelectorAll("#method-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      method = btn.dataset.method;
      document.querySelectorAll("#method-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("upi-panel").style.display = method === "upi" ? "block" : "none";
      document.getElementById("cod-panel").style.display = method === "cod" ? "block" : "none";
    });
  });

  document.getElementById("pay-btn").addEventListener("click", onPayUpi);
  document.getElementById("cod-btn").addEventListener("click", onConfirmCod);
  const cancelRx = document.getElementById("rx-cancel-pay");
  if (cancelRx) cancelRx.addEventListener("click", async () => {
    cancelRx.disabled = true;
    try {
      await api(`/api/rx-requests/${rxRequest.id}/cancel`, { method: "POST", body: "{}" });
      window.location.href = "/upload-prescription.html";
    } catch (e) { toast(e.message); cancelRx.disabled = false; }
  });
}

function showProcessing(text) {
  document.getElementById("method-panel").style.display = "none";
  const overlay = document.getElementById("processing-overlay");
  overlay.style.display = "block";
  document.getElementById("processing-text").textContent = text;
}

async function onPayUpi() {
  const input = document.getElementById("upi-id-input");
  const upiId = input.value.trim();
  const errorEl = document.getElementById("pay-error");
  errorEl.style.display = "none";

  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) {
    errorEl.textContent = "Enter a valid UPI ID, e.g. yourname@okhdfcbank";
    errorEl.style.display = "block";
    return;
  }

  showProcessing("Processing payment...");
  await new Promise((r) => setTimeout(r, 1600));
  document.getElementById("processing-text").innerHTML = "✅ Payment Successful (Simulated)";
  await new Promise((r) => setTimeout(r, 900));

  await submitOrder({ payment_method: "upi", upi_id: upiId });
}

async function onConfirmCod() {
  showProcessing("Confirming your order...");
  await new Promise((r) => setTimeout(r, 700));
  await submitOrder({ payment_method: "cod" });
}

async function submitOrder(paymentPayload) {
  const addr = getSavedAddress() || rxAddress;
  const rxPart = rxRequest ? { rx_request_id: rxRequest.id } : {};
  try {
    const { order } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ address: addr, ...rxPart, ...paymentPayload }),
    });
    window.location.href = `/order-tracking.html?order=${order.id}`;
  } catch (e) {
    toast(e.message);
    renderPaymentUI();
  }
}
