#!/usr/bin/env python3
"""Audit de automatische Wegwijzer-indeling en toon verdachte brede matches."""
from __future__ import annotations
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))

def norm(value):
    s = unicodedata.normalize("NFD", str(value or "").casefold())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def term_matches(text, term):
    needle = norm(term)
    if not needle:
        return False
    padded = f" {text} "
    if " " in needle or len(needle) <= 4:
        return f" {needle} " in padded
    return needle in text

def leaves(nodes, prefix=()):
    for node in nodes:
        path = (*prefix, node["id"])
        if node.get("children"):
            yield from leaves(node["children"], path)
        else:
            yield "/".join(path), node

def record_text(record):
    activities = []
    for item in record.get("activities") or []:
        if isinstance(item, str):
            activities.append(item)
        elif isinstance(item, dict):
            activities.extend([
                item.get("name") or "", item.get("description") or "",
                item.get("location") or "", item.get("schedule") or "",
            ])
    fields = [
        record.get("organization"), record.get("title"), record.get("description"),
        record.get("audience"), record.get("access"), record.get("costs"),
        record.get("activitiesNote"), " ".join(activities),
        " ".join(record.get("themes") or []), " ".join(record.get("subthemes") or []),
        " ".join(record.get("tags") or []), " ".join(record.get("routeTags") or []),
    ]
    return norm(" ".join(str(x or "") for x in fields))

taxonomy = load("data/wegwijzer-themas.json")
leaf_nodes = list(leaves(taxonomy))
catalog = load("data/catalog.json")
facilities = load("data/facilities.json")
curated = load("data/wegwijzer-curated.json")

records = []
for group in catalog:
    org = group.get("organization") or group.get("name") or ""
    for offer in group.get("offers") or []:
        offer_areas = list(dict.fromkeys([
            *(offer.get("municipalities") or []),
            *([offer.get("municipality")] if offer.get("municipality") else []),
        ]))
        records.append({
            "organization": org,
            "title": offer.get("title") or offer.get("name") or org,
            "municipalities": offer_areas or list(group.get("municipalities") or []),
            "description": offer.get("description") or "",
            "audience": offer.get("audience") or "",
            "access": offer.get("access") or "",
            "costs": offer.get("costs") or "",
            "themes": offer.get("themes") or [],
            "subthemes": offer.get("subthemes") or [],
            "tags": offer.get("tags") or [],
            "routeTags": offer.get("routeTags") or [],
            "guidePaths": offer.get("guidePaths") or [],
            "guideExclude": bool(offer.get("guideExclude")),
            "activityOnly": bool(offer.get("activityOnly")),
            "activities": offer.get("activities") or [],
            "activitiesNote": offer.get("activitiesNote") or "",
        })
# De openbare Wegwijzer leest naast de catalogus ook fysieke voorzieningen.
# Neem hier alleen expliciet gerouteerde faciliteiten mee: generieke kaartpunten
# horen niet via trefwoorden onbedoeld extra Wegwijzer-routes te krijgen.
for facility in facilities:
    if not facility.get("guidePaths"):
        continue
    areas = list(dict.fromkeys([
        *(facility.get("serviceMunicipalities") or []),
        *(facility.get("municipalities") or []),
        *([facility.get("municipality")] if facility.get("municipality") else []),
    ]))
    records.append({
        "organization": facility.get("name") or "",
        "title": facility.get("name") or "",
        "municipalities": areas,
        "description": facility.get("description") or "",
        "audience": facility.get("audience") or "",
        "access": facility.get("access") or "",
        "costs": facility.get("costs") or "",
        "themes": facility.get("themes") or [],
        "subthemes": facility.get("subthemes") or [],
        "tags": facility.get("tags") or [],
        "routeTags": facility.get("routeTags") or [],
        "guidePaths": facility.get("guidePaths") or [],
        "guideExclude": bool(facility.get("guideExclude")),
        "activities": facility.get("activities") or [],
        "activitiesNote": facility.get("activitiesNote") or "",
    })

records.extend(curated)

