/* Chemist side of the prescription chat: the prescriptions sent to this shop,
   and a viewer to read the document, mark each medicine in or out of stock and
   reply. The preview wording mirrors rx_reply() in server/app.py, which is the
   text the customer actually receives. */

const RX_OPEN_STATES = ["new", "reviewing", "awaiting_customer"];
let rxList = [];
let rxKnown = null;            // request ids seen on earlier polls (null before the first load)
let rxLastNewCount = null;
let rxView = null;             // { req, items } while the viewer is open
let rxSearchTimer = null;
let rxResults = [];
const rxBaseTitle = document.title;

document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("rx-list");
  if (!list) return;
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rx-open]");
    if (b) openRx(Number(b.dataset.rxOpen));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rxView) closeRxViewer(); });
});

/* ---------- list ---------- */

async function loadRx() {
  const el = document.getElementById("rx-list");
  if (!el) return;
  let data;
  try {
    data = await api("/api/chemist/rx-requests");
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Couldn't load prescriptions.</div>`;
    return;
  }
  const fresh = data.requests.filter((r) => r.status === "new");
  if (rxKnown) {
    const arrived = fresh.filter((r) => !rxKnown.has(r.id));
    if (arrived.length && !rxView) {
      toast(arrived.length === 1 ? `New prescription from ${arrived[0].customer_name}` : `${arrived.length} new prescriptions`);
    }
  }
  rxKnown = new Set(data.requests.map((r) => r.id));
  rxList = data.requests;

  const count = document.getElementById("rx-count");
  count.textContent = data.new_count;
  count.classList.toggle("show", data.new_count > 0);
  document.title = (data.new_count ? `(${data.new_count}) ` : "") + rxBaseTitle;
  if (rxLastNewCount !== null && rxLastNewCount !== data.new_count) renderNavActions();   // header badge
  rxLastNewCount = data.new_count;
  renderRxList();
}

function renderRxList() {
  const el = document.getElementById("rx-list");
  if (!rxList.length) {
    el.innerHTML = `<div class="empty-state"><div class="big-emoji">📋</div>No prescriptions yet. When a customer near you sends one, you'll be notified here.</div>`;
    return;
  }
  const open = rxList.filter((r) => RX_OPEN_STATES.includes(r.status));
  const done = rxList.filter((r) => !RX_OPEN_STATES.includes(r.status));
  const upNext = open.length > 1 ? open.find((r) => r.status === "new") : null;
  let html = open.length
    ? open.map((r) => rxCard(r, r === upNext)).join("")
    : `<div class="empty-state">All caught up. New prescriptions will appear here.</div>`;
  if (done.length) html += `<div class="rx-sub">Recently closed</div>` + done.map((r) => rxCard(r, false)).join("");
  el.innerHTML = html;
}

function rxInitials(name) {
  return (name || "?").trim().split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}

function rxTime(ts) {
  const d = new Date(ts * 1000);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${t}`;
}

function rxCard(r, upNext) {
  const avail = r.items.filter((i) => i.in_stock).length;
  const chip = {
    new: `<span class="rx-chip new">New</span>`,
    reviewing: `<span class="rx-chip new">Opened</span>`,
    awaiting_customer: `<span class="rx-chip wait">Waiting for customer</span>`,
    accepted: `<span class="rx-chip ok">Order #${r.order_id}</span>`,
    closed_unavailable: `<span class="rx-chip no">Not available</span>`,
    closed_declined: `<span class="rx-chip muted">Customer said no</span>`,
    closed_cancelled: `<span class="rx-chip muted">Cancelled by customer</span>`,
  }[r.status];
  const log = {
    awaiting_customer: r.reply_kind === "all"
      ? "You replied: all available. Waiting for the customer to pay."
      : `You replied: ${avail} of ${r.items.length} available. Waiting for the customer's answer.`,
    accepted: `Customer bought ${avail} item${avail === 1 ? "" : "s"}. Order #${r.order_id} is in your orders below.`,
    closed_unavailable: "You replied: not available. Request closed.",
    closed_declined: "Customer said no. Request closed.",
    closed_cancelled: "The customer cancelled this prescription. Nothing more to do.",
  }[r.status];
  const meta = r.status === "new" ? "Not opened yet"
    : r.items.length ? `${r.items.length} medicine${r.items.length === 1 ? "" : "s"} listed` : "Opened, not replied yet";
  const primary = r.status === "new" || r.status === "reviewing";
  const closed = !RX_OPEN_STATES.includes(r.status);
  return `<div class="rx-card ${r.status === "new" ? "new" : ""} ${closed ? "closed" : ""}" data-rx-card="${r.id}">
    <div class="rx-card-top">
      <div class="rx-avatar">${escapeHtml(rxInitials(r.customer_name))}</div>
      <div class="who">${upNext ? `<div class="rx-upnext">Up next</div>` : ""}<div class="nm">${escapeHtml(r.customer_name)}</div>
        <div class="tm">Sent ${rxTime(r.created_at)}${r.address && r.address.label ? ` · ${escapeHtml(truncate(r.address.label, 28))}` : ""}</div></div>
      ${chip}
    </div>
    <div class="rx-card-doc">
      <div class="rx-mini">${r.status === "closed_cancelled" ? "—" : r.is_pdf ? "PDF" : `<img src="${r.file_url}" alt="" loading="lazy">`}</div>
      <div class="meta"><b>${escapeHtml(r.file_name)}</b>${meta}</div>
    </div>
    ${log ? `<div class="rx-log">${escapeHtml(log)}</div>` : ""}
    ${r.status === "closed_cancelled" ? "" : `<button class="btn ${primary ? "btn-primary" : "btn-outline"} btn-block" data-rx-open="${r.id}">View document</button>`}
  </div>`;
}

