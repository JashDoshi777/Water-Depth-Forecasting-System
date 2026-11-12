"""Build app/data/waterbodies_india.geojson: real, named Indian lakes & reservoirs.

Sources (all free / no key):
  * OpenStreetMap via Overpass API (ODbL): named water=reservoir / landuse=reservoir / water=lake /
    waterway=dam objects in lat 6-36, lon 68-98 (centre + bounding box only).
  * Natural Earth 10m lakes (public domain): outlines for the larger lakes/reservoirs.
State = point-in-polygon against app/data/india_states.geojson (Natural Earth admin-1); bodies outside India are dropped.
area_km2 is the Natural Earth polygon area where an outline exists, otherwise an ESTIMATE (0.5 x OSM bounding-box area).
mean_depth_m is only set for a short curated list (approximate literature values); otherwise null (depth_source='unknown').

Run: backend/venv/bin/python backend/scripts/build_waterbodies.py   (needs `pip install shapely`)
"""
import json, math, os, re, sys, time
import httpx
from shapely.geometry import shape, Point, mapping
from shapely.strtree import STRtree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from app.services.digipin_codec import encode  # noqa: E402

CACHE = os.path.join(ROOT, "data_cache")
OUT = os.path.join(ROOT, "app", "data", "waterbodies_india.geojson")
UA = {"User-Agent": "AquaDepth/1.0 (research)"}
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
QUERY = """[out:json][timeout:240];
(
 nwr["water"="reservoir"]["name"](6,68,36,98);
 nwr["landuse"="reservoir"]["name"](6,68,36,98);
 nwr["natural"="water"]["water"="lake"]["name"](6,68,36,98);
 nwr["waterway"="dam"]["name"](6,68,36,98);
);
out center bb tags;"""

# Curated approximate mean depths (m) from published limnology summaries; indicative only.
MEAN_DEPTH = {"chilika": 1.7, "pulicat": 1.5, "sambhar": 0.6, "dal": 1.4, "wular": 3.0, "loktak": 2.7,
              "naini": 18.5, "hussain sagar": 5.0, "upper lake": 6.0, "pangong": 100.0, "lonar": 50.0,
              "vembanad": 3.0, "kolleru": 1.5, "sasthamkotta": 6.0, "ashtamudi": 6.4}


