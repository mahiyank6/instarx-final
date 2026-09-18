"""Seeds server/data.json with a starting medicine catalog only.

No live public API exists for real Indian medicine catalogs/pricing, so this
dataset is our own curated stand-in, served through the same /api/medicines
endpoints a real catalog integration would use.

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

MEDICINES = [
    ("Dolo 650mg", "Micro Labs", "Prescription Medicines", 32, 40, "Strip of 15 Tablets", 4.8, 2400, True),
    ("Crocin 650mg", "GSK", "OTC Medicines", 60, 82, "Strip of 15 Tablets", 4.8, 2100, True),
    ("Combiflam", "Sanofi", "Prescription Medicines", 45, 55, "Strip of 20 Tablets", 4.7, 1600, True),
    ("Disprin 325mg", "Reckitt", "OTC Medicines", 42, 60, "Strip of 15 Tablets", 4.7, 1800, True),
    ("Benadryl 25mg", "J&J", "OTC Medicines", 55, 75, "Strip of 20 Tablets", 4.6, 975, True),
    ("Vicks Inhaler", "P&G", "OTC Medicines", 45, 60, "Pack of 1", 4.9, 3200, True),
    ("Vicks Vaporub 50ml", "P&G", "Healthcare Essentials", 110, 135, "Jar of 50ml", 4.8, 2900, False),
    ("ORS Powder", "FDC", "Healthcare Essentials", 25, 30, "Pack of 10 sachets", 4.7, 1400, False),
    ("Volini Gel 50g", "Sun Pharma", "Healthcare Essentials", 140, 165, "Tube of 50g", 4.6, 1900, False),
    ("Betadine Antiseptic 100ml", "Win-Medicare", "Healthcare Essentials", 95, 110, "Bottle of 100ml", 4.7, 1100, False),
    ("Digene Gel", "Abbott", "OTC Medicines", 110, 130, "Bottle of 200ml", 4.5, 890, False),
    ("Eno Regular", "GSK", "OTC Medicines", 18, 22, "Pack of 5 sachets", 4.6, 2600, False),
    ("Moov Pain Relief Spray", "Reckitt", "Healthcare Essentials", 210, 250, "Spray of 65g", 4.5, 780, False),
    ("Dettol Antiseptic Liquid 100ml", "Reckitt", "Personal Care", 65, 78, "Bottle of 100ml", 4.8, 4200, True),
    ("Savlon Soap", "J&J", "Personal Care", 40, 48, "Bar of 100g", 4.6, 1500, False),
    ("Nivea Body Lotion 200ml", "Beiersdorf", "Personal Care", 210, 250, "Bottle of 200ml", 4.5, 2100, False),
    ("Colgate Sensitive Toothpaste", "Colgate", "Personal Care", 95, 110, "Tube of 70g", 4.6, 1650, False),
    ("Johnson's Baby Powder 200g", "J&J", "Baby Care", 165, 190, "Bottle of 200g", 4.8, 3300, True),
    ("Pampers Diapers (M)", "P&G", "Baby Care", 499, 599, "Pack of 34", 4.7, 2700, False),
    ("Johnson's Baby Oil 100ml", "J&J", "Baby Care", 130, 150, "Bottle of 100ml", 4.7, 1900, False),
    ("Cerelac Baby Cereal", "Nestle", "Baby Care", 210, 240, "Pack of 300g", 4.6, 1200, False),
    ("Accu-Chek Glucometer", "Roche", "Diabetes Care", 950, 1200, "Pack of 1", 4.6, 1800, True),
    ("Accu-Chek Test Strips", "Roche", "Diabetes Care", 650, 780, "Pack of 50", 4.5, 1400, False),
    ("Insulin Syringes", "BD", "Diabetes Care", 210, 260, "Pack of 10", 4.6, 900, False),
    ("Sugar Free Gold", "Zydus", "Diabetes Care", 130, 150, "Pack of 100 tablets", 4.5, 1100, False),
    ("Revital H", "Sun Pharma", "Vitamins & Supplements", 480, 550, "Bottle of 30 capsules", 4.7, 2200, True),
    ("Shelcal 500", "Torrent", "Vitamins & Supplements", 140, 165, "Strip of 15 Tablets", 4.6, 1700, False),
    ("Zincovit Tablets", "Apex Labs", "Vitamins & Supplements", 95, 115, "Strip of 15 Tablets", 4.5, 1300, False),
    ("Limcee Vitamin C", "Abbott", "Vitamins & Supplements", 35, 45, "Strip of 15 Tablets", 4.7, 2500, False),
    ("Digital BP Monitor", "Omron", "Medical Devices", 1650, 1999, "Pack of 1", 4.7, 2100, True),
    ("Digital Thermometer", "Dr Trust", "Medical Devices", 199, 250, "Pack of 1", 4.6, 3100, False),
    ("Pulse Oximeter", "Dr Trust", "Medical Devices", 899, 1100, "Pack of 1", 4.6, 2600, False),
    ("Nebulizer Machine", "Omron", "Medical Devices", 2100, 2500, "Pack of 1", 4.5, 640, False),
    ("N95 Mask (Pack of 5)", "Venus", "Medical Devices", 250, 300, "Pack of 5", 4.6, 1900, False),
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
        "next_id": {"user": 1, "order": 1},
    }

    for name, brand, category, price, mrp, unit, rating, rating_count, popular in MEDICINES:
        mid = next_id(data, "medicine")
        data["medicines"].append({
            "id": mid,
            "name": name,
            "brand": brand,
            "category": category,
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
    print(f"Seeded {len(data['medicines'])} medicines. No accounts seeded -")
    print("sign up as a Customer or a Chemist from the website itself.")


if __name__ == "__main__":
    seed()
