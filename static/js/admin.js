/* Live user database — every account plus the products they've ordered.
   Read-only. Passwords are hashed server-side and never sent here. */

let openUsers = new Set();   // keep expanded rows open across auto-refreshes

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function adminHeaders() {
  let pw = "";
  try { pw = sessionStorage.getItem("instarx-admin-pw") || ""; } catch (e) { /* storage blocked */ }
  return pw ? { "X-Admin-Password": pw } : {};
}

let askingPassword = false;

async function loadAdminData() {
  let data;
  try {
    data = await api("/api/admin/overview", { headers: adminHeaders() });
  } catch (e) {
    const label = document.getElementById("last-updated");
    if (/Admin login required/.test(e.message)) {
      label.textContent = "Admin password needed";
      if (!askingPassword) {
        askingPassword = true;
        const pw = window.prompt("Admin password:");
        askingPassword = false;
        if (pw) {
          try { sessionStorage.setItem("instarx-admin-pw", pw); } catch (err) { /* storage blocked */ }
          return loadAdminData();
        }
      }
    } else {
      label.textContent = "Couldn't reach the server";
    }
    return;
  }

  document.getElementById("last-updated").textContent = "Updated " + fmtDate(data.generated_at);

  const customers = data.users.filter((u) => u.role === "customer");
  const chemists = data.users.filter((u) => u.role === "chemist");
  const verified = data.users.filter((u) => u.verified).length;
  const revenue = data.orders.reduce((s, o) => s + (o.total || 0) + (o.delivery_charge || 0), 0);

  document.getElementById("stats").innerHTML = `
    <div class="stat"><div class="stat-num">${data.users.length}</div><div class="lbl">Total accounts</div></div>
    <div class="stat"><div class="stat-num">${verified}</div><div class="lbl">Email verified</div></div>
    <div class="stat"><div class="stat-num">${customers.length}</div><div class="lbl">Customers</div></div>
    <div class="stat"><div class="stat-num">${chemists.length}</div><div class="lbl">Chemists</div></div>
    <div class="stat"><div class="stat-num">${data.orders.length}</div><div class="lbl">Orders placed</div></div>
    <div class="stat"><div class="stat-num">${currency(revenue)}</div><div class="lbl">Order value</div></div>
  `;

  const list = document.getElementById("users-list");
  if (!data.users.length) {
    list.innerHTML = `<div class="empty-state"><div class="big-emoji">👤</div>
      No accounts yet. Sign up on the site and they'll appear here instantly.</div>`;
    return;
  }

  const chemistByUser = Object.fromEntries(data.chemists.map((c) => [c.user_id, c]));

  list.innerHTML = data.users.map((u) => {
    const theirOrders = u.role === "chemist"
      ? data.orders.filter((o) => o.chemist_id === u.id)
      : data.orders.filter((o) => o.customer_id === u.id);
    const spend = theirOrders.reduce((s, o) => s + (o.total || 0) + (o.delivery_charge || 0), 0);
    const shop = chemistByUser[u.id];
    const isOpen = openUsers.has(u.id);

    const statusPills = `
      <span class="pill ${u.role === "chemist" ? "chem" : "cust"}">${u.role}</span>
      <span class="pill ${u.verified ? "ok" : "no"}">${u.verified ? "verified" : "unverified"}</span>
      ${u.locked ? `<span class="pill lock">locked</span>` : ""}`;

    const details = `
      <div class="kv">
        <div><div class="k">User ID</div><div class="v mono">#${u.id}</div></div>
        <div><div class="k">Email</div><div class="v mono">${escapeHtml(u.email)}</div></div>
        <div><div class="k">Phone</div><div class="v">${escapeHtml(u.phone || "—")}</div></div>
        <div><div class="k">Password</div><div class="v" style="color:var(--text-muted);">hashed — not readable</div></div>
        <div><div class="k">Signed up</div><div class="v">${fmtDate(u.created_at)}</div></div>
        <div><div class="k">${u.role === "chemist" ? "Orders fulfilled" : "Orders placed"}</div><div class="v">${theirOrders.length}</div></div>
        ${shop ? `
        <div><div class="k">Shop name</div><div class="v">${escapeHtml(shop.shop_name || "—")}</div></div>
        <div><div class="k">Licence no.</div><div class="v mono">${escapeHtml(shop.license_no || "—")}</div></div>
        <div><div class="k">Shop address</div><div class="v">${escapeHtml(shop.address || "—")}</div></div>
        <div><div class="k">Currently</div><div class="v">${shop.online ? "Online" : "Offline"}</div></div>` : ""}
      </div>`;

    const orders = theirOrders.length ? theirOrders.map((o) => `
      <div class="ord">
        <div class="ord-top">
          <span class="ord-id">Order #${o.id}</span>
          <span class="badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
        </div>
        ${o.items && o.items.length ? `
          <ul class="ord-items">
            ${o.items.map((i) => `<li><span>${escapeHtml(i.name)}</span>
              <span class="q">× ${i.qty} &nbsp;·&nbsp; ${currency(i.price * i.qty)}</span></li>`).join("")}
          </ul>` : `<div style="font-size:13px;color:var(--text-muted);">Prescription order — items set by the chemist</div>`}
        <div class="ord-foot">
          <span>${u.role === "chemist" ? "Customer: " + escapeHtml(o.customer_name || "—") : "Chemist: " + escapeHtml(o.chemist_name || "not accepted yet")}</span>
          <span><b style="color:var(--navy);">${currency((o.total || 0) + (o.delivery_charge || 0))}</b>
            ${o.delivery_charge ? ` (incl. ${currency(o.delivery_charge)} delivery)` : ""}</span>
        </div>
        <div class="ord-foot" style="border-top:none;padding-top:0;margin-top:3px;">
          <span>Placed ${fmtDate(o.created_at)}</span>
          <span>OTP <span class="mono">${o.otp || "—"}</span></span>
        </div>
      </div>`).join("")
      : `<div style="font-size:13px;color:var(--text-muted);padding:4px 2px;">No orders yet.</div>`;

    return `
      <div class="user-block ${isOpen ? "open" : ""}" data-uid="${u.id}">
        <div class="user-head">
          <div class="user-av ${u.role}">${escapeHtml(initials(u.name))}</div>
          <div class="user-main">
            <div class="user-name">${escapeHtml(u.name)} ${statusPills}</div>
            <div class="user-mail">${escapeHtml(u.email)}</div>
          </div>
          <div class="user-right"><b>${theirOrders.length}</b>${currency(spend)}</div>
          <div class="caret">▶</div>
        </div>
        <div class="user-body">
          ${details}
          <div style="font-size:12.5px;font-weight:700;color:var(--navy);margin:4px 0 9px;">
            ${u.role === "chemist" ? "Orders fulfilled" : "Products ordered"}
          </div>
          ${orders}
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".user-block").forEach((block) => {
    block.querySelector(".user-head").addEventListener("click", () => {
      const id = Number(block.dataset.uid);
      block.classList.toggle("open");
      block.classList.contains("open") ? openUsers.add(id) : openUsers.delete(id);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadAdminData();
  document.getElementById("refresh-btn").addEventListener("click", loadAdminData);
  setInterval(loadAdminData, 5000);
});
