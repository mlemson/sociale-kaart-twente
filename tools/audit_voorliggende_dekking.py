#!/usr/bin/env python3
"""Controleer de brondekking voor vrij toegankelijke / voorliggende voorzieningen.

Dit is geen inhoudelijke kwaliteitsbeoordeling. Het doel is te voorkomen dat toekomstige
uitbreidingen alleen de grote welzijnsorganisaties volgen en een of meer Twentse gemeenten
uit de gerichte broninventarisatie verdwijnen.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "inventory.json"
EXTRA = ROOT / "inventory.extra.json"

MUNICIPALITIES = [
    "Almelo", "Borne", "Dinkelland", "Enschede", "Haaksbergen", "Hellendoorn",
    "Hengelo", "Hof van Twente", "Losser", "Oldenzaal", "Rijssen-Holten",
    "Tubbergen", "Twenterand", "Wierden",
]


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def areas(row: dict) -> set[str]:
    values = set(row.get("municipalities") or [])
    if row.get("municipality"):
        values.add(row["municipality"])
    return values


def is_freeish(row: dict) -> bool:
    text = " ".join([
        str(row.get("costs") or ""),
        str(row.get("scope") or ""),
        " ".join(row.get("tags") or []),
    ]).casefold()
    return any(term in text for term in (
        "gratis", "geen kosten", "geen entree", "vrij toegankelijk",
        "voorliggend", "algemene voorziening",
    ))


def main():
    inv = load(INVENTORY)
    extra = load(EXTRA)
    rows = [*(inv.get("candidates") or []), *(extra.get("candidates") or [])]
    sources = extra.get("sources") or []

    missing_sources = []
    print("Gerichte brondekking voorliggende voorzieningen")
    print("-" * 66)
    for municipality in MUNICIPALITIES:
        source_count = sum(municipality in (source.get("municipalities") or []) for source in sources)
        candidate_rows = [row for row in rows if municipality in areas(row)]
        freeish = sum(is_freeish(row) for row in candidate_rows)
        routed = sum(bool(row.get("guidePaths")) for row in candidate_rows)
        print(
            f"{municipality:18} bronnen={source_count:2}  "
            f"aanbod={len(candidate_rows):3}  voorliggend/gratis~={freeish:3}  "
            f"wegwijzer={routed:3}"
        )
        if source_count == 0:
            missing_sources.append(municipality)

    assert not missing_sources, (
        "Geen gerichte aanvullende bron geregistreerd voor: "
        + ", ".join(missing_sources)
    )
    print(f"\nAlle {len(MUNICIPALITIES)} Twentse gemeenten hebben minimaal één gerichte bron.")


if __name__ == "__main__":
    main()
