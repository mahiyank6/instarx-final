/* Hand-drawn product illustrations, used where Wikimedia Commons has no
   usable real photography for a category. Flat vector, blue palette, drawn to
   sit next to the real packshots without clashing. Nothing AI-generated. */

const ILLUS_PALETTE = {
  navy: "#03045E", blue: "#0077B6", cyan: "#00B4D8",
  sky: "#90E0EF", ice: "#CAF0F8", white: "#FFFFFF",
  line: "#023E8A", shade: "#E4F4FB",
};

function illusSyrupBottle() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="40" y="12" width="20" height="9" rx="2.5" fill="#023E8A"/>
    <rect x="43" y="21" width="14" height="6" fill="#0077B6"/>
    <path d="M32 27h36a6 6 0 0 1 6 6v46a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V33a6 6 0 0 1 6-6z" fill="#CAF0F8" stroke="#0077B6" stroke-width="2.5"/>
    <path d="M26 58h48v21a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V58z" fill="#00B4D8"/>
    <rect x="33" y="38" width="34" height="16" rx="2" fill="#FFFFFF" stroke="#90E0EF" stroke-width="1.5"/>
    <rect x="37" y="43" width="26" height="2.6" rx="1.3" fill="#0077B6"/>
    <rect x="37" y="48" width="17" height="2.2" rx="1.1" fill="#90E0EF"/>
  </svg>`;
}

function illusFirstAid() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="16" y="30" width="68" height="48" rx="7" fill="#CAF0F8" stroke="#0077B6" stroke-width="2.5"/>
    <path d="M16 46h68" stroke="#0077B6" stroke-width="2.5"/>
    <rect x="40" y="22" width="20" height="9" rx="3" fill="#0077B6"/>
    <rect x="44.5" y="52" width="11" height="20" rx="2" fill="#FFFFFF"/>
    <rect x="39.5" y="57" width="21" height="10" rx="2" fill="#FFFFFF"/>
    <rect x="22" y="36" width="12" height="5" rx="2.5" fill="#00B4D8"/>
  </svg>`;
}

function illusBabyBottle() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <path d="M46 8c0-2 8-2 8 0v6h-8z" fill="#90E0EF"/>
    <path d="M42 14h16c1 0 2 1 2 2v5H40v-5c0-1 1-2 2-2z" fill="#00B4D8"/>
    <rect x="37" y="21" width="26" height="7" rx="2" fill="#023E8A"/>
    <path d="M36 28h28a5 5 0 0 1 5 5v49a5 5 0 0 1-5 5H36a5 5 0 0 1-5-5V33a5 5 0 0 1 5-5z" fill="#FFFFFF" stroke="#0077B6" stroke-width="2.5"/>
    <path d="M31 60h38v22a5 5 0 0 1-5 5H36a5 5 0 0 1-5-5V60z" fill="#CAF0F8"/>
    <g stroke="#90E0EF" stroke-width="2" stroke-linecap="round">
      <path d="M58 40h6"/><path d="M58 48h6"/><path d="M58 56h6"/><path d="M58 64h6"/>
    </g>
  </svg>`;
}

function illusTube() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="42" y="10" width="16" height="12" rx="2.5" fill="#023E8A"/>
    <path d="M38 22h24l5 10v48a5 5 0 0 1-5 5H38a5 5 0 0 1-5-5V32z" fill="#CAF0F8" stroke="#0077B6" stroke-width="2.5"/>
    <path d="M33 78h34v7a5 5 0 0 1-5 5H38a5 5 0 0 1-5-5z" fill="#0077B6"/>
    <rect x="38" y="38" width="24" height="22" rx="2" fill="#FFFFFF" stroke="#90E0EF" stroke-width="1.5"/>
    <rect x="42" y="44" width="16" height="2.6" rx="1.3" fill="#00B4D8"/>
    <rect x="42" y="50" width="10" height="2.2" rx="1.1" fill="#90E0EF"/>
  </svg>`;
}

