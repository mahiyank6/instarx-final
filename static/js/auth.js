let mode = "login";      // login | signup | verify
let role = "customer";   // customer | chemist
let chosenLocation = null;
let pendingEmail = null;
let resendTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
  redirectIfLoggedIn();

  document.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("#role-toggle-wrap button").forEach((b) =>
    b.addEventListener("click", () => setRole(b.dataset.role)));
  document.getElementById("auth-form").addEventListener("submit", onSubmit);
  document.getElementById("verify-form").addEventListener("submit", onVerify);
  document.getElementById("use-location-btn").addEventListener("click", onUseLocation);
  document.getElementById("resend-btn").addEventListener("click", onResend);
  document.getElementById("verify-back").addEventListener("click", (e) => {
    e.preventDefault(); setMode("login");
  });
  wireSwitchLink();
  wireOtpInputs();
  document.getElementById("pw-toggle").addEventListener("click", () => setPasswordVisible(
    document.getElementById("pw-input").type === "password"));

  const p =new URLSearchParams(location.search);
  if (p.get("mode") === "signup") setMode("signup");
  if (p.get("role") === "chemist") { setMode("signup"); setRole("chemist"); }
});

async function redirectIfLoggedIn() {
  try {
    const { user } = await api("/api/me");
    if (user) location.href = user.role === "chemist" ? "/chemist-dashboard.html" : "/";
  } catch (e) { /* not logged in */ }
}

function wireSwitchLink() {
  const link = document.getElementById("switch-link");
  if (link) link.addEventListener("click", (e) => {
    e.preventDefault();
    setMode(mode === "login" ? "signup" : "login");
  });
}

// One password field serves both log in and sign up, so one toggle covers both.
function setPasswordVisible(show) {
  const input = document.getElementById("pw-input");
  const btn = document.getElementById("pw-toggle");
  input.type = show ? "text" : "password";
  btn.setAttribute("aria-pressed", show ? "true" : "false");
  const label = show ? "Hide password" : "Show password";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function setMode(m) {
  mode = m;
  setPasswordVisible(false);        // never carry a revealed password into another mode
  const isVerify = m === "verify";
  document.getElementById("auth-pane").style.display = isVerify ? "none" : "block";
  document.getElementById("verify-pane").style.display = isVerify ? "block" : "none";
  if (isVerify) return;

  document.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m));
  document.getElementById("role-toggle-wrap").style.display = m === "signup" ? "flex" : "none";
  document.querySelectorAll(".signup-only").forEach((el) =>
    (el.style.display = m === "signup" ? "block" : "none"));
  document.getElementById("chemist-fields").style.display =
    m === "signup" && role === "chemist" ? "block" : "none";
  document.getElementById("remember-wrap").style.display = m === "login" ? "flex" : "none";
  document.getElementById("form-title").textContent =
    m === "login" ? "Welcome back" : "Create your account";
  document.getElementById("form-sub").textContent = m === "login"
    ? "Log in to order from chemists near you."
    : "We'll email you a code to confirm it's really you.";
  document.getElementById("submit-btn").textContent =
    m === "login" ? "Log in" : "Create account";
  document.getElementById("switch-wrap").innerHTML = m === "login"
    ? `New to InstaRX? <a href="#" id="switch-link">Create an account</a>`
    : `Already have an account? <a href="#" id="switch-link">Log in</a>`;
  wireSwitchLink();
  hideError();
}

function setRole(r) {
  role = r;
  document.querySelectorAll("#role-toggle-wrap button").forEach((b) =>
    b.classList.toggle("active", b.dataset.role === r));
  document.getElementById("chemist-fields").style.display = r === "chemist" ? "block" : "none";
}

