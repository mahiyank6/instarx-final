/* Prescription chat (customer side).
   The customer sends a photo or PDF; the nearest chemist opens it, checks stock
   and replies; the customer buys what is available or says no. The thread is
   rebuilt from the server's request records, polled every few seconds. */

const RX_POLL_MS = 4000;
const RX_MAX_BYTES = 10 * 1024 * 1024;
const RX_TYPES = /^(image\/|application\/pdf$)/;
const PDF_ICON = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;

let rxRequests = [];            // every prescription this customer has ever sent
// The chat starts fresh on every visit: prescriptions already finished when the
// page opened live in History instead. Ones still waiting on the customer stay
// in the chat, because hiding an offer they haven't answered would strand it.
let rxHidden = null;
const RX_OPEN_NOW = ["new", "reviewing", "awaiting_customer"];
let rxPending = [];             // uploads in flight, shown before the server has them
let rxPick = null;              // file chosen in the send sheet
let rxTempId = 0;
let rxSignature = "";
let rxLocLabel = null;
let rxFirstPaint = true;
const rxShownKeys = new Set();  // thread items already on screen; only new ones animate

const $rx = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  renderHeader();
  const me = await api("/api/me").catch(() => ({ user: null }));
  if (!me.user) {
    return lockChat(`<div class="ic">🔒</div>Please <a href="/login.html" style="color:var(--primary);font-weight:700;">log in</a> to send a prescription to a nearby chemist.`);
  }
  if (me.user.role !== "customer") {
    return lockChat(`<div class="ic">🏪</div>Chemists review prescriptions on the <a href="/chemist-dashboard.html#documents" style="color:var(--primary);font-weight:700;">dashboard</a>.`);
  }

  $rx("rx-send").addEventListener("click", sendSheet);
  $rx("rx-file").addEventListener("change", onFilePicked);
  $rx("rx-sheet").addEventListener("click", (e) => { if (e.target.id === "rx-sheet") closeSheet(); });
  $rx("rx-thread").addEventListener("click", onThreadClick);
  $rx("rx-history").addEventListener("click", openHistory);

  await loadRx(true);
  setInterval(() => { if (!document.hidden) loadRx(false); }, RX_POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadRx(false); });
});

function lockChat(html) {
  $rx("rx-thread").innerHTML = `<div class="rx-empty">${html}</div>`;
  $rx("rx-composer").style.display = "none";
}

/* ---------- location line ---------- */

function renderLoc() {
  const a = getSavedAddress();
  const label = a ? a.label : "";
  if (label === rxLocLabel) return;
  rxLocLabel = label;
  $rx("rx-loc").innerHTML = a
    ? `<span>📍 Goes to chemists near ${escapeHtml(truncate(a.label, 60))}</span><button type="button" id="rx-loc-btn">Update</button>`
    : `<span>📍 Location not set, so every online chemist will see it</span><button type="button" id="rx-loc-btn">Use my location</button>`;
  $rx("rx-loc-btn").addEventListener("click", async (e) => {
    e.currentTarget.textContent = "Locating…";
    try {
      saveAddress(await detectLocation());
      renderHeader();
      toast("Location updated");
    } catch (err) {
      toast("Couldn't get your location. You can type it in your cart instead.");
    }
    rxLocLabel = null;
    renderLoc();
  });
}

/* ---------- data ---------- */

async function loadRx(scrollToEnd) {
  try {
    const { requests } = await api("/api/rx-requests/mine");
    rxRequests = requests;
    if (rxHidden === null) rxHidden = new Set(requests.filter((r) => !RX_OPEN_NOW.includes(r.status)).map((r) => r.id));
  } catch (e) {
    if (scrollToEnd) toast("Couldn't load your prescriptions. Check your connection.");
    return;
  }
  renderRx(scrollToEnd);
}

/* ---------- thread ---------- */

function renderRx(forceBottom) {
  renderLoc();
  const sig = JSON.stringify([rxRequests, rxPending.map((p) => [p.id, p.state])]);
  if (sig === rxSignature && !forceBottom) return;   // nothing changed: leave the DOM (and scroll) alone
  rxSignature = sig;

  const el = $rx("rx-thread");
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  const items = buildThread();
  if (!items.length) {
    el.innerHTML = `<div class="rx-empty"><div class="ic">📄</div>Send a clear photo or PDF of your prescription.<br>The nearest chemist checks what's in stock and replies right here.</div>`;
  } else {
    el.innerHTML = items.map((i) => i.html).join("");
    [...el.children].forEach((node, idx) => {
      const key = items[idx].key;
      if (!rxFirstPaint && !rxShownKeys.has(key)) node.classList.add("rx-fresh");
      rxShownKeys.add(key);
    });
  }
  rxFirstPaint = false;
  if (forceBottom || nearBottom) el.scrollTop = el.scrollHeight;
}

