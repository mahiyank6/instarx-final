let mode = "login"; // login | signup
let role = "customer"; // customer | chemist
let chosenLocation = null;

document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
  redirectIfLoggedIn();

  document.querySelectorAll("#mode-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll("#role-toggle-wrap button").forEach((btn) => {
    btn.addEventListener("click", () => setRole(btn.dataset.role));
  });
  document.getElementById("switch-link").addEventListener("click", (e) => {
    e.preventDefault();
    setMode(mode === "login" ? "signup" : "login");
  });
  document.getElementById("auth-form").addEventListener("submit", onSubmit);
  document.getElementById("use-location-btn").addEventListener("click", onUseLocation);

  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "signup") setMode("signup");
  if (params.get("role") === "chemist") { setMode("signup"); setRole("chemist"); }
});

async function redirectIfLoggedIn() {
  try {
    const { user } = await api("/api/me");
    if (user) window.location.href = user.role === "chemist" ? "/chemist-dashboard.html" : "/";
  } catch (e) { /* ignore */ }
}

function setMode(m) {
  mode = m;
  document.querySelectorAll("#mode-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  document.getElementById("role-toggle-wrap").style.display = m === "signup" ? "flex" : "none";
  document.querySelectorAll(".signup-only").forEach((el) => (el.style.display = m === "signup" ? "block" : "none"));
  document.getElementById("chemist-fields").style.display = m === "signup" && role === "chemist" ? "block" : "none";
  document.getElementById("form-title").textContent = m === "login" ? "Welcome back" : "Create your account";
  document.getElementById("submit-btn").textContent = m === "login" ? "Login" : "Create Account";
  document.getElementById("switch-text").innerHTML = m === "login"
    ? `New to InstaRX? <a href="#" id="switch-link">Create an account</a>`
    : `Already have an account? <a href="#" id="switch-link">Login</a>`;
  document.getElementById("switch-link").addEventListener("click", (e) => {
    e.preventDefault();
    setMode(mode === "login" ? "signup" : "login");
  });
  hideError();
}

function setRole(r) {
  role = r;
  document.querySelectorAll("#role-toggle-wrap button").forEach((b) => b.classList.toggle("active", b.dataset.role === r));
  document.getElementById("chemist-fields").style.display = r === "chemist" ? "block" : "none";
}

function showError(msg) {
  const el = document.getElementById("form-error");
  el.textContent = msg;
  el.style.display = "block";
}
function hideError() {
  document.getElementById("form-error").style.display = "none";
}

async function onUseLocation() {
  const status = document.getElementById("location-status");
  status.textContent = "Detecting your location...";
  try {
    const loc = await detectLocation();
    chosenLocation = loc;
    status.textContent = `📍 ${loc.label}`;
    const addrInput = document.querySelector('input[name="address"]');
    if (!addrInput.value) addrInput.value = loc.label;
  } catch (e) {
    status.textContent = "Couldn't detect location — enter your address manually.";
  }
}

async function onSubmit(e) {
  e.preventDefault();
  hideError();
  const form = e.target;
  const fd = new FormData(form);
  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  try {
    if (mode === "login") {
      const { user } = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      toast(`Welcome back, ${user.name.split(" ")[0]}!`);
      window.location.href = user.role === "chemist" ? "/chemist-dashboard.html" : "/";
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
      const { user } = await api("/api/signup", { method: "POST", body: JSON.stringify(payload) });
      toast(`Welcome to InstaRX, ${user.name.split(" ")[0]}!`);
      window.location.href = user.role === "chemist" ? "/chemist-dashboard.html" : "/";
    }
  } catch (e) {
    showError(e.message);
  }
  submitBtn.disabled = false;
}