/* ---------- automatic reading ----------
   The photo is read in the chemist's browser with Tesseract (open-source text
   recognition, loaded from a CDN the first time) and matched against the
   catalogue. Detected medicines are only SUGGESTIONS: the chemist ticks the
   right ones and adds them. Recognition can misread, so it never replies for
   them and never adds anything on its own. */

const RX_OCR_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const RX_OCR_MAX_PX = 1800;
const rxDetectCache = new Map();    // request id -> { status, found } so reopening is instant
let rxCatalogue = null;
let rxTessPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!rxTessPromise) {
    rxTessPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = RX_OCR_SRC;
      s.onload = resolve;
      s.onerror = () => { rxTessPromise = null; reject(new Error("offline")); };
      document.head.appendChild(s);
    });
  }
  return rxTessPromise;
}

async function loadCatalogue() {
  if (!rxCatalogue) rxCatalogue = (await api("/api/medicines?limit=200")).medicines;
  return rxCatalogue;
}

function ocrNormalise(text) {
  return String(text).toLowerCase()
    .replace(/(\d)\s*(mg|ml|mcg|gm|g)\b/g, "$1$2")     // "650 mg" -> "650mg"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")                  // "dolo650mg" -> "dolo 650mg"
    .replace(/\s+/g, " ").trim();
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// A word counts as present if it appears exactly, or (for longer words, which
// text recognition often gets one letter wrong) within one edit.
function hasWord(words, token) {
  if (words.has(token)) return true;
  if (token.length < 6 || /\d/.test(token)) return false;
  for (const w of words) if (w.length >= 5 && editDistance(w, token) <= 1) return true;
  return false;
}

// Pure function: recognised text + catalogue -> medicines found on the page.
function matchMedicines(text, catalogue) {
  const words = new Set(ocrNormalise(text).split(" ").filter(Boolean));
  const isStrength = (t) => /^\d+(mg|ml|mcg|gm|g)$/.test(t);
  const brandCount = {};
  const parsed = catalogue.map((m) => {
    const tokens = ocrNormalise(m.name).split(" ").filter(Boolean);
    return { m, brand: tokens[0], strength: tokens.find(isStrength), rest: tokens.slice(1).filter((t) => !isStrength(t)) };
  });
  parsed.forEach((p) => { brandCount[p.brand] = (brandCount[p.brand] || 0) + 1; });

  // Names that start with an ordinary word ("A to Z", "Dr Morepen", "Clinic
  // Plus", "Hot Water Bag") would match any prescription containing that word,
  // so they need the whole product name present, not just the first word.
  const ORDINARY = new Set(["clinic", "digital", "cotton", "band", "crepe", "pulse", "sugar", "hot", "insulin", "johnson"]);
  const SHORT_OK = new Set(["pan", "eno", "ors"]);        // distinctive despite being short

  const found = [];
  for (const p of parsed) {
    const needsFullName = ORDINARY.has(p.brand) || (p.brand.length < 4 && !SHORT_OK.has(p.brand));
    if (needsFullName) {
      if (p.m.name && [p.brand, ...p.rest].every((t) => hasWord(words, t)) && (!p.strength || words.has(p.strength))) found.push(p.m);
      continue;
    }
    if (!hasWord(words, p.brand)) continue;
    // "Dolo 500" on the page is a different product from "Dolo 650mg" in the catalogue.
    if (p.strength && !words.has(p.strength) && !words.has(p.strength.replace(/(mg|ml|mcg|gm|g)$/, ""))) continue;
    // Brands with several products (Vicks, Crocin...) need the rest of the name too.
    if (brandCount[p.brand] > 1 && !p.rest.every((t) => hasWord(words, t))) continue;
    found.push(p.m);
  }
  return found;
}

async function ocrBlob(blob, onProgress) {
  await loadTesseract();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, RX_OCR_MAX_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100)); },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function runDetection(r) {
  const cached = rxDetectCache.get(r.id);
  if (cached && cached.status !== "scanning") { paintDetect(r.id, cached); return; }
  if (r.is_pdf) {
    const st = { status: "pdf", found: [] };
    rxDetectCache.set(r.id, st); paintDetect(r.id, st);
    return;
  }
  const st = { status: "scanning", progress: 0, found: [] };
  rxDetectCache.set(r.id, st);
  paintDetect(r.id, st);
  try {
    const [catalogue, blob] = await Promise.all([
      loadCatalogue(),
      fetch(r.file_url, { credentials: "same-origin" }).then((res) => { if (!res.ok) throw new Error("file"); return res.blob(); }),
    ]);
    const text = await ocrBlob(blob, (p) => { st.progress = p; paintDetect(r.id, st); });
    st.found = matchMedicines(text, catalogue);
    st.status = st.found.length ? "done" : "none";
  } catch (e) {
    st.status = e.message === "offline" ? "offline" : "failed";
  }
  paintDetect(r.id, st);
}

