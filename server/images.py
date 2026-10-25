"""Fetches real, freely-licensed medicine photography from Wikimedia Commons
and caches the actual image bytes into static/media/ so the site serves them
from our own server.

Why Wikimedia rather than a stock API: Commons is public domain / CC and needs
no API key, and it actually holds real pharmaceutical packshots (blister packs,
syrup bottles, medical devices). Stock photo APIs return lifestyle photography,
not product shots.

Honest limitation: Commons has no photo of a specific Indian brand like
"Dolo 650". We fetch representative real photography per product category and
let the frontend fall back to a drawn SVG illustration where nothing suitable
exists. Nothing here is AI-generated.
"""
import json
import os
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

SERVER_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(os.path.dirname(SERVER_DIR), "static")
MEDIA_DIR = os.path.join(STATIC_DIR, "media")
CACHE_FILE = os.path.join(SERVER_DIR, "images_cache.json")

API = "https://commons.wikimedia.org/w/api.php"
UA = "InstaRX-University-Project/1.0 (educational project; contact via course staff)"

# Several queries per category - Commons results are uneven, so we cast wide
# and filter hard afterwards.
CATEGORY_QUERIES = {
    "Prescription Medicines": ["blister pack tablets", "pharmaceutical tablets packaging", "medicine strip pills"],
    "OTC Medicines": ["medicine bottle pharmacy", "cough syrup bottle", "over the counter medicine box"],
    "Healthcare Essentials": ["first aid supplies", "antiseptic bottle", "adhesive bandage box"],
    "Personal Care": ["soap bar packaging", "shampoo bottle", "toothpaste tube"],
    "Baby Care": ["baby powder bottle", "baby lotion bottle", "infant formula tin"],
    "Diabetes Care": ["blood glucose meter", "glucometer test strips", "insulin syringe"],
    "Vitamins & Supplements": ["vitamin supplement bottle", "multivitamin tablets", "dietary supplement capsules"],
    "Medical Devices": ["blood pressure monitor", "digital thermometer medical", "pulse oximeter"],
}

PER_QUERY = 12
TARGET_PER_CATEGORY = 10
TIMEOUT = 10
RETRIES = 2
WORKERS = 6

# Commons is full of chemical structure diagrams and molecule renders - those
# look nothing like a product, so drop them by filename.
REJECT = re.compile(
    r"(structure|formula|skeletal|molecul|chemical|2d|3d[-_ ]?model|ball[-_ ]and[-_ ]stick"
    r"|spacefill|synthesis|crystal|svg|diagram|chart|graph|logo|map|poster)",
    re.I,
)
ACCEPT_EXT = (".jpg", ".jpeg", ".png")


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _api_get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last = None
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
    raise last


def _search(query):
    """Return candidate (title, thumb_url) pairs for one search phrase."""
    data = _api_get({
        "action": "query",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": 6,          # File: namespace
        "gsrlimit": PER_QUERY,
        "prop": "imageinfo",
        "iiprop": "url|mime",
        "iiurlwidth": 500,          # server-side thumbnail, keeps files small
        "format": "json",
    })
    out = []
    for page in (data.get("query", {}).get("pages", {}) or {}).values():
        title = page.get("title", "")
        info = (page.get("imageinfo") or [{}])[0]
        thumb = info.get("thumburl")
        mime = info.get("mime", "")
        if not thumb or not mime.startswith("image/"):
            continue
        if REJECT.search(title):
            continue
        if not any(thumb.lower().split("?")[0].endswith(e) for e in ACCEPT_EXT):
            continue
        out.append((title, thumb))
    return out


def _download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                blob = r.read()
            if len(blob) < 2000:        # too small to be a usable photo
                return False
            with open(dest, "wb") as f:
                f.write(blob)
            return True
        except Exception:
            continue
    return False


def build_cache():
    os.makedirs(MEDIA_DIR, exist_ok=True)
    cache = {}

    for category, queries in CATEGORY_QUERIES.items():
        slug = _slug(category)
        cat_dir = os.path.join(MEDIA_DIR, slug)
        os.makedirs(cat_dir, exist_ok=True)

        # gather candidates across all queries, de-duplicated by title
        seen, candidates = set(), []
        for q in queries:
            try:
                for title, thumb in _search(q):
                    if title not in seen:
                        seen.add(title)
                        candidates.append(thumb)
            except Exception as e:
                print(f"[images] search failed '{q}': {e}")
        candidates = candidates[: TARGET_PER_CATEGORY * 2]

        saved = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {}
            for i, url in enumerate(candidates):
                dest = os.path.join(cat_dir, f"{i}.jpg")
                futures[pool.submit(_download, url, dest)] = (i, dest)
            for fut in as_completed(futures):
                i, dest = futures[fut]
                try:
                    if fut.result():
                        saved.append((i, f"/media/{slug}/{i}.jpg"))
                except Exception:
                    pass

        saved.sort()
        cache[category] = [p for _, p in saved][:TARGET_PER_CATEGORY]
        print(f"[images] {category}: {len(cache[category])} photos")

    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    return cache


def get_image_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cache = json.load(f)
            ok = all(
                os.path.exists(os.path.join(STATIC_DIR, p.lstrip("/")))
                for paths in cache.values() for p in paths
            )
            if ok:
                return cache
        except Exception:
            pass
    print("[images] Fetching medicine photos from Wikimedia Commons (one-time)...")
    try:
        return build_cache()
    except Exception as e:
        print(f"[images] Fetch failed ({e}); falling back to drawn illustrations.")
        return {}


def pick_image(cache, category, index):
    urls = cache.get(category) or []
    if not urls:
        return None
    return urls[index % len(urls)]


if __name__ == "__main__":
    build_cache()