automatic = []
unmatched = []
excluded = []
for rec in records:
    if rec.get("guideExclude") or rec.get("activityOnly"):
        excluded.append(rec)
        continue
    explicit = rec.get("guidePaths") or []
    if explicit:
        continue
    text = record_text(rec)
    matches = [path for path, node in leaf_nodes if any(term_matches(text, term) for term in node.get("include") or [])]
    if not matches:
        unmatched.append(rec)
    automatic.append((rec, matches))

ambiguous = sorted((x for x in automatic if len(x[1]) >= 4), key=lambda x: len(x[1]), reverse=True)
explicit_count = len(records) - len(automatic) - len(excluded)
print(f"Wegwijzer-audit: {len(records)} records · {explicit_count} expliciet · {len(automatic)} automatisch · {len(excluded)} bewust uitgesloten")
print(f"Automatisch zonder match: {len(unmatched)} · automatisch met 4+ routes: {len(ambiguous)}")
for rec, matches in ambiguous[:40]:
    print(f"AMBIGU {rec.get('organization')} · {rec.get('title')} -> {', '.join(matches)}")
for rec in unmatched[:80]:
    print(f"GEEN ROUTE {rec.get('organization')} · {rec.get('title')}")

# Deze grens bewaakt dat de trefwoordindeling niet opnieuw extreem breed wordt.
assert len(ambiguous) == 0, f"Brede automatische Wegwijzer-matches gevonden: {len(ambiguous)}"
assert len(unmatched) == 0, f"Automatisch aanbod zonder Wegwijzer-route gevonden: {len(unmatched)}"


# Kritieke combinatietests: thema + gemeente moeten bekende voorzieningen behouden.
expectations = load("data/wegwijzer-expectations.json")

def serves(rec, municipality):
    areas = rec.get("municipalities") or []
    return municipality in areas or "Twente" in areas

def matches_path(rec, path):
    explicit = rec.get("guidePaths") or []
    if explicit:
        return any(value == path or value.startswith(path + "/") for value in explicit)
    text = record_text(rec)
    for leaf_path, node in leaf_nodes:
        if leaf_path != path:
            continue
        required = node.get("requireAny") or []
        if required and not any(term_matches(text, term) for term in required):
            return False
        return any(term_matches(text, term) for term in node.get("include") or [])
    return False

for item in expectations:
    found = [
        rec for rec in records
        if not rec.get("guideExclude")
        and not rec.get("activityOnly")
        and norm(item["nameContains"]) in norm(f"{rec.get('organization','')} {rec.get('title','')}")
        and serves(rec, item["municipality"])
        and matches_path(rec, item["path"])
    ]
    should_exist = item.get("shouldExist", True)
    if should_exist:
        assert found, (
            f"Kritieke Wegwijzer-combinatie ontbreekt: {item['nameContains']} "
            f"bij {item['municipality']} op {item['path']}"
        )
    else:
        assert not found, (
            f"Kritieke Wegwijzer-combinatie staat ten onrechte zichtbaar: {item['nameContains']} "
            f"bij {item['municipality']} op {item['path']}"
        )
print(f"{len(expectations)} kritieke thema+gemeente-combinaties gecontroleerd")


# Volledigheidscontrole per eindthema: geen zichtbaar Wegwijzer-thema mag leeg zijn.
leaf_coverage = {path: 0 for path, _ in leaf_nodes}
for rec in records:
    if rec.get("guideExclude") or rec.get("activityOnly"):
        continue
    explicit = rec.get("guidePaths") or []
    if explicit:
        for path in explicit:
            if path in leaf_coverage:
                leaf_coverage[path] += 1
        continue
    text = record_text(rec)
    for path, node in leaf_nodes:
        required = node.get("requireAny") or []
        if required and not any(term_matches(text, term) for term in required):
            continue
        if any(term_matches(text, term) for term in node.get("include") or []):
            leaf_coverage[path] += 1

empty_leaves = [path for path, count in leaf_coverage.items() if count == 0]
assert not empty_leaves, f"Lege Wegwijzer-eindthema's: {', '.join(empty_leaves)}"
print(f"{len(leaf_coverage)} Wegwijzer-eindthema's hebben minimaal één passend resultaat")
