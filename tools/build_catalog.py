#!/usr/bin/env python3
"""Bouw publieke kaartdata, organisatiecatalogus en uitzonderingenlijst."""
from __future__ import annotations
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "inventory.json"
EXTRA = ROOT / "inventory.extra.json"
BASE = ROOT / "local-backend" / "facilities.base.json"
DATA = ROOT / "data"
GENERIC = re.compile(r"^(sociale kaart|gemeente|regio|bron|voorzieningen|samen twente)", re.I)

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def normalized(text):
    value = unicodedata.normalize("NFD", (text or "").casefold())
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()

def org_name(v):
    name = (v.get("name") or "").strip()
    if " · " in name:
        return name.split(" · ", 1)[0].strip()
    source_title = (v.get("sourceTitle") or "").strip()
    if source_title and not GENERIC.search(source_title) and v.get("sourceKind") in {"first-party", "provider", "regional"}:
        return source_title
    return name or source_title or "Onbekend"

def has_location(v):
    return bool(v.get("address") and v.get("town") and isinstance(v.get("lat"), (int, float)) and isinstance(v.get("lon"), (int, float)))

def review_status(v):
    if v.get("status") == "published" or v.get("accessStatus") == "confirmed":
        return "manual"
    if not v.get("source") or not v.get("name") or not (v.get("municipality") or v.get("municipalities")):
        return "review-needed"
    if (v.get("enrichment") or {}).get("categoryConflict"):
        return "review-needed"
    if not has_location(v):
        return "review-needed"
    return "source-backed"

def stable_id(text):
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xffffffff
    norm = unicodedata.normalize("NFD", text.lower())
    norm = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    base = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")[:46] or "organisatie"
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    n = h
    tail = "0" if n == 0 else ""
    while n:
        n, r = divmod(n, 36)
        tail = alphabet[r] + tail
    return f"org-{base}-{tail}"

def map_location_type(item):
    explicit = item.get("mapLocationType") or ""
    if explicit == "service-area":
        return explicit
    lat, lon = item.get("lat"), item.get("lon")
    services = item.get("municipalities") or ([item.get("municipality")] if item.get("municipality") else [])
    location_municipality = item.get("locationMunicipality") or ""
    if services and location_municipality and location_municipality not in services:
        return "service-area"
    # Ruime bbox rond Twente: externe landelijke/provinciale kantoren nooit als pin buiten de regio tonen.
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        if not (51.95 <= lat <= 52.58 and 6.25 <= lon <= 7.25):
            return "service-area"
    return "address"

def pick_location(offers):
    priority = {"service": 0, "visiting": 0, "existing": 1, "source-address": 2, "contact": 3}
    options = [o for o in offers if has_location(o)]
    if not options:
        return None
    options.sort(key=lambda o: (
        priority.get(o.get("locationType") or "", 5),
        0 if o.get("postcode") else 1,
        o.get("address") or "",
    ))
    o = options[0]
    return {
        "address": o.get("address") or "",
        "postcode": o.get("postcode") or "",
        "town": o.get("town") or "",
        "lat": o.get("lat"),
        "lon": o.get("lon"),
        "locationMunicipality": o.get("locationMunicipality") or o.get("municipality") or "",
        "locationType": o.get("locationType") or "contact",
        "locationSource": o.get("locationSource") or o.get("source") or "",
        "mapLocationType": map_location_type(o),
    }

def base_represents(group, facilities):
    org = normalized(group["organization"])
    sources = set(group.get("sources") or [])
    for facility in facilities:
        if facility.get("source") and facility.get("source") in sources:
            return True
        name = normalized(facility.get("name") or "")
        if org and name and len(org) >= 4 and (name.startswith(org) or org.startswith(name)):
            return True
    return False

