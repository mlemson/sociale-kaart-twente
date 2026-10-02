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
    fields = [
        record.get("organization"), record.get("title"), record.get("description"),
        record.get("audience"), record.get("access"), record.get("costs"),
        " ".join(record.get("themes") or []), " ".join(record.get("subthemes") or []),
        " ".join(record.get("tags") or []), " ".join(record.get("routeTags") or []),
    ]
    return norm(" ".join(str(x or "") for x in fields))

taxonomy = load("data/wegwijzer-themas.json")
leaf_nodes = list(leaves(taxonomy))
catalog = load("data/catalog.json")
curated = load("data/wegwijzer-curated.json")

records = []
for group in catalog:
    org = group.get("organization") or group.get("name") or ""
    for offer in group.get("offers") or []:
        records.append({
            "organization": org,
            "title": offer.get("title") or offer.get("name") or org,
            "description": offer.get("description") or "",
            "audience": offer.get("audience") or "",
            "access": offer.get("access") or "",
            "costs": offer.get("costs") or "",
            "themes": offer.get("themes") or [],
            "subthemes": offer.get("subthemes") or [],
            "tags": offer.get("tags") or [],
            "routeTags": offer.get("routeTags") or [],
            "guidePaths": offer.get("guidePaths") or [],
        })
records.extend(curated)

automatic = []
unmatched = []
for rec in records:
    explicit = rec.get("guidePaths") or []
    if explicit:
        continue
    text = record_text(rec)
    matches = [path for path, node in leaf_nodes if any(term_matches(text, term) for term in node.get("include") or [])]
    if not matches:
        unmatched.append(rec)
    automatic.append((rec, matches))

ambiguous = sorted((x for x in automatic if len(x[1]) >= 4), key=lambda x: len(x[1]), reverse=True)
print(f"Wegwijzer-audit: {len(records)} records · {len(records)-len(automatic)} expliciet · {len(automatic)} automatisch")
print(f"Automatisch zonder match: {len(unmatched)} · automatisch met 4+ routes: {len(ambiguous)}")
for rec, matches in ambiguous[:40]:
    print(f"AMBIGU {rec.get('organization')} · {rec.get('title')} -> {', '.join(matches)}")

# Deze grens bewaakt dat de trefwoordindeling niet opnieuw extreem breed wordt.
assert len(ambiguous) <= 60, f"Te veel brede automatische Wegwijzer-matches: {len(ambiguous)}"
