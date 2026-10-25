"""Simple JSON-file data store for the InstaRX university project.

Not meant for production concurrency -- a threading.Lock keeps writes from
a handful of local demo clients from clobbering each other.
"""
import json
import os
import threading
import time
import math

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")
_lock = threading.Lock()

_DEFAULT = {
    "users": [],
    "chemists": [],
    "medicines": [],
    "orders": [],
    "carts": {},
    "rx_requests": [],
    "next_id": {"user": 1, "order": 1, "rx": 1}
}


def _load():
    if not os.path.exists(DATA_FILE):
        return json.loads(json.dumps(_DEFAULT))
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Files written before a collection existed (e.g. rx_requests) get it
    # added empty instead of crashing on a missing key.
    for key, default in _DEFAULT.items():
        if key not in data:
            data[key] = json.loads(json.dumps(default))
    return data


def _save(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, DATA_FILE)


def read():
    with _lock:
        return _load()


def write(mutator):
    """mutator(data) -> mutates data in place; returns whatever mutator returns."""
    with _lock:
        data = _load()
        result = mutator(data)
        _save(data)
        return result


def next_id(data, kind):
    nid = data["next_id"].get(kind, 1)
    data["next_id"][kind] = nid + 1
    return nid


def now():
    return int(time.time())


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