function paintDetect(rid, st) {
  if (!rxView || rxView.req.id !== rid) return;           // viewer moved on
  const box = document.getElementById("rxv-detect");
  if (!box) return;
  const listed = new Set(rxView.items.map((i) => i.medicine_id));
  const todo = st.found.filter((m) => !listed.has(m.id));
  const note = `<div class="rxv-dnote">Automatic reading can misread. Check each one against the document.</div>`;
  if (st.status === "scanning") {
    box.innerHTML = `<div class="rxv-detect scanning"><span class="rxv-spin"></span><div>
      <b>Reading the prescription...</b><span>${st.progress ? st.progress + "% done" : "Loading the reader, first time only"}</span></div></div>`;
  } else if (st.status === "done" && todo.length) {
    box.innerHTML = `<div class="rxv-detect found">
      <div class="rxv-dh"><b>Detected ${st.found.length} medicine${st.found.length === 1 ? "" : "s"}</b><span>Untick any that are wrong</span></div>
      ${todo.map((m) => `<label class="rxv-dopt"><input type="checkbox" checked data-detect="${m.id}"><span><b>${escapeHtml(m.name)}</b>
        <i>${escapeHtml(m.unit)} · ${currency(m.price)}</i></span></label>`).join("")}
      <button class="btn btn-primary btn-block" id="rxv-add-detected">Add selected to the list</button>${note}</div>`;
    document.getElementById("rxv-add-detected").onclick = () => {
      const picked = [...box.querySelectorAll("[data-detect]:checked")].map((c) => Number(c.dataset.detect));
      todo.filter((m) => picked.includes(m.id)).forEach((m) => rxView.items.push(
        { medicine_id: m.id, name: m.name, unit: m.unit, price: m.price, qty: 1, in_stock: true }));
      renderRxItems();
      paintDetect(rid, st);
    };
  } else if (st.status === "done") {
    box.innerHTML = `<div class="rxv-detect ok"><b>All detected medicines are in your list.</b>${note}</div>`;
  } else if (st.status === "none") {
    box.innerHTML = `<div class="rxv-detect warn"><b>No known medicines detected.</b><span>The photo may be blurry or handwritten. Add them with the search below.</span></div>`;
  } else if (st.status === "pdf") {
    box.innerHTML = `<div class="rxv-detect warn"><b>Automatic reading works on photos.</b><span>For a PDF, add the medicines with the search below.</span></div>`;
  } else if (st.status === "offline") {
    box.innerHTML = `<div class="rxv-detect warn"><b>Couldn't load the reader.</b><span>It needs an internet connection the first time. Add medicines with the search below.</span></div>`;
  } else {
    box.innerHTML = `<div class="rxv-detect warn"><b>Couldn't read this file.</b><span>Add the medicines with the search below.</span></div>`;
  }
}

/* ---------- viewer ---------- */

async function openRx(id) {
  let res;
  try {
    res = await api(`/api/chemist/rx-requests/${id}/open`, { method: "POST", body: "{}" });
  } catch (e) {
    toast(e.message);
    loadRx();
    return;
  }
  const r = res.request;
  rxView = { req: r, items: r.items.map((i) => ({ ...i })) };
  renderRxViewer();
  loadRx();           // its chip becomes "Opened"
}