function buildThread() {
  const out = [];
  const push = (key, html) => out.push({ key, html });
  const sys = (t) => `<div class="rxm sys">${t}</div>`;
  const visible = rxRequests.filter((r) => !(rxHidden && rxHidden.has(r.id)));
  if (!visible.length && !rxPending.length) return out;

  push("intro", sys("Send a photo or PDF of your prescription. The nearest chemist checks stock and replies here."));
  for (const r of visible) {
    const shop = escapeHtml(r.shop_name || "Your chemist");
    const ticks = r.seen_at ? `<span class="rx-ticks seen">✓✓ Seen</span>` : `<span class="rx-ticks">✓✓ Delivered</span>`;
    push(`d${r.id}`, docBubble(r.file_url, r.file_name, r.is_pdf, ticks));
    // Until the chemist replies, the customer can still withdraw the prescription.
    const cancel = `<button type="button" class="rx-cancel" data-rx-withdraw="${r.id}">✕ Cancel request</button>`;
    if (r.status === "new") push(`w${r.id}`, `<div class="rx-note">Waiting for the nearest chemist to open it</div>`);
    if (r.status === "reviewing") push(`t${r.id}`, `<div class="rx-typing"><i></i><i></i><i></i>${shop} is checking stock</div>`);
    if (r.status === "new" || r.status === "reviewing") push(`cx${r.id}`, cancel);
    if (r.status === "closed_cancelled") {
      push(`n${r.id}`, `<div class="rxm me">I don't need these any more.</div>`);
      push(`x${r.id}`, sys("Request cancelled. You can send another prescription any time."));
    }
    if (r.reply_text) {
      push(`c${r.id}`, `<div class="rxm chem${r.reply_kind === "none" ? " sorry" : ""}"><div class="from">${shop}</div>${escapeHtml(r.reply_text)}</div>`);
      if (r.reply_kind === "none") push(`s${r.id}`, sys("Request closed. You can send another prescription any time."));
      else push(`o${r.id}`, offerHtml(r));
    }
    if (r.status === "closed_declined") {
      push(`n${r.id}`, `<div class="rxm me">No, thanks.</div>`);
      push(`x${r.id}`, sys("Request closed. You can send another prescription any time."));
    }
    if (r.status === "accepted" && r.order_id) {
      push(`y${r.id}`, `<div class="rxm me">${r.reply_kind === "partial" ? "Yes, I'll buy the available stock." : "Placing the order."}</div>`);
      push(`a${r.id}`, `<div class="rx-done"><div class="ic">✓</div>
        <div><div class="t">Order #${r.order_id} confirmed</div><div class="s">${shop} is preparing it</div></div>
        <a class="btn btn-outline btn-sm" href="/order-tracking.html?order=${r.order_id}">Track order</a></div>`);
    }
  }
  for (const p of rxPending) {
    const ticks = p.state === "failed" ? `<span class="rx-ticks err">Not sent</span>` : `<span class="rx-ticks">✓ Sending…</span>`;
    push(`p${p.id}`, docBubble(p.preview, p.name, p.isPdf, ticks));
    if (p.state === "failed") push(`pe${p.id}`, sys(`${escapeHtml(p.error)} Tap Send prescription to try again.`));
  }
  return out;
}

function docBubble(src, name, isPdf, ticks) {
  const thumb = isPdf
    ? `<div class="rx-pdf">${PDF_ICON}PDF</div>`
    : `<img src="${src}" alt="Prescription" onerror="this.parentNode.innerHTML='<div class=&quot;rx-pdf&quot; style=&quot;color:var(--primary)&quot;>Photo</div>'">`;
  return `<a class="rxm me doc" href="${src}" target="_blank" rel="noopener" title="Open full size">
    <div class="rx-docthumb">${thumb}</div>
    <div class="rx-doccap"><span class="fn">${escapeHtml(name)}</span>${ticks}</div>
  </a>`;
}