def main():
    inv = load(INVENTORY)
    extra = load(EXTRA) if EXTRA.exists() else {"checked": "", "sources": [], "candidates": []}
    inv.setdefault("candidates", []).extend(extra.get("candidates", []))
    known_sources = {s.get("url") for s in inv.get("sources", []) if s.get("url")}
    inv.setdefault("sources", []).extend(s for s in extra.get("sources", []) if s.get("url") not in known_sources)
    if str(extra.get("checked") or "") > str(inv.get("checked") or ""):
        inv["checked"] = extra.get("checked")
    base_facilities = load(BASE)
    groups = {}
    review = []

    for v in inv.get("candidates", []):
        org = org_name(v)
        key = org.casefold()
        g = groups.setdefault(key, {
            "id": stable_id(org), "organization": org, "municipalities": [], "categories": [],
            "sources": [], "offerCount": 0, "reviewNeeded": 0, "sourceBacked": 0, "manual": 0,
            "checked": v.get("checked") or inv.get("checked") or "", "offers": []
        })

        municipalities = v.get("municipalities") or ([v.get("municipality")] if v.get("municipality") else [])
        for municipality in municipalities:
            if municipality and municipality not in g["municipalities"]:
                g["municipalities"].append(municipality)
        for category in [*(v.get("themes") or []), v.get("category")]:
            if category and category not in g["categories"]:
                g["categories"].append(category)
        if v.get("source") and v["source"] not in g["sources"]:
            g["sources"].append(v["source"])

        status = review_status(v)
        if status == "review-needed":
            g["reviewNeeded"] += 1
            if not v.get("source"):
                reason = "Bron ontbreekt"
            elif (v.get("enrichment") or {}).get("categoryConflict"):
                reason = "Categorie uit bron en automatische indeling spreken elkaar tegen"
            elif not has_location(v):
                reason = "Adres of kaartcoördinaten ontbreken"
            else:
                reason = "Kerngegevens ontbreken"
            review.append({
                "id": v.get("id"), "name": v.get("name"), "municipality": v.get("municipality") or "",
                "source": v.get("source") or "", "sourceTitle": v.get("sourceTitle") or "",
                "reason": reason, "checked": v.get("checked") or inv.get("checked") or ""
            })
        elif status == "manual":
            g["manual"] += 1
        else:
            g["sourceBacked"] += 1

        title = (v.get("name") or "").strip()
        prefix = org + " · "
        if title.startswith(prefix):
            title = title[len(prefix):].strip()
        g["offers"].append({
            "id": v.get("id"), "title": title or "Aanbod", "name": v.get("name") or "",
            "description": v.get("description") or "", "municipality": v.get("municipality") or "",
            "municipalities": v.get("municipalities") or [], "category": v.get("category") or v.get("primaryTheme") or "",
            "themes": v.get("themes") or [], "subthemes": v.get("subthemes") or [], "tags": v.get("tags") or [],
            "guidePaths": v.get("guidePaths") or [], "guideExclude": bool(v.get("guideExclude")),
            "audience": v.get("audience") or "", "costs": v.get("costs") or "", "access": v.get("access") or "",
            "openingHours": v.get("openingHours") or "", "phone": v.get("phone") or "", "email": v.get("email") or "",
            "source": v.get("source") or "", "sourceKind": v.get("sourceKind") or "",
            "sourceTitle": v.get("sourceTitle") or "", "checked": v.get("checked") or inv.get("checked") or "",
            "reviewStatus": status,
            "address": v.get("address") or "", "postcode": v.get("postcode") or "", "town": v.get("town") or "",
            "lat": v.get("lat"), "lon": v.get("lon"), "locationType": v.get("locationType") or "",
            "locationSource": v.get("locationSource") or "", "locationMunicipality": v.get("locationMunicipality") or "",
            "mapLocationType": v.get("mapLocationType") or map_location_type(v),
            "mapPin": bool(v.get("mapPin")),
        })
        g["offerCount"] += 1

    catalog = []
    for g in groups.values():
        g["municipalities"].sort()
        g["offers"].sort(key=lambda x: x["title"].casefold())
        g["location"] = pick_location(g["offers"])
        g["status"] = "review-needed" if g["reviewNeeded"] else "source-backed"
        g["primarySource"] = g["sources"][0] if g["sources"] else ""
        catalog.append(g)
    catalog.sort(key=lambda x: x["organization"].casefold())

    facilities = list(base_facilities)
    explicit_org_ids = set()
    explicit = 0

    # Concrete inloop-, huiskamer-, dagontmoeting- en cursuslocaties kunnen
    # bewust als afzonderlijke pin worden gepubliceerd. Algemeen aanbod blijft
    # gegroepeerd op organisatieniveau.
    for g in catalog:
        for o in g.get("offers", []):
            if not o.get("mapPin") or not has_location(o):
                continue
            service_areas = o.get("municipalities") or ([o.get("municipality")] if o.get("municipality") else [])
            location_municipality = o.get("locationMunicipality") or ""
            service_municipality = location_municipality if location_municipality in service_areas else (service_areas[0] if service_areas else location_municipality)
            facilities.append({
                "id": "offer-" + (o.get("id") or stable_id(o.get("name") or o.get("title") or "locatie")),
                "name": o.get("name") or o.get("title") or g["organization"],
                "category": o.get("category") or (g.get("categories") or ["advies"])[0],
                "address": o.get("address") or "",
                "postcode": o.get("postcode") or "",
                "town": o.get("town") or "",
                "municipality": service_municipality,
                "serviceMunicipalities": service_areas,
                "lat": o.get("lat"),
                "lon": o.get("lon"),
                "source": o.get("source") or g.get("primarySource") or "",
                "checked": o.get("checked") or g.get("checked") or inv.get("checked") or "",
                "tags": o.get("tags") or o.get("themes") or [o.get("category") or "advies"],
                "subthemes": o.get("subthemes") or [],
                "guidePaths": o.get("guidePaths") or [], "guideExclude": bool(o.get("guideExclude")),
                "description": o.get("description") or "",
                "audience": o.get("audience") or "",
                "costs": o.get("costs") or "",
                "access": o.get("access") or "",
                "openingHours": o.get("openingHours") or "",
                "phone": o.get("phone") or "",
                "email": o.get("email") or "",
                "locationType": o.get("locationType") or "visiting",
                "locationSource": o.get("locationSource") or o.get("source") or "",
                "mapLocationType": o.get("mapLocationType") or map_location_type(o),
                "catalogOrganizationId": g["id"],
            })
            explicit_org_ids.add(g["id"])
            explicit += 1

    synthetic = 0
    for g in catalog:
        loc = g.get("location")
        if not loc or g["id"] in explicit_org_ids or base_represents(g, base_facilities):
            continue
        first_offer = next((o for o in g["offers"] if has_location(o)), g["offers"][0] if g["offers"] else {})
        location_municipality = loc.get("locationMunicipality") or ""
        service_municipality = location_municipality if location_municipality in g["municipalities"] else (g["municipalities"][0] if g["municipalities"] else location_municipality)
        category = (g.get("categories") or ["advies"])[0]
        description = (
            f"{'Contact-/vestigingsadres' if loc.get('locationType') in {'contact','source-address'} else 'Locatie'} "
            f"voor {g['organization']}. Via de bron zijn {g['offerCount']} vormen van voorliggend aanbod opgenomen."
        )
        facilities.append({
            "id": "catalog-" + g["id"],
            "name": g["organization"],
            "category": category,
            "address": loc.get("address") or "",
            "postcode": loc.get("postcode") or "",
            "town": loc.get("town") or "",
            "municipality": service_municipality,
            "serviceMunicipalities": g.get("municipalities") or [],
            "lat": loc.get("lat"),
            "lon": loc.get("lon"),
            "source": g.get("primarySource") or loc.get("locationSource") or "",
            "checked": g.get("checked") or inv.get("checked") or "",
            "tags": g.get("categories") or [category],
            "subthemes": [],
            "description": description,
            "audience": first_offer.get("audience") or "",
            "costs": first_offer.get("costs") or "",
            "access": first_offer.get("access") or "",
            "openingHours": first_offer.get("openingHours") or "",
            "phone": first_offer.get("phone") or "",
            "email": first_offer.get("email") or "",
            "locationType": loc.get("locationType") or "contact",
            "locationSource": loc.get("locationSource") or "",
            "mapLocationType": loc.get("mapLocationType") or map_location_type(loc),
            "catalogOrganizationId": g["id"],
        })
        synthetic += 1

    DATA.mkdir(parents=True, exist_ok=True)
    dump(DATA / "facilities.json", facilities)
    dump(DATA / "catalog.json", catalog)
    dump(DATA / "review-queue.json", review)
    print(
        f"{len(facilities)} kaartlocaties ({len(base_facilities)} bestaand + {explicit} concrete + {synthetic} bron/contact) · "
        f"{len(catalog)} organisaties · {sum(g['offerCount'] for g in catalog)} aanbodregels · {len(review)} aandachtspunten"
    )

if __name__ == "__main__":
    main()