SEEDS = [  # well-known bodies (name, lat, lon, kind, state) added when OSM/NE did not already yield a body within 40 km
    ('Chilika Lake', 19.72, 85.32, 'lake', 'Odisha'),
    ('Vembanad Lake', 9.59, 76.38, 'lake', 'Kerala'),
    ('Pulicat Lake', 13.58, 80.17, 'lake', 'Tamil Nadu'),
    ('Kolleru Lake', 16.58, 81.2, 'lake', 'Andhra Pradesh'),
    ('Dal Lake', 34.09, 74.86, 'lake', 'J&K'),
    ('Wular Lake', 34.36, 74.59, 'lake', 'J&K'),
    ('Loktak Lake', 24.53, 93.8, 'lake', 'Manipur'),
    ('Sambhar Lake', 26.95, 75.05, 'lake', 'Rajasthan'),
    ('Pangong Lake', 33.76, 78.65, 'lake', 'Ladakh'),
    ('Tsomoriri Lake', 32.9, 78.32, 'lake', 'Ladakh'),
    ('Hussain Sagar', 17.44, 78.48, 'lake', 'Telangana'),
    ('Naini Lake', 29.39, 79.47, 'lake', 'Uttarakhand'),
    ('Bhimtal', 29.35, 79.56, 'lake', 'Uttarakhand'),
    ('Lonar Lake', 19.98, 76.51, 'lake', 'Maharashtra'),
    ('Pichola Lake', 24.57, 73.68, 'lake', 'Rajasthan'),
    ('Fateh Sagar', 24.6, 73.67, 'lake', 'Rajasthan'),
    ('Ashtamudi Lake', 8.95, 76.58, 'lake', 'Kerala'),
    ('Sasthamkotta Lake', 9.05, 76.62, 'lake', 'Kerala'),
    ('Nal Sarovar', 22.78, 72.02, 'lake', 'Gujarat'),
    ('Upper Lake Bhopal', 23.23, 77.33, 'lake', 'Madhya Pradesh'),
    ('Sardar Sarovar', 21.83, 73.75, 'reservoir', 'Gujarat'),
    ('Hirakud', 21.52, 83.87, 'reservoir', 'Odisha'),
    ('Nagarjuna Sagar', 16.57, 79.31, 'reservoir', 'Telangana'),
    ('Bhakra Nangal', 31.41, 76.43, 'reservoir', 'Himachal Pradesh'),
    ('Tehri Dam', 30.38, 78.48, 'reservoir', 'Uttarakhand'),
    ('Tungabhadra Dam', 15.27, 76.33, 'reservoir', 'Karnataka'),
    ('Rihand Dam', 24.2, 83.01, 'reservoir', 'Uttar Pradesh'),
    ('Srisailam', 15.85, 78.87, 'reservoir', 'Telangana'),
    ('Koyna', 17.4, 73.75, 'reservoir', 'Maharashtra'),
    ('Mettur Dam', 11.8, 77.8, 'reservoir', 'Tamil Nadu'),
    ('Indira Sagar', 22.28, 76.48, 'reservoir', 'Madhya Pradesh'),
    ('Almatti Dam', 16.33, 75.88, 'reservoir', 'Karnataka'),
    ('Jayakwadi Dam', 19.5, 75.38, 'reservoir', 'Maharashtra'),
    ('Ukai Dam', 21.25, 73.6, 'reservoir', 'Gujarat'),
    ('Stanley Reservoir', 11.61, 77.96, 'reservoir', 'Tamil Nadu'),
    ('Krishnarajasagar', 12.42, 76.57, 'reservoir', 'Karnataka'),
    ('Pong Dam', 31.97, 76.05, 'reservoir', 'Himachal Pradesh'),
    ('Govind Ballabh Pant Sagar', 24.15, 83.12, 'reservoir', 'Uttar Pradesh'),
    ('Gandhisagar Dam', 24.72, 75.58, 'reservoir', 'Madhya Pradesh'),
    ('Bargi Dam', 23.1, 79.95, 'reservoir', 'Madhya Pradesh'),
    ('Bhavanisagar', 11.48, 77.1, 'reservoir', 'Tamil Nadu'),
    ('Idukki Dam', 9.84, 76.97, 'reservoir', 'Kerala'),
    ('Mullaperiyar Dam', 9.53, 77.13, 'reservoir', 'Kerala'),
    ('Panchet Dam', 23.67, 86.75, 'reservoir', 'Jharkhand'),
    ('Maithon Dam', 23.78, 86.82, 'reservoir', 'Jharkhand'),
    ('Ranjit Sagar', 32.47, 75.73, 'reservoir', 'Punjab'),
    ('Lower Manair Dam', 18.15, 79.57, 'reservoir', 'Telangana'),
    ('Ujjani Dam', 18.05, 75.12, 'reservoir', 'Maharashtra'),
    ('Mahi Bajaj Sagar', 23.65, 74.08, 'reservoir', 'Rajasthan'),
    ('Rana Pratap Sagar', 24.92, 75.58, 'reservoir', 'Rajasthan'),
]


def fetch(url, dest, method="GET", data=None, tries=4):
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return
    os.makedirs(CACHE, exist_ok=True)
    for i in range(tries):
        try:
            r = httpx.request(method, url, headers=UA, data=data, timeout=300, follow_redirects=True)
            r.raise_for_status()
            open(dest, "wb").write(r.content)
            return
        except Exception as e:
            print("retry", url, e); time.sleep(8 * (i + 1))
    raise RuntimeError("download failed " + url)


