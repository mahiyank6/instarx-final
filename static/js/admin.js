function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

async function loadAdminData() {
  let data;
  try {
    data = await api("/api/admin/overview");
  } catch (e) {
    document.getElementById("last-updated").textContent = "Couldn't load data — is the server running?";
    return;
  }

  document.getElementById("last-updated").textContent = "Last updated: " + fmtDate(data.generated_at);

  const customerCount = data.users.filter((u) => u.role === "customer").length;
  const chemistCount = data.users.filter((u) => u.role === "chemist").length;
  const onlineChemists = data.chemists.filter((c) => c.online).length;

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${data.users.length}</div><div class="lbl">Total Accounts</div></div>
    <div class="stat-card"><div class="num">${customerCount}</div><div class="lbl">Customers</div></div>
    <div class="stat-card"><div class="num">${chemistCount}</div><div class="lbl">Chemists (${onlineChemists} online)</div></div>
    <div class="stat-card"><div class="num">${data.orders.length}</div><div class="lbl">Orders Placed</div></div>
    <div class="stat-card"><div class="num">${data.medicines_count}</div><div class="lbl">Medicines in Catalog</div></div>
  `;

  const usersBody = document.getElementById("users-body");
  usersBody.innerHTML = data.users.length ? data.users.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="role-pill ${u.role}">${u.role}</span></td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td>${fmtDate(u.created_at)}</td>
    </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No accounts signed up yet.</td></tr>`;

  const chemistsBody = document.getElementById("chemists-body");
  chemistsBody.innerHTML = data.chemists.length ? data.chemists.map((c) => `
    <tr>
      <td>${escapeHtml(c.shop_name)}</td>
      <td>${escapeHtml(c.owner_name || "—")}<br><span class="admin-sub">${escapeHtml(c.owner_email || "")}</span></td>
      <td>${escapeHtml(c.address || "—")}</td>
      <td><span class="badge ${c.online ? "online" : "offline"}">${c.online ? "Online" : "Offline"}</span></td>
      <td>${escapeHtml(c.license_no || "—")}</td>
    </tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No chemist shops registered yet.</td></tr>`;

  const ordersBody = document.getElementById("orders-body");
  ordersBody.innerHTML = data.orders.length ? data.orders.map((o) => `
    <tr>
      <td>#${o.id}</td>
      <td>${escapeHtml(o.customer_name)}<br><span class="admin-sub">${escapeHtml(o.customer_email || "")}</span></td>
      <td>${escapeHtml(o.chemist_name || "—")}</td>
      <td><span class="badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
      <td>${currency(o.total)}${o.delivery_charge ? ` + ${currency(o.delivery_charge)}` : ""}</td>
      <td class="mono">${o.otp || "—"}</td>
      <td>${fmtDate(o.created_at)}</td>
    </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No orders placed yet.</td></tr>`;
}

document.addEventListener("DOMContentLoaded", () => {
  loadAdminData();
  document.getElementById("refresh-btn").addEventListener("click", loadAdminData);
  setInterval(loadAdminData, 5000);
});