function illusPillStrip() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="18" y="26" width="64" height="48" rx="6" fill="#CAF0F8" stroke="#0077B6" stroke-width="2.5"/>
    <g fill="#FFFFFF" stroke="#0077B6" stroke-width="1.8">
      <circle cx="33" cy="40" r="7"/><circle cx="50" cy="40" r="7"/><circle cx="67" cy="40" r="7"/>
      <circle cx="33" cy="60" r="7"/><circle cx="50" cy="60" r="7"/><circle cx="67" cy="60" r="7"/>
    </g>
    <g fill="#00B4D8">
      <circle cx="33" cy="40" r="3"/><circle cx="50" cy="40" r="3"/><circle cx="67" cy="40" r="3"/>
      <circle cx="33" cy="60" r="3"/><circle cx="50" cy="60" r="3"/><circle cx="67" cy="60" r="3"/>
    </g>
  </svg>`;
}

function illusSupplementJar() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="34" y="14" width="32" height="11" rx="3" fill="#023E8A"/>
    <path d="M30 25h40a5 5 0 0 1 5 5v49a5 5 0 0 1-5 5H30a5 5 0 0 1-5-5V30a5 5 0 0 1 5-5z" fill="#FFFFFF" stroke="#0077B6" stroke-width="2.5"/>
    <rect x="30" y="40" width="40" height="26" fill="#00B4D8"/>
    <rect x="35" y="46" width="30" height="3" rx="1.5" fill="#FFFFFF"/>
    <rect x="35" y="53" width="20" height="2.6" rx="1.3" fill="#CAF0F8"/>
  </svg>`;
}

function illusDevice() {
  return `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="thumb-illus" aria-hidden="true">
    <rect x="20" y="24" width="60" height="42" rx="8" fill="#FFFFFF" stroke="#0077B6" stroke-width="2.5"/>
    <rect x="28" y="33" width="44" height="22" rx="4" fill="#CAF0F8"/>
    <path d="M33 45h7l3-7 4 13 4-9 3 3h10" stroke="#0077B6" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="34" y="66" width="32" height="12" rx="4" fill="#90E0EF"/>
    <circle cx="50" cy="72" r="3.2" fill="#0077B6"/>
  </svg>`;
}

const CATEGORY_FALLBACK = {
  "OTC Medicines": illusSyrupBottle,
  "Healthcare Essentials": illusFirstAid,
  "Baby Care": illusBabyBottle,
  "Personal Care": illusTube,
  "Prescription Medicines": illusPillStrip,
  "Vitamins & Supplements": illusSupplementJar,
  "Diabetes Care": illusDevice,
  "Medical Devices": illusDevice,
};

/* Pick by what the product physically IS (read off the pack size) before
   falling back to its aisle — otherwise a strip of paracetamol ends up drawn
   as a syrup bottle just because it sits in the OTC aisle. */
function productIllustration(category, unit) {
  const u = (unit || "").toLowerCase();

  // "Strip of 15 Tablets" is medicine; "Pack of 20 Strips" is sticking plaster.
  if (/tablet|lozenge|pill/.test(u)) return illusPillStrip();
  if (/capsule/.test(u)) return /bottle|jar/.test(u) ? illusSupplementJar() : illusPillStrip();
  if (/strip/.test(u)) {
    return category === "Healthcare Essentials" ? illusFirstAid() : illusPillStrip();
  }
  if (/tube/.test(u)) return illusTube();
  if (/bar of/.test(u)) return illusTube();
  if (/spray/.test(u)) return illusTube();
  if (/jar/.test(u)) return illusSupplementJar();
  if (/sachet/.test(u)) return illusFirstAid();
  if (/bottle/.test(u)) {
    if (category === "Baby Care") return illusBabyBottle();
    if (category === "Vitamins & Supplements") return illusSupplementJar();
    if (category === "Personal Care") return illusTube();
    return illusSyrupBottle();
  }
  if (/roll|strips\b/.test(u)) return illusFirstAid();

  return (CATEGORY_FALLBACK[category] || illusPillStrip)();
}