def fetch_overpass(dest):
    for url in OVERPASS * 2:
        try:
            fetch(url, dest, "POST", {"data": QUERY}, tries=1)
            return
        except RuntimeError:
            pass
    raise RuntimeError("Overpass unavailable")


def km2(geom):
    lat = geom.centroid.y
    return geom.area * 111.32 * 111.32 * math.cos(math.radians(lat))


def clean_name(t):
    n = t.get("name:en") or t.get("int_name") or t.get("name") or ""
    n = n.strip()
    return n if n and re.fullmatch(r"[\x20-\x7eÀ-ɏ]+", n) else ""


def heuristic_depth(kind, area):
    a = area or 1.0
    if kind == "reservoir":
        return round(min(60.0, max(8.0, 12 + 4 * math.log(1 + a))), 1)
    return round(min(15.0, max(1.5, 1.5 + 0.9 * math.log(1 + a))), 1)


def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def main():
    ne_path, op_path = os.path.join(CACHE, "ne_lakes.geojson"), os.path.join(CACHE, "overpass_bb.json")
    fetch(NE_URL, ne_path)
    fetch_overpass(op_path)
    states = [(shape(f["geometry"]), f["properties"]["name"]) for f in json.load(open(os.path.join(ROOT, "app/data/india_states.geojson")))["features"]]
    tree = STRtree([s[0] for s in states])

    def state_of(lon, lat):
        p = Point(lon, lat)
        for i in tree.query(p):
            if states[i][0].contains(p):
                return states[i][1]
        return None

    cands = []
    for e in json.load(open(op_path))["elements"]:
        t = e["tags"]; name = clean_name(t)
        if not name: continue
        b = e.get("bounds")
        c = e.get("center") or ({"lat": e["lat"], "lon": e["lon"]} if "lat" in e else
                                ({"lat": (b["minlat"] + b["maxlat"]) / 2, "lon": (b["minlon"] + b["maxlon"]) / 2} if b else None))
        if not c: continue
        st = state_of(c["lon"], c["lat"])
        if not st: continue
        dam = t.get("waterway") == "dam" and not (t.get("water") or t.get("landuse") == "reservoir")
        kind = "reservoir" if (dam or t.get("water") == "reservoir" or t.get("landuse") == "reservoir") else "lake"
        area = None
        if b and not dam:
            w, h = b["maxlon"] - b["minlon"], b["maxlat"] - b["minlat"]
            area = 0.5 * w * h * 111.32 * 111.32 * math.cos(math.radians(c["lat"]))
        cands.append({"name": name, "kind": kind, "dam": dam, "lat": c["lat"], "lon": c["lon"], "state": st,
                      "area": area, "wd": "wikidata" in t, "osm": f'{e["type"][0]}{e["id"]}'})
    print("osm candidates in India:", len(cands))
    # significance filter (drops ponds / tanks)
    cands = [c for c in cands if c["dam"] or c["wd"] or (c["area"] or 0) >= (0.8 if c["kind"] == "lake" else 0.4)]
    # dedupe: same name within 10 km, or dam near a water body -> keep the one with outline-ish info
    cands.sort(key=lambda c: (c["dam"], not c["wd"], -(c["area"] or 0)))
    kept = []
    for c in cands:
        dup = False
        for k in kept:
            d = hav((c["lat"], c["lon"]), (k["lat"], k["lon"]))
            if d < 10 and (c["name"].lower() == k["name"].lower() or (c["dam"] and not k["dam"]) or
                           (c["dam"] and k["dam"] and c["name"].lower().replace(" dam", "") == k["name"].lower().replace(" dam", ""))):
                dup = True; break
            if d < 1.0 and c["dam"] is False and k["dam"] is False:
                dup = True; break
        if not dup:
            kept.append(c)
    print("after filtering/dedupe:", len(kept))

    for n, la, lo, k, reg in SEEDS:
        low = n.lower().split()[0]
        st = state_of(lo, la) or reg
        if any(low in b["name"].lower() or hav((la, lo), (b["lat"], b["lon"])) < 3 for b in kept
               if hav((la, lo), (b["lat"], b["lon"])) < 40):
            continue
        kept.append({"name": n, "kind": k, "dam": False, "lat": la, "lon": lo, "state": st, "area": None,
                     "wd": True, "osm": None})
    # Natural Earth outlines
    ne = []
    for f in json.load(open(ne_path))["features"]:
        g = shape(f["geometry"])
        c = g.representative_point()
        st = state_of(c.x, c.y)
        if not st: continue
        p = f["properties"]
        ne.append({"geom": g, "name": (p.get("name_en") or p.get("name") or "").strip(), "state": st,
                   "reservoir": bool(p.get("dam_name")) or p.get("featurecla") == "Reservoir", "lat": c.y, "lon": c.x})
    print("NE lakes in India:", len(ne))
    used = set()
    for n in ne:
        match = None
        for i, k in enumerate(kept):
            if i in used: continue
            inside = n["geom"].buffer(0.02).contains(Point(k["lon"], k["lat"]))
            same = n["name"].lower() and n["name"].lower() in k["name"].lower() or k["name"].lower() in n["name"].lower()
            if (inside and not k["dam"]) or (same and hav((n["lat"], n["lon"]), (k["lat"], k["lon"])) < 60):
                match = i; break
        if match is not None:
            used.add(match); kept[match]["geom"] = n["geom"]
            kept[match]["kind"] = "reservoir" if n["reservoir"] or kept[match]["kind"] == "reservoir" else "lake"
        else:
            kept.append({"name": n["name"] or "Unnamed lake", "kind": "reservoir" if n["reservoir"] else "lake", "dam": False,
                         "lat": n["lat"], "lon": n["lon"], "state": n["state"], "area": None, "wd": False, "osm": None, "geom": n["geom"]})
    feats = []
    seen_ids = set()
    for c in sorted(kept, key=lambda c: (c["state"], c["name"])):
        if c["name"] == "Unnamed lake": continue
        g = c.get("geom")
        area = round(km2(g), 2) if g is not None else (round(c["area"], 2) if c["area"] else None)
        low = c["name"].lower()
        md = next((v for k, v in MEAN_DEPTH.items() if k in low), None)
        slug = re.sub(r"[^a-z0-9]+", "-", low).strip("-") or "wb"
        bid = f'{slug}-{c["state"][:2].lower()}'
        n = 2
        while bid in seen_ids:
            bid = f'{slug}-{c["state"][:2].lower()}{n}'; n += 1
        seen_ids.add(bid)
        lat, lon = round(c["lat"], 5), round(c["lon"], 5)
        props = {"id": bid, "name": c["name"], "kind": c["kind"], "state": c["state"], "area_km2": area,
                 "area_source": "natural_earth_polygon" if g is not None else ("osm_bbox_estimate" if area else None),
                 "mean_depth_m": md, "depth_source": "literature_approx" if md else "unknown",
                 "lat": lat, "lon": lon, "digipin": encode(lat, lon), "has_outline": g is not None,
                 "osm": c["osm"], "is_dam_point": bool(c["dam"])}
        if g is not None:
            gs = g.simplify(0.002, preserve_topology=True)
            geom = mapping(gs)
            geom = json.loads(json.dumps(geom), parse_float=lambda x: round(float(x), 4))
        else:
            geom = {"type": "Point", "coordinates": [lon, lat]}
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
    meta = {"source": "OpenStreetMap contributors (ODbL, via Overpass) + Natural Earth 10m lakes (public domain)",
            "note": "Outlines only for larger lakes/reservoirs (Natural Earth); others are points. area_km2 for non-outline bodies "
                    "is an estimate from OSM bounding boxes. mean_depth_m is null unless a curated approximate value exists.",
            "built": time.strftime("%Y-%m-%d")}
    json.dump({"type": "FeatureCollection", "meta": meta, "features": feats}, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(len(feats), "features,", os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