function showError(msg, paneId = "form-error") {
  const el = document.getElementById(paneId);
  el.textContent = msg;
  el.style.display = "block";
}
function hideError() {
  ["form-error", "verify-error"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

async function onUseLocation() {
  const status = document.getElementById("location-status");
  status.textContent = "Detecting your location…";
  try {
    const loc = await detectLocation();
    chosenLocation = loc;
    status.textContent = `📍 ${loc.label}`;
    const addr = document.querySelector('input[name="address"]');
    if (!addr.value) addr.value = loc.label;
  } catch (e) {
    status.textContent = "Couldn't detect location — type your shop address instead.";
  }
}

/* ---------- submit (login or signup) ---------- */

async function onSubmit(e) {
  e.preventDefault();
  hideError();
  const fd = new FormData(e.target);
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = mode === "login" ? "Logging in…" : "Creating account…";

  try {
    if (mode === "login") {
      const res = await fetch("/api/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          remember: document.getElementById("remember-me").checked,
        }),
      });
      const data = await res.json();
      if (res.status === 403 && data.pending_verification) {
        enterVerify(data);               // unverified account, code re-sent
        return;
      }
      if (!res.ok) throw new Error(data.error || "Login failed");
      toast(`Welcome back, ${data.user.name.split(" ")[0]}`);
      location.href = data.user.role === "chemist" ? "/chemist-dashboard.html" : "/";
    } else {
      const payload = {
        role, name: fd.get("name"), email: fd.get("email"),
        password: fd.get("password"), phone: fd.get("phone"),
      };
      if (role === "chemist") {
        payload.shop_name = fd.get("shop_name");
        payload.license_no = fd.get("license_no");
        payload.address = fd.get("address");
        if (chosenLocation) { payload.lat = chosenLocation.lat; payload.lng = chosenLocation.lng; }
      }
      const data = await api("/api/signup", { method: "POST", body: JSON.stringify(payload) });
      enterVerify(data);
    }
  } catch (err) {
    showError(err.message);
  }
  btn.disabled = false;
  btn.textContent = original;
}

/* ---------- verification step ---------- */

function enterVerify(data) {
  pendingEmail = data.email;
  document.getElementById("verify-email").textContent = data.email;
  setMode("verify");
  hideError();
  clearOtp();
  showDevCode(data);
  startResendCooldown();
  document.querySelector(".otp-input").focus();
}

function showDevCode(data) {
  const box = document.getElementById("dev-code-box");
  if (data.dev_code) {
    box.style.display = "block";
    box.innerHTML = `Email sending isn't configured on this server, so here's your code:
      <b>${escapeHtml(data.dev_code)}</b>`;
  } else {
    box.style.display = "block";
    box.innerHTML = `We've emailed a 6-digit code to <b>${escapeHtml(data.email || pendingEmail)}</b>.
      Check your spam folder if it doesn't arrive.`;
  }
}

function wireOtpInputs() {
  const inputs = [...document.querySelectorAll(".otp-input")];
  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
      if (inputs.every((x) => x.value)) document.getElementById("verify-form")
        .dispatchEvent(new Event("submit", { cancelable: true }));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      digits.split("").forEach((d, k) => { if (inputs[k]) inputs[k].value = d; });
      if (digits.length === 6) document.getElementById("verify-form")
        .dispatchEvent(new Event("submit", { cancelable: true }));
    });
  });
}

function clearOtp() {
  document.querySelectorAll(".otp-input").forEach((i) => (i.value = ""));
}
function readOtp() {
  return [...document.querySelectorAll(".otp-input")].map((i) => i.value).join("");
}

async function onVerify(e) {
  e.preventDefault();
  hideError();
  const code = readOtp();
  if (code.length !== 6) { showError("Enter all 6 digits", "verify-error"); return; }

  const btn = document.getElementById("verify-btn");
  btn.disabled = true;
  btn.textContent = "Verifying…";
  try {
    const { user } = await api("/api/verify", {
      method: "POST",
      body: JSON.stringify({ email: pendingEmail, code }),
    });
    toast(`You're all set, ${user.name.split(" ")[0]}`);
    location.href = user.role === "chemist" ? "/chemist-dashboard.html" : "/";
  } catch (err) {
    showError(err.message, "verify-error");
    clearOtp();
    document.querySelector(".otp-input").focus();
  }
  btn.disabled = false;
  btn.textContent = "Verify & continue";
}

async function onResend() {
  hideError();
  try {
    const data = await api("/api/resend-code", {
      method: "POST", body: JSON.stringify({ email: pendingEmail }),
    });
    showDevCode({ ...data, email: pendingEmail });
    toast("New code sent");
    startResendCooldown();
  } catch (err) {
    showError(err.message, "verify-error");
  }
}

function startResendCooldown() {
  const btn = document.getElementById("resend-btn");
  let left = 60;
  clearInterval(resendTimer);
  btn.disabled = true;
  const tick = () => {
    btn.textContent = left > 0 ? `Resend code (${left}s)` : "Resend code";
    if (left <= 0) { btn.disabled = false; clearInterval(resendTimer); }
    left -= 1;
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}
