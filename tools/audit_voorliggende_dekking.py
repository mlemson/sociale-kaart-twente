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
FACILITIES = ROOT / "data" / "facilities.json"

MUNICIPALITIES = [
    "Almelo", "Borne", "Dinkelland", "Enschede", "Haaksbergen", "Hellendoorn",
    "Hengelo", "Hof van Twente", "Losser", "Oldenzaal", "Rijssen-Holten",
    "Tubbergen", "Twenterand", "Wierden",
]

MIN_PHYSICAL_SITES = 5
WARN_PHYSICAL_SITES = 10


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


def _norm(value: str) -> str:
    return " ".join(str(value or "").casefold().split())


def canonical_municipality(value: str) -> str:
    return "Hengelo" if value == "Hengelo (O)" else str(value or "").strip()


def physical_site_counts(facilities: list[dict]) -> dict[str, int]:
    sites = {municipality: set() for municipality in MUNICIPALITIES}
    for item in facilities:
        if item.get("physicalLocation") is not True:
            continue
        municipality = canonical_municipality(
            item.get("locationMunicipality") or item.get("municipality")
        )
        if municipality not in sites:
            continue
        key = (
            _norm(item.get("address")),
            _norm(str(item.get("postcode") or "").replace(" ", "")),
            _norm(item.get("town")),
        )
        if not key[0] or not key[2]:
            continue
        sites[municipality].add(key)
    return {municipality: len(values) for municipality, values in sites.items()}


def exact_source_duplicates(rows: list[dict]) -> list[list[dict]]:
    groups: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        name = _norm(row.get("name"))
        if not name:
            continue
        key = (
            name,
            _norm(row.get("address")),
            _norm(row.get("town")),
        )
        groups.setdefault(key, []).append(row)
    return [group for group in groups.values() if len(group) > 1]


def main():
    inv = load(INVENTORY)
    extra = load(EXTRA)
    facilities = load(FACILITIES)
    rows = [*(inv.get("candidates") or []), *(extra.get("candidates") or [])]
    sources = extra.get("sources") or []
    physical_counts = physical_site_counts(facilities)

    missing_sources = []
    critically_low = []
    low_coverage = []
    print("Gerichte brondekking voorliggende voorzieningen")
    print("-" * 86)
    for municipality in MUNICIPALITIES:
        source_count = sum(municipality in (source.get("municipalities") or []) for source in sources)
        candidate_rows = [row for row in rows if municipality in areas(row)]
        freeish = sum(is_freeish(row) for row in candidate_rows)
        routed = sum(bool(row.get("guidePaths")) for row in candidate_rows)
        physical = physical_counts.get(municipality, 0)
        print(
            f"{municipality:18} bronnen={source_count:2}  "
            f"aanbod={len(candidate_rows):3}  voorliggend/gratis~={freeish:3}  "
            f"wegwijzer={routed:3}  fysieke-plekken={physical:2}"
        )
        if source_count == 0:
            missing_sources.append(municipality)
        if physical < MIN_PHYSICAL_SITES:
            critically_low.append(municipality)
        elif physical < WARN_PHYSICAL_SITES:
            low_coverage.append(f"{municipality} ({physical})")

    duplicates = exact_source_duplicates(rows)

    assert not missing_sources, (
        "Geen gerichte aanvullende bron geregistreerd voor: "
        + ", ".join(missing_sources)
    )
    assert not critically_low, (
        "Verdacht lage fysieke kaartdekking (< "
        f"{MIN_PHYSICAL_SITES} unieke plekken): "
        + ", ".join(critically_low)
    )
    assert not duplicates, (
        f"{len(duplicates)} exacte dubbele bronregels gevonden; "
        "voeg dezelfde voorziening samen in plaats van hem dubbel te publiceren."
    )

    if low_coverage:
        print(
            "\nLET OP: relatief lage fysieke dekking (< "
            f"{WARN_PHYSICAL_SITES} plekken): " + ", ".join(low_coverage)
        )
    print(
        f"\nAlle {len(MUNICIPALITIES)} Twentse gemeenten hebben een gerichte bron, "
        f"minimaal {MIN_PHYSICAL_SITES} unieke fysieke kaartplekken en geen exacte dubbelen."
    )


if __name__ == "__main__":
    main()