function closeRxViewer() {
  rxView = null;
  const box = document.getElementById("rx-viewer");
  box.hidden = true;
  box.innerHTML = "";
  document.body.style.overflow = "";
}

function renderRxViewer() {
  const box = document.getElementById("rx-viewer");
  const r = rxView.req;
  const editable = r.status === "reviewing";
  const doc = r.is_pdf
    ? `<iframe src="${r.file_url}" title="Prescription PDF"></iframe>`
    : `<img src="${r.file_url}" alt="Prescription from ${escapeHtml(r.customer_name)}">`;
  box.innerHTML = `
    <div class="rxv" role="dialog" aria-modal="true" aria-label="Prescription from ${escapeHtml(r.customer_name)}">
      <div class="rxv-head">
        <div class="rx-avatar">${escapeHtml(rxInitials(r.customer_name))}</div>
        <div><div class="t">${escapeHtml(r.customer_name)}'s prescription</div>
          <div class="s">${escapeHtml(r.file_name)} · sent ${rxTime(r.created_at)}</div></div>
        <button class="rxv-close" id="rxv-close" aria-label="Close">✕</button>
      </div>
      <div class="rxv-main">
        <div class="rxv-doc">
          <div class="frame">${doc}</div>
          <a class="open-full" href="${r.file_url}" target="_blank" rel="noopener">Open full size ↗</a>
        </div>
        <div class="rxv-side">
          <div class="rxv-body">
            <h4>Medicines on this prescription</h4>
            <div class="rxv-hint">${editable
              ? "Add each medicine you can read on the prescription, then mark it in stock or out of stock."
              : "You have already replied to this prescription."}</div>
            ${editable ? `<div id="rxv-detect"></div>
            <div class="rxv-search">
              <input id="rxv-q" type="search" placeholder="Search medicine to add, e.g. Dolo" autocomplete="off" enterkeyhint="search">
              <div class="rxv-results" id="rxv-results"></div>
            </div>` : ""}
            <div id="rxv-items"></div>
          </div>
          <div class="rxv-foot" id="rxv-foot"></div>
        </div>
      </div>
    </div>`;
  box.hidden = false;
  document.body.style.overflow = "hidden";

  document.getElementById("rxv-close").onclick = closeRxViewer;
  box.onclick = (e) => {
    if (e.target === box) { closeRxViewer(); return; }
    const results = document.getElementById("rxv-results");
    if (results && !e.target.closest(".rxv-search")) results.classList.remove("show");
  };
  if (editable) { wireRxSearch(); runDetection(r); }
  renderRxItems();
}

function renderRxItems() {
  const { req: r, items } = rxView;
  const editable = r.status === "reviewing";
  const list = document.getElementById("rxv-items");
  if (!items.length) {
    list.innerHTML = `<div class="rxv-empty-list">No medicines added yet.<br>Search above to add what's written on the prescription.</div>`;
  } else {
    list.innerHTML = items.map((i, idx) => `
      <div class="rxv-row">
        <div class="rxv-row-top">
          <div class="nm"><b>${escapeHtml(i.name)}</b><span>${escapeHtml(i.unit || "")} · ${currency(i.price)} each</span></div>
          ${editable ? `
            <div class="qty-control"><button data-q="-1" data-i="${idx}" aria-label="Decrease">−</button><span>${i.qty}</span><button data-q="1" data-i="${idx}" aria-label="Increase">+</button></div>
            <button class="rxv-rm" data-rm="${idx}" aria-label="Remove ${escapeHtml(i.name)}">✕</button>`
            : `<span style="font-weight:700;">x${i.qty}</span>`}
        </div>
        ${editable ? `<div class="rxv-stock">
            <button class="in ${i.in_stock ? "on" : ""}" data-stock="1" data-i="${idx}">In stock</button>
            <button class="out ${!i.in_stock ? "on" : ""}" data-stock="0" data-i="${idx}">Out of stock</button>
          </div>` : `<div style="margin-top:8px;"><span class="rx-chip ${i.in_stock ? "ok" : "no"}">${i.in_stock ? "In stock" : "Out of stock"}</span></div>`}
      </div>`).join("");
  }

  const foot = document.getElementById("rxv-foot");
  if (editable) {
    const reply = rxClientReply(items);
    foot.innerHTML = `
      <div class="rxv-preview"><div class="pl">Customer will see</div>${escapeHtml(reply ? reply.text : "Add at least one medicine first.")}</div>
      <button class="btn btn-primary" id="rxv-send" ${reply ? "" : "disabled"}>Send reply to customer</button>`;
    document.getElementById("rxv-send").onclick = sendRxReply;
  } else {
    foot.innerHTML = `<div class="rxv-preview"><div class="pl">You replied</div>${escapeHtml(r.reply_text || "")}</div>`;
  }

  if (!editable) return;
  list.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => {
    const it = items[b.dataset.i];
    it.qty = Math.min(20, Math.max(1, it.qty + Number(b.dataset.q)));
    renderRxItems();
  });
  list.querySelectorAll("[data-stock]").forEach((b) => b.onclick = () => {
    items[b.dataset.i].in_stock = b.dataset.stock === "1";
    renderRxItems();
  });
  list.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => {
    items.splice(Number(b.dataset.rm), 1);
    renderRxItems();
    const st = rxDetectCache.get(r.id);
    if (st) paintDetect(r.id, st);       // a removed medicine can be suggested again
  });
}