function offerHtml(r) {
  const avail = r.items.filter((i) => i.in_stock);
  const out = r.items.filter((i) => !i.in_stock);
  const sub = r.available_total;
  const fee = sub >= 199 || sub === 0 ? 0 : 29;      // same estimate as the cart
  const rows = avail.map((i) => `<div class="rx-orow"><span class="nm2">${escapeHtml(i.name)} <span class="q">x${i.qty}</span></span><span>${currency(i.price * i.qty)}</span></div>`).join("")
    + out.map((i) => `<div class="rx-orow out"><span class="nm2">${escapeHtml(i.name)}</span><span class="rx-chip no">Out of stock</span></div>`).join("");
  let act;
  if (r.status === "awaiting_customer") {
    // Always a way out: "No" for a partial offer, "Not now" when everything is available.
    act = `<div class="rx-oact"><button class="btn btn-ghost" style="border:1px solid var(--border);" data-rx-no="${r.id}">${r.reply_kind === "partial" ? "No" : "Not now"}</button>
      <button class="btn btn-primary" data-rx-buy="${r.id}">${r.reply_kind === "partial" ? "Yes, buy available" : "Proceed to Payment"}</button></div>`;
  } else if (r.status === "accepted") {
    act = `<div class="rx-answered">You bought ${r.reply_kind === "partial" ? "the available stock" : "these medicines"}.</div>`;
  } else {
    act = `<div class="rx-answered">You declined this offer.</div>`;
  }
  return `<div class="rx-offer">
    <div class="rx-offer-h">${r.reply_kind === "partial" ? "Available now" : "Your order"}</div>
    ${rows}
    <div class="rx-otot">
      <div class="rx-orow"><span>Item total</span><span>${currency(sub)}</span></div>
      <div class="rx-orow"><span>Delivery (estimated)</span><span>${fee ? currency(fee) : "FREE"}</span></div>
      <div class="rx-orow grand"><span>To pay</span><span>${currency(sub + fee)}</span></div>
    </div>
    ${act}
  </div>`;
}

async function onThreadClick(e) {
  const buy = e.target.closest("[data-rx-buy]");
  if (buy) { window.location.href = `/payment.html?rx=${buy.dataset.rxBuy}`; return; }
  const no = e.target.closest("[data-rx-no]");
  if (no) {
    no.disabled = true;
    try {
      await api(`/api/rx-requests/${no.dataset.rxNo}/cancel`, { method: "POST", body: "{}" });
      await loadRx(true);
    } catch (err) { toast(err.message); no.disabled = false; loadRx(false); }
    return;
  }
  const withdraw = e.target.closest("[data-rx-withdraw]");
  if (withdraw) confirmWithdraw(Number(withdraw.dataset.rxWithdraw));
}

/* ---------- history ---------- */

function historyChip(r) {
  return {
    new: `<span class="rx-chip new">Waiting for chemist</span>`,
    reviewing: `<span class="rx-chip new">Chemist is checking</span>`,
    awaiting_customer: `<span class="rx-chip wait">Waiting for your answer</span>`,
    accepted: `<span class="rx-chip ok">Order #${r.order_id}</span>`,
    closed_unavailable: `<span class="rx-chip no">Not available</span>`,
    closed_declined: `<span class="rx-chip muted">You said no</span>`,
    closed_cancelled: `<span class="rx-chip muted">Cancelled</span>`,
  }[r.status] || "";
}

