"""Seeds server/data.json with the InstaRX medicine catalogue.

No live public API exists for real Indian medicine catalogues/pricing, so this
dataset is our own curated stand-in, served through the same /api/medicines
endpoints a real catalogue integration would use.

Each product carries:
  category  - the shop aisle it lives in (Shop by Category grid)
  concern   - the health concern it treats, powering the Quick Select rail
  rx        - True if it legally needs a prescription (shows an Rx badge)

No demo accounts are seeded - every customer and chemist account is created
through the site's own Sign Up form (see /login.html).
"""
import json
import os

from store import DATA_FILE, next_id

CATEGORIES = [
    "Prescription Medicines",
    "OTC Medicines",
    "Healthcare Essentials",
    "Personal Care",
    "Baby Care",
    "Diabetes Care",
    "Vitamins & Supplements",
    "Medical Devices",
]

CATEGORY_ICONS = {
    "Prescription Medicines": "\U0001F48A",
    "OTC Medicines": "\U0001FA79",
    "Healthcare Essentials": "\U0001F6E1️",
    "Personal Care": "\U0001F9F4",
    "Baby Care": "\U0001F476",
    "Diabetes Care": "\U0001FA78",
    "Vitamins & Supplements": "\U0001F9EA",
    "Medical Devices": "\U0001FA7A",
}

# Quick Select rail - ordered by how often people actually reach for them.
CONCERNS = [
    ("Fever & Pain", "\U0001F321️"),
    ("Cold & Cough", "\U0001F927"),
    ("Stomach Care", "\U0001FAC1"),
    ("First Aid", "\U0001FA79"),
    ("Vitamins", "\U0001F9EA"),
    ("Diabetes", "\U0001FA78"),
    ("Skin & Hair", "\U0001F9F4"),
    ("Baby Care", "\U0001F476"),
]

