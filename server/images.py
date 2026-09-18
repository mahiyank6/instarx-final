"""Fetches real, freely-licensed product photos from Openverse (api.openverse.org) —
a free, keyless search API over Creative Commons / public-domain images — and
downloads the actual image bytes ONCE into static/media/, so the site serves
them from our own server afterwards instead of hotlinking Openverse on every
page load (hotlinking was unreliable: dozens of simultaneous cross-origin
requests to the same external host left many thumbnails stuck pending).

No free live API exists that returns exact-brand product photography (Crocin,
Dolo, etc.) or 3D renders, so this fetches representative real photos per
category instead (real tablets, real thermometers, real BP monitors...).
"""
import json
import os
import re
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

SERVER_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(os.path.dirname(SERVER_DIR), "static")
MEDIA_DIR = os.path.join(STATIC_DIR, "media")
CACHE_FILE = os.path.join(SERVER_DIR, "images_cache.json")

CATEGORY_QUERIES = {
    "Prescription Medicines": "pills tablets medicine",
    "OTC Medicines": "medicine bottle pharmacy",
    "Healthcare Essentials": "first aid bandage",
    "Personal Care": "toiletries bottle",
    "Baby Care": "baby powder bottle",
    "Diabetes Care": "glucose meter",
    "Vitamins & Supplements": "vitamin supplement capsules",
    "Medical Devices": "medical device",
}

RESULTS_PER_CATEGORY = 14
SEARCH_TIMEOUT_SECONDS = 8
DOWNLOAD_TIMEOUT_SECONDS = 6
RETRIES = 2
MAX_WORKERS = 8


def _slug(category):
    return re.sub(r"[^a-z0-9]+", "-", category.lower()).strip("-")


def _search_category_images(query):
    params = urllib.parse.urlencode({"q": query, "page_size": RESULTS_PER_CATEGORY, "mature": "false"})
    url = f"https://api.openverse.org/v1/images/?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "InstaRX-University-Project/1.0"})
    last_error = None
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=SEARCH_TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return [r["thumbnail"] for r in data.get("results", []) if r.get("thumbnail")]
        except Exception as e:
            last_error = e
    raise last_error


def _download_one(url, dest_path):
    req = urllib.request.Request(url, headers={"User-Agent": "InstaRX-University-Project/1.0"})
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_SECONDS) as resp:
                content = resp.read()
            with open(dest_path, "wb") as f:
                f.write(content)
            return True
        except Exception:
            continue
    return False


def build_cache():
    os.makedirs(MEDIA_DIR, exist_ok=True)
    cache = {}
    for category, query in CATEGORY_QUERIES.items():
        slug = _slug(category)
        cat_dir = os.path.join(MEDIA_DIR, slug)
        os.makedirs(cat_dir, exist_ok=True)
        try:
            urls = _search_category_images(query)
        except Exception as e:
            print(f"[images] Couldn't search photos for '{category}': {e}")
            cache[category] = []
            continue

        local_paths = [None] * len(urls)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            future_to_index = {}
            for i, url in enumerate(urls):
                dest = os.path.join(cat_dir, f"{i}.jpg")
                future_to_index[pool.submit(_download_one, url, dest)] = (i, dest)
            for future in as_completed(future_to_index):
                i, dest = future_to_index[future]
                if future.result():
                    local_paths[i] = f"/media/{slug}/{i}.jpg"

        cache[category] = [p for p in local_paths if p]
        print(f"[images] {category}: downloaded {len(cache[category])}/{len(urls)} photos")

    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    return cache


def get_image_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cache = json.load(f)
            # sanity-check the referenced files still exist locally; rebuild if not
            if all(os.path.exists(os.path.join(STATIC_DIR, p.lstrip("/"))) for urls in cache.values() for p in urls):
                return cache
        except Exception:
            pass
    print("[images] Downloading real product photos from Openverse (one-time, needs internet)...")
    return build_cache()


def pick_image(cache, category, index):
    urls = cache.get(category) or []
    if not urls:
        return None
    return urls[index % len(urls)]
