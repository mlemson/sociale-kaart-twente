#!/usr/bin/env python3
"""Bouw publieke kaartdata, organisatiecatalogus en een kleine uitzonderingenlijst."""
from __future__ import annotations
import json, re, shutil, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "inventory.json"
BASE = ROOT / "local-backend" / "facilities.base.json"
DATA = ROOT / "data"
GENERIC = re.compile(r"^(sociale kaart|gemeente|regio|bron|voorzieningen|samen twente)", re.I)

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def org_name(v):
    name = (v.get("name") or "").strip()
    if " · " in name:
        return name.split(" · ", 1)[0].strip()
    source_title = (v.get("sourceTitle") or "").strip()
    if source_title and not GENERIC.search(source_title) and v.get("sourceKind") in {"first-party", "provider"}:
        return source_title
    return name or source_title or "Onbekend"

def review_status(v):
    if v.get("status") == "published" or v.get("accessStatus") == "confirmed":
        return "manual"
    if not v.get("source") or not v.get("name") or not (v.get("municipality") or v.get("municipalities")):
        return "review-needed"
    if (v.get("enrichment") or {}).get("categoryConflict"):
        return "review-needed"
    return "source-backed"

def stable_id(text):
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xffffffff
    normalized = unicodedata.normalize("NFD", text.lower())
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    base = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:46] or "organisatie"
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    n = h
    tail = "0" if n == 0 else ""
    while n:
        n, r = divmod(n, 36)
        tail = alphabet[r] + tail
    return f"org-{base}-{tail}"

def main():
    inv = load(INVENTORY)
    facilities = load(BASE)
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
            review.append({
                "id": v.get("id"), "name": v.get("name"), "municipality": v.get("municipality") or "",
                "source": v.get("source") or "", "sourceTitle": v.get("sourceTitle") or "",
                "reason": ("Bron ontbreekt" if not v.get("source") else "Categorie uit bron en automatische indeling spreken elkaar tegen" if (v.get("enrichment") or {}).get("categoryConflict") else "Kerngegevens ontbreken"),
                "checked": v.get("checked") or inv.get("checked") or ""
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
            "audience": v.get("audience") or "", "costs": v.get("costs") or "", "access": v.get("access") or "",
            "source": v.get("source") or "", "sourceKind": v.get("sourceKind") or "",
            "sourceTitle": v.get("sourceTitle") or "", "checked": v.get("checked") or inv.get("checked") or "",
            "reviewStatus": status
        })
        g["offerCount"] += 1
    catalog = []
    for g in groups.values():
        g["municipalities"].sort()
        g["offers"].sort(key=lambda x: x["title"].casefold())
        g["status"] = "review-needed" if g["reviewNeeded"] else "source-backed"
        g["primarySource"] = g["sources"][0] if g["sources"] else ""
        catalog.append(g)
    catalog.sort(key=lambda x: x["organization"].casefold())
    DATA.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BASE, DATA / "facilities.json")
    dump(DATA / "catalog.json", catalog)
    dump(DATA / "review-queue.json", review)
    print(f"{len(facilities)} kaartlocaties · {len(catalog)} organisaties · {sum(g['offerCount'] for g in catalog)} aanbodregels · {len(review)} aandachtspunten")

if __name__ == "__main__":
    main()