# name, brand, category, price, mrp, unit, rating, reviews, popular, concern, rx
MEDICINES = [
    # ---------- Fever & Pain ----------
    ("Dolo 650mg", "Micro Labs", "Prescription Medicines", 32, 40, "Strip of 15 Tablets", 4.8, 2400, True, "Fever & Pain", True),
    ("Crocin Advance 500mg", "GSK", "OTC Medicines", 60, 82, "Strip of 15 Tablets", 4.8, 2100, True, "Fever & Pain", False),
    ("Combiflam", "Sanofi", "Prescription Medicines", 45, 55, "Strip of 20 Tablets", 4.7, 1600, True, "Fever & Pain", True),
    ("Disprin 325mg", "Reckitt", "OTC Medicines", 42, 60, "Strip of 15 Tablets", 4.7, 1800, False, "Fever & Pain", False),
    ("Saridon", "Bayer", "OTC Medicines", 35, 42, "Strip of 10 Tablets", 4.6, 1950, False, "Fever & Pain", False),
    ("Paracetamol 500mg", "Cipla", "OTC Medicines", 18, 25, "Strip of 10 Tablets", 4.7, 3100, True, "Fever & Pain", False),
    ("Volini Gel 50g", "Sun Pharma", "Healthcare Essentials", 140, 165, "Tube of 50g", 4.6, 1900, False, "Fever & Pain", False),
    ("Moov Pain Relief Spray", "Reckitt", "Healthcare Essentials", 210, 250, "Spray of 65g", 4.5, 780, False, "Fever & Pain", False),
    ("Meftal Spas", "Blue Cross", "Prescription Medicines", 38, 48, "Strip of 10 Tablets", 4.5, 1250, False, "Fever & Pain", True),

    # ---------- Cold & Cough ----------
    ("Vicks Inhaler", "P&G", "OTC Medicines", 45, 60, "Pack of 1", 4.9, 3200, True, "Cold & Cough", False),
    ("Vicks VapoRub 50ml", "P&G", "Healthcare Essentials", 110, 135, "Jar of 50ml", 4.8, 2900, True, "Cold & Cough", False),
    ("Benadryl Cough Syrup", "J&J", "OTC Medicines", 125, 150, "Bottle of 100ml", 4.6, 975, False, "Cold & Cough", False),
    ("Strepsils Honey Lemon", "Reckitt", "OTC Medicines", 48, 55, "Pack of 8 Lozenges", 4.7, 2250, False, "Cold & Cough", False),
    ("Otrivin Nasal Spray", "GSK", "OTC Medicines", 92, 110, "Bottle of 10ml", 4.6, 1420, False, "Cold & Cough", False),
    ("Honitus Cough Syrup", "Dabur", "OTC Medicines", 105, 125, "Bottle of 100ml", 4.5, 1180, False, "Cold & Cough", False),
    ("Cetirizine 10mg", "Cipla", "OTC Medicines", 22, 30, "Strip of 10 Tablets", 4.6, 2050, False, "Cold & Cough", False),

    # ---------- Stomach Care ----------
    ("Digene Gel Mint", "Abbott", "OTC Medicines", 110, 130, "Bottle of 200ml", 4.5, 890, False, "Stomach Care", False),
    ("Eno Fruit Salt", "GSK", "OTC Medicines", 18, 22, "Pack of 5 Sachets", 4.6, 2600, True, "Stomach Care", False),
    ("Gelusil MPS", "Pfizer", "OTC Medicines", 95, 115, "Bottle of 200ml", 4.5, 760, False, "Stomach Care", False),
    ("Pudin Hara Pearls", "Dabur", "OTC Medicines", 42, 50, "Pack of 10 Capsules", 4.6, 1540, False, "Stomach Care", False),
    ("ORS Orange Powder", "FDC", "Healthcare Essentials", 25, 30, "Pack of 10 Sachets", 4.7, 1400, True, "Stomach Care", False),
    ("Isabgol Husk 100g", "Dabur", "Healthcare Essentials", 165, 195, "Pack of 100g", 4.5, 980, False, "Stomach Care", False),
    ("Pan 40mg", "Alkem", "Prescription Medicines", 135, 160, "Strip of 15 Tablets", 4.6, 1680, False, "Stomach Care", True),

    # ---------- First Aid ----------
    ("Dettol Antiseptic Liquid 100ml", "Reckitt", "Personal Care", 65, 78, "Bottle of 100ml", 4.8, 4200, True, "First Aid", False),
    ("Betadine Antiseptic 100ml", "Win-Medicare", "Healthcare Essentials", 95, 110, "Bottle of 100ml", 4.7, 1100, False, "First Aid", False),
    ("Band-Aid Washproof", "J&J", "Healthcare Essentials", 85, 100, "Pack of 20 Strips", 4.7, 2400, True, "First Aid", False),
    ("Cotton Roll 100g", "Medigrade", "Healthcare Essentials", 55, 70, "Roll of 100g", 4.5, 860, False, "First Aid", False),
    ("Soframycin Skin Cream", "Sanofi", "Healthcare Essentials", 48, 58, "Tube of 30g", 4.6, 1320, False, "First Aid", False),
    ("Burnol Cream", "Dr Morepen", "Healthcare Essentials", 62, 75, "Tube of 20g", 4.5, 940, False, "First Aid", False),
    ("Crepe Bandage 10cm", "Medigrade", "Healthcare Essentials", 110, 135, "Pack of 1", 4.4, 520, False, "First Aid", False),

    # ---------- Vitamins ----------
    ("Revital H", "Sun Pharma", "Vitamins & Supplements", 480, 550, "Bottle of 30 Capsules", 4.7, 2200, True, "Vitamins", False),
    ("Shelcal 500", "Torrent", "Vitamins & Supplements", 140, 165, "Strip of 15 Tablets", 4.6, 1700, True, "Vitamins", False),
    ("Zincovit Tablets", "Apex Labs", "Vitamins & Supplements", 95, 115, "Strip of 15 Tablets", 4.5, 1300, False, "Vitamins", False),
    ("Limcee Vitamin C 500mg", "Abbott", "Vitamins & Supplements", 35, 45, "Strip of 15 Tablets", 4.7, 2500, True, "Vitamins", False),
    ("Supradyn Daily", "Bayer", "Vitamins & Supplements", 155, 180, "Strip of 15 Tablets", 4.7, 1890, False, "Vitamins", False),
    ("Evion 400mg", "Merck", "Vitamins & Supplements", 68, 82, "Strip of 10 Capsules", 4.6, 2140, False, "Vitamins", False),
    ("Becosules Capsules", "Pfizer", "Vitamins & Supplements", 52, 62, "Strip of 20 Capsules", 4.6, 1760, False, "Vitamins", False),
    ("A to Z Multivitamin", "Alkem", "Vitamins & Supplements", 118, 140, "Strip of 15 Tablets", 4.5, 1230, False, "Vitamins", False),

    # ---------- Diabetes ----------
    ("Accu-Chek Active Glucometer", "Roche", "Diabetes Care", 950, 1200, "Pack of 1", 4.6, 1800, True, "Diabetes", False),
    ("Accu-Chek Test Strips", "Roche", "Diabetes Care", 650, 780, "Pack of 50 Strips", 4.5, 1400, True, "Diabetes", False),
    ("Dr Morepen Glucometer", "Dr Morepen", "Diabetes Care", 699, 899, "Pack of 1", 4.4, 1120, False, "Diabetes", False),
    ("Insulin Syringes", "BD", "Diabetes Care", 210, 260, "Pack of 10", 4.6, 900, False, "Diabetes", False),
    ("Sugar Free Gold", "Zydus", "Diabetes Care", 130, 150, "Pack of 100 Tablets", 4.5, 1100, False, "Diabetes", False),
    ("Glucon-D Original 400g", "Zydus", "Healthcare Essentials", 125, 145, "Pack of 400g", 4.6, 1950, False, "Diabetes", False),

    # ---------- Skin & Hair ----------
    ("Savlon Soap", "ITC", "Personal Care", 40, 48, "Bar of 100g", 4.6, 1500, False, "Skin & Hair", False),
    ("Nivea Body Lotion 200ml", "Beiersdorf", "Personal Care", 210, 250, "Bottle of 200ml", 4.5, 2100, False, "Skin & Hair", False),
    ("Colgate Sensitive Toothpaste", "Colgate", "Personal Care", 95, 110, "Tube of 70g", 4.6, 1650, False, "Skin & Hair", False),
    ("Boroline Antiseptic Cream", "GD Pharma", "Personal Care", 45, 55, "Tube of 20g", 4.7, 2780, True, "Skin & Hair", False),
    ("Himalaya Neem Face Wash", "Himalaya", "Personal Care", 145, 170, "Tube of 100ml", 4.6, 3200, False, "Skin & Hair", False),
    ("Clinic Plus Shampoo 175ml", "HUL", "Personal Care", 99, 120, "Bottle of 175ml", 4.4, 2450, False, "Skin & Hair", False),
    ("Dettol Handwash 200ml", "Reckitt", "Personal Care", 78, 95, "Bottle of 200ml", 4.7, 3650, False, "Skin & Hair", False),

    # ---------- Baby Care ----------
    ("Johnson's Baby Powder 200g", "J&J", "Baby Care", 165, 190, "Bottle of 200g", 4.8, 3300, True, "Baby Care", False),
    ("Pampers Diapers (M)", "P&G", "Baby Care", 499, 599, "Pack of 34", 4.7, 2700, True, "Baby Care", False),
    ("Johnson's Baby Oil 100ml", "J&J", "Baby Care", 130, 150, "Bottle of 100ml", 4.7, 1900, False, "Baby Care", False),
    ("Cerelac Baby Cereal", "Nestle", "Baby Care", 210, 240, "Pack of 300g", 4.6, 1200, False, "Baby Care", False),
    ("Himalaya Baby Lotion", "Himalaya", "Baby Care", 175, 205, "Bottle of 200ml", 4.6, 1480, False, "Baby Care", False),
    ("Dexolac Infant Formula", "Danone", "Baby Care", 385, 440, "Pack of 400g", 4.4, 760, False, "Baby Care", False),

    # ---------- Medical Devices ----------
    ("Omron Digital BP Monitor", "Omron", "Medical Devices", 1650, 1999, "Pack of 1", 4.7, 2100, True, None, False),
    ("Digital Thermometer", "Dr Trust", "Medical Devices", 199, 250, "Pack of 1", 4.6, 3100, True, None, False),
    ("Pulse Oximeter", "Dr Trust", "Medical Devices", 899, 1100, "Pack of 1", 4.6, 2600, False, None, False),
    ("Nebulizer Machine", "Omron", "Medical Devices", 2100, 2500, "Pack of 1", 4.5, 640, False, None, False),
    ("N95 Mask (Pack of 5)", "Venus", "Medical Devices", 250, 300, "Pack of 5", 4.6, 1900, False, None, False),
    ("Digital Weighing Scale", "Dr Trust", "Medical Devices", 1250, 1550, "Pack of 1", 4.4, 880, False, None, False),
    ("Hot Water Bag", "Dr Morepen", "Medical Devices", 285, 350, "Pack of 1", 4.3, 610, False, None, False),
]


def seed():
    if os.path.exists(DATA_FILE):
        print("data.json already exists, skipping seed (delete it to reseed).")
        return

    data = {
        "users": [],
        "chemists": [],
        "medicines": [],
        "orders": [],
        "carts": {},
        "rx_requests": [],
        "next_id": {"user": 1, "order": 1, "rx": 1},
    }

    for (name, brand, category, price, mrp, unit, rating,
         rating_count, popular, concern, rx) in MEDICINES:
        mid = next_id(data, "medicine")
        data["medicines"].append({
            "id": mid,
            "name": name,
            "brand": brand,
            "category": category,
            "concern": concern,
            "rx": rx,
            "price": price,
            "mrp": mrp,
            "discount_pct": round((1 - price / mrp) * 100),
            "unit": unit,
            "rating": rating,
            "rating_count": rating_count,
            "popular": popular,
            "icon": CATEGORY_ICONS.get(category, "\U0001F48A"),
            "stock": True,
        })

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Seeded {len(data['medicines'])} medicines across {len(CATEGORIES)} categories")
    print(f"and {len(CONCERNS)} Quick Select concerns. No accounts seeded -")
    print("sign up as a Customer or a Chemist from the website itself.")


if __name__ == "__main__":
    seed()