function historyTime(ts) {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function openHistory() {
  const list = [...rxRequests].sort((a, b) => b.created_at - a.created_at);
  const body = list.length
    ? list.map((r) => `
      <div class="rx-hist-item">
        <a class="rx-hist-doc" href="${r.file_url}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(r.file_name)}">${r.is_pdf ? "PDF" : `<img src="${r.file_url}" alt="" loading="lazy">`}</a>
        <div class="rx-hist-meta">
          <div class="fn">${escapeHtml(r.file_name)}</div>
          <div class="tm">${historyTime(r.created_at)}${r.shop_name ? ` · ${escapeHtml(r.shop_name)}` : ""}</div>
          ${historyChip(r)}${r.status === "accepted" && r.order_id ? `<a class="go" href="/order-tracking.html?order=${r.order_id}">Track order</a>` : ""}
          <a class="go" href="${r.file_url}" target="_blank" rel="noopener">View document</a>
        </div>
      </div>`).join("")
    : `<div class="rx-empty" style="padding:var(--space-5) 0;">No prescriptions yet.<br>Everything you send will be listed here.</div>`;
  openSheet(`<div class="rx-sheet-head"><h3>Prescription history</h3>
      <button type="button" class="rxv-close" id="rx-hist-x" aria-label="Close history">✕</button></div>
    <p>Every prescription you have sent, newest first. Tap a document to open it.</p>
    ${body}
    <div class="stack" style="margin-top:var(--space-4);"><button class="btn btn-ghost btn-block" id="rx-hist-close" style="border:1px solid var(--border);">Close</button></div>`);
  $rx("rx-hist-close").onclick = closeSheet;
  $rx("rx-hist-x").onclick = closeSheet;
  $rx("rx-chat").scrollIntoView({ block: "end" });     // keep the panel and its Close button on screen
}

function confirmWithdraw(id) {
  openSheet(`<h3>Cancel this prescription?</h3>
    <p>The chemist will be told you no longer need it. You can send another prescription any time.</p>
    <div class="stack">
      <button class="btn btn-primary btn-block" id="rx-yes-cancel" style="background:var(--danger);box-shadow:none;">Yes, cancel it</button>
      <button class="btn btn-ghost btn-block" id="rx-keep" style="border:1px solid var(--border);">Keep it</button>
    </div>`);
  $rx("rx-keep").onclick = closeSheet;
  $rx("rx-yes-cancel").onclick = async () => {
    $rx("rx-yes-cancel").disabled = true;
    try {
      await api(`/api/rx-requests/${id}/cancel`, { method: "POST", body: "{}" });
      closeSheet();
      toast("Prescription cancelled");
    } catch (err) {
      closeSheet();
      toast(err.message);     // e.g. the chemist replied a moment ago: the offer will show up now
    }
    await loadRx(true);
  };
}

/* ---------- send sheet ---------- */

function openSheet(html) {
  $rx("rx-sheet").innerHTML = `<div class="rx-sheet"><div class="grab"></div>${html}</div>`;
  $rx("rx-sheet").classList.add("show");
}

function closeSheet() {
  $rx("rx-sheet").classList.remove("show");
  $rx("rx-sheet").innerHTML = "";
}

function sendSheet() {
  if (!rxPick) {
    openSheet(`<h3>Send your prescription</h3>
      <p>A clear photo of the whole page works best. Photos and PDFs up to 10 MB are fine.</p>
      <div class="stack">
        <button class="btn btn-primary btn-block" id="rx-choose">Take a photo or choose a file</button>
        <button class="btn btn-ghost btn-block" id="rx-cancel" style="border:1px solid var(--border);">Cancel</button>
      </div>`);
    $rx("rx-choose").onclick = () => $rx("rx-file").click();
    $rx("rx-cancel").onclick = closeSheet;
    return;
  }
  openSheet(`<h3>Send this prescription?</h3>
    <p>The nearest chemist will check stock and reply in this chat.</p>
    <div class="rx-pick">${rxPick.isPdf ? `<div class="rx-pdf">${PDF_ICON}${escapeHtml(rxPick.name)}</div>` : `<img src="${rxPick.preview}" alt="">`}</div>
    <div class="stack">
      <button class="btn btn-primary btn-block" id="rx-confirm">Send to chemist</button>
      <button class="btn btn-ghost btn-block" id="rx-other" style="border:1px solid var(--border);">Choose a different file</button>
    </div>`);
  $rx("rx-confirm").onclick = () => { const p = rxPick; rxPick = null; closeSheet(); upload(p); };
  $rx("rx-other").onclick = () => { rxPick = null; $rx("rx-file").click(); };
}

function onFilePicked(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  if (!isPdf && !RX_TYPES.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) {
    toast("Please send a photo or a PDF");
    return;
  }
  if (f.size > RX_MAX_BYTES) {
    toast("That file is too big. Please send one under 10 MB.");
    return;
  }
  rxPick = { file: f, name: f.name, isPdf, preview: URL.createObjectURL(f) };
  sendSheet();
}

async function upload(p) {
  const pend = { id: ++rxTempId, name: p.name, preview: p.preview, isPdf: p.isPdf, state: "sending" };
  rxPending.push(pend);
  renderRx(true);

  const fd = new FormData();
  fd.append("file", p.file);
  const a = getSavedAddress();
  if (a) { fd.append("lat", a.lat); fd.append("lng", a.lng); fd.append("label", a.label || ""); }
  try {
    const res = await fetch("/api/rx-requests", { method: "POST", body: fd, credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Couldn't send it. Please try again.");
    rxPending = rxPending.filter((x) => x !== pend);
    rxShownKeys.add("d" + body.request.id);        // it's already on screen as the pending bubble
    rxRequests.push(body.request);
    renderRx(true);
    URL.revokeObjectURL(p.preview);
  } catch (err) {
    pend.state = "failed";
    pend.error = err.message;
    renderRx(true);
    toast(err.message);
  }
}