// Same rules as rx_reply() on the server.
function rxClientReply(items) {
  if (!items.length) return null;
  const names = (l) => (l.length === 1 ? l[0].name : l.slice(0, -1).map((i) => i.name).join(", ") + " and " + l[l.length - 1].name);
  const a = items.filter((i) => i.in_stock), o = items.filter((i) => !i.in_stock);
  if (!a.length) return { kind: "none", text: "Medicine not available. We are sorry for the inconvenience." };
  if (!o.length) {
    const what = a.length === 1 ? "your medicine is" : a.length === 2 ? "both medicines are" : `all ${a.length} medicines are`;
    return { kind: "all", text: `Good news, ${what} available.` };
  }
  return {
    kind: "partial",
    text: `${names(a)} ${a.length > 1 ? "are" : "is"} available but ${names(o)} ${o.length > 1 ? "are" : "is"} out of stock. Would you like to buy the available stock?`,
  };
}

function wireRxSearch() {
  const input = document.getElementById("rxv-q");
  const box = document.getElementById("rxv-results");
  const hide = () => box.classList.remove("show");
  const add = (m) => {
    rxView.items.push({ medicine_id: m.id, name: m.name, unit: m.unit, price: m.price, qty: 1, in_stock: true });
    input.value = "";
    hide();
    renderRxItems();
    input.focus();
  };
  input.addEventListener("input", () => {
    clearTimeout(rxSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) { hide(); return; }
    rxSearchTimer = setTimeout(async () => {
      try {
        const { medicines } = await api(`/api/medicines?q=${encodeURIComponent(q)}`);
        if (input.value.trim() !== q) return;
        const taken = new Set(rxView.items.map((i) => i.medicine_id));
        rxResults = medicines.filter((m) => !taken.has(m.id)).slice(0, 8);
        box.innerHTML = rxResults.length
          ? rxResults.map((m, i) => `<button type="button" data-pick="${i}">${escapeHtml(m.name)}<span>${escapeHtml(m.unit)} · ${currency(m.price)}</span></button>`).join("")
          : `<div class="none">No medicine called "${escapeHtml(q)}" in the catalogue.</div>`;
        box.classList.add("show");
      } catch (e) { hide(); }
    }, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (rxResults[0] && box.classList.contains("show")) add(rxResults[0]); }
    else if (e.key === "Escape") { e.stopPropagation(); hide(); }
  });
  box.addEventListener("mousedown", (e) => e.preventDefault());   // keep focus in the input
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) add(rxResults[Number(b.dataset.pick)]);
  });
}

async function sendRxReply() {
  const btn = document.getElementById("rxv-send");
  const { req: r, items } = rxView;
  const reply = rxClientReply(items);
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    await api(`/api/chemist/rx-requests/${r.id}/reply`, {
      method: "POST",
      body: JSON.stringify({ items: items.map((i) => ({ medicine_id: i.medicine_id, qty: i.qty, in_stock: i.in_stock })) }),
    });
  } catch (e) {
    toast(e.message);
    if (/cancelled/i.test(e.message)) {        // the customer withdrew it while this was open
      closeRxViewer();
      loadRx();
      return;
    }
    btn.disabled = false;
    btn.textContent = "Send reply to customer";
    return;
  }
  closeRxViewer();
  toast(reply.kind === "none" ? "Reply sent. Request closed." : "Reply sent to the customer");
  await loadRx();
  // Point straight at the next prescription waiting in the queue.
  const next = rxList.find((x) => x.status === "new");
  if (next) {
    setTimeout(() => toast(`Up next: ${next.customer_name}`), 1800);
    const card = document.querySelector(`[data-rx-card="${next.id}"]`);
    if (card) { card.classList.add("flash"); card.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
}
