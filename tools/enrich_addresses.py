#!/usr/bin/env python3
"""Verrijk bronvermeldingen met een bruikbaar adres en coördinaten.

Werkwijze:
1. Bestaande adressen/coördinaten blijven leidend.
2. Per organisatie zoeken we eerst op de opgegeven bronpagina.
3. Als daar geen adres staat volgen we logische contact-/locatielinks op hetzelfde domein.
4. Als laatste proberen we een beperkt aantal bekende contactpaden.
5. Het gevonden adres wordt via de gratis PDOK Locatieserver gegeocodeerd.
6. Als een organisatie één bruikbaar contact-/vestigingsadres heeft, gebruiken we dat als
   terugval voor andere aanbodregels van dezelfde organisatie die zelf geen adres bevatten.

Het doel is niet om te suggereren dat ieder aanbod op het contactadres plaatsvindt.
Daarom bewaren we locationType en locationSource expliciet.
Wordt ook vanuit GitHub Actions gebruikt wanneer brondata of deze verrijker wijzigt.
Laatste UI/kaartcontrole: externe contactadressen blijven uit de Twente-kaart.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import socket
import ipaddress
import time
import unicodedata
from collections import defaultdict
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "inventory.json"
EXTRA = ROOT / "inventory.extra.json"
UA = "SocialeKaartTwente/1.0 (+https://github.com/mlemson/sociale-kaart-twente)"
TIMEOUT = 15
MAX_BYTES = 2_500_000
REQUEST_DELAY = float(os.environ.get("ADDRESS_REQUEST_DELAY", "0.08"))

TWENTE_MUNICIPALITIES = {
    "Almelo", "Borne", "Dinkelland", "Enschede", "Haaksbergen", "Hellendoorn",
    "Hengelo", "Hof van Twente", "Losser", "Oldenzaal", "Rijssen-Holten",
    "Tubbergen", "Twenterand", "Wierden",
}
TWENTE_TOWNS = {
    "almelo": "Almelo", "borne": "Borne", "denekamp": "Dinkelland",
    "ootmarsum": "Dinkelland", "weerselo": "Dinkelland", "enschede": "Enschede",
    "glanerbrug": "Enschede", "boekelo": "Enschede", "lonneker": "Enschede",
    "haaksbergen": "Haaksbergen", "buurse": "Haaksbergen",
    "nijverdal": "Hellendoorn", "hellendoorn": "Hellendoorn",
    "hengelo": "Hengelo", "goor": "Hof van Twente", "delden": "Hof van Twente",
    "markelo": "Hof van Twente", "diepenheim": "Hof van Twente",
    "bentelo": "Hof van Twente", "hengevelde": "Hof van Twente",
    "losser": "Losser", "overdinkel": "Losser", "de lutte": "Losser",
    "oldenzaal": "Oldenzaal", "rijssen": "Rijssen-Holten", "holten": "Rijssen-Holten",
    "tubbergen": "Tubbergen", "albergen": "Tubbergen", "vroomshoop": "Twenterand",
    "vriezenveen": "Twenterand", "den ham": "Twenterand",
    "westerhaar-vriezenveensewijk": "Twenterand", "wierden": "Wierden", "enter": "Wierden",
}
TWENTE_CENTERS = {
    "Almelo": (52.3567, 6.6625), "Borne": (52.3013, 6.7480),
    "Dinkelland": (52.3765, 6.8890), "Enschede": (52.2215, 6.8937),
    "Haaksbergen": (52.1560, 6.7380), "Hellendoorn": (52.3880, 6.4490),
    "Hengelo": (52.2650, 6.7930), "Hof van Twente": (52.2370, 6.5860),
    "Losser": (52.2600, 7.0040), "Oldenzaal": (52.3130, 6.9300),
    "Rijssen-Holten": (52.3100, 6.5190), "Tubbergen": (52.4070, 6.7850),
    "Twenterand": (52.4350, 6.6220), "Wierden": (52.3590, 6.5930),
}
MUNICIPALITY_ALIASES = {"Hengelo (O)": "Hengelo"}
GENERIC = re.compile(r"^(sociale kaart|gemeente|regio|bron|voorzieningen|samen twente)", re.I)
CONTACT_HINT = re.compile(r"(contact|locatie|bereik|over[- ]ons|adres|vestiging)", re.I)
POSTCODE_RE = re.compile(r"\b([1-9][0-9]{3})\s?([A-Z]{2})\b", re.I)
ADDRESS_RE = re.compile(
    r"(?P<street>[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9.'’\- ]{1,55}?"
    r"\s+\d{1,5}[A-Za-z0-9\-/]{0,8})"
    r"\s*[,;\n ]+"
    r"(?P<postcode>[1-9][0-9]{3}\s?[A-Z]{2})"
    r"\s*[,;\n ]+"
    r"(?P<town>[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,35})",
    re.I,
)

def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def dump(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def norm(text: str) -> str:
    value = unicodedata.normalize("NFD", (text or "").casefold())
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()

def org_name(v: dict) -> str:
    name = (v.get("name") or "").strip()
    if " · " in name:
        return name.split(" · ", 1)[0].strip()
    source_title = (v.get("sourceTitle") or "").strip()
    if source_title and not GENERIC.search(source_title) and v.get("sourceKind") in {"first-party", "provider", "regional"}:
        return source_title
    return name or source_title or "Onbekend"

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text_parts = []
        self.links = []
        self._href = None
        self._link_text = []
        self.jsonld = []
        self._in_jsonld = False
        self._json_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self._href = attrs.get("href")
            self._link_text = []
        if tag == "script" and (attrs.get("type") or "").lower() == "application/ld+json":
            self._in_jsonld = True
            self._json_parts = []
        if tag in {"br", "p", "div", "li", "address", "section", "footer", "header"}:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "a" and self._href:
            self.links.append((self._href, " ".join(self._link_text).strip()))
            self._href = None
            self._link_text = []
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._json_parts))
            self._in_jsonld = False
            self._json_parts = []

    def handle_data(self, data):
        if self._in_jsonld:
            self._json_parts.append(data)
        else:
            cleaned = data.strip()
            if cleaned:
                self.text_parts.append(cleaned)
                if self._href is not None:
                    self._link_text.append(cleaned)

def public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False

class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_url(newurl):
            raise ValueError("Redirect naar niet-publiek adres geblokkeerd")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

OPENER = build_opener(SafeRedirect)

def fetch(url: str) -> str:
    if not public_url(url):
        raise ValueError("Bron verwijst niet naar een publiek internetadres")
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    with OPENER.open(req, timeout=TIMEOUT) as response:
        ctype = (response.headers.get("Content-Type") or "").lower()
        if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
            return ""
        data = response.read(MAX_BYTES)
        encoding = response.headers.get_content_charset() or "utf-8"
        return data.decode(encoding, errors="replace")

def postal_addresses_from_json(obj):
    found = []
    if isinstance(obj, dict):
        typ = obj.get("@type")
        types = {typ} if isinstance(typ, str) else set(typ or [])
        if "PostalAddress" in types or any(k in obj for k in ("streetAddress", "postalCode", "addressLocality")):
            street = str(obj.get("streetAddress") or "").strip()
            postcode = str(obj.get("postalCode") or "").strip()
            town = str(obj.get("addressLocality") or "").strip()
            if street and (postcode or town):
                found.append({"address": street, "postcode": postcode, "town": town})
        for value in obj.values():
            found.extend(postal_addresses_from_json(value))
    elif isinstance(obj, list):
        for value in obj:
            found.extend(postal_addresses_from_json(value))
    return found

def clean_town(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip(" ,.;|-")
    # voorkom dat een regex de volgende kop of zin meeneemt
    for stopper in (" Contact", " Tel", " Telefoon", " E-mail", " Email", " Opening"):
        if stopper.lower() in value.lower():
            value = re.split(stopper, value, flags=re.I)[0].strip()
    return value[:45]

def extract_addresses(page_html: str, page_url: str):
    parser = PageParser()
    parser.feed(page_html)
    results = []
    for raw in parser.jsonld:
        try:
            obj = json.loads(html.unescape(raw))
        except Exception:
            continue
        for address in postal_addresses_from_json(obj):
            address["page"] = page_url
            address["kind"] = "structured"
            results.append(address)

    text = "\n".join(parser.text_parts)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    for match in ADDRESS_RE.finditer(text):
        street = re.sub(r"\s+", " ", match.group("street")).strip(" ,.;|-")
        postcode = re.sub(r"\s+", "", match.group("postcode")).upper()
        town = clean_town(match.group("town"))
        if len(street) < 4 or len(town) < 2:
            continue
        results.append({
            "address": street,
            "postcode": postcode,
            "town": town,
            "page": page_url,
            "kind": "text",
        })

    # dedupliceren
    unique = {}
    for item in results:
        key = (norm(item.get("address", "")), re.sub(r"\s+", "", item.get("postcode", "")).upper(), norm(item.get("town", "")))
        if key[0]:
            unique[key] = item
    return list(unique.values()), parser.links

def score_address(item: dict, expected_municipalities: list[str], source_url: str) -> int:
    score = 0
    postcode = item.get("postcode") or ""
    town = norm(item.get("town") or "")
    address = item.get("address") or ""
    if POSTCODE_RE.search(postcode):
        score += 8
    if re.search(r"\d", address):
        score += 4
    mapped = TWENTE_TOWNS.get(town)
    if mapped:
        score += 8
        if mapped in expected_municipalities:
            score += 32
        else:
            score += 2
    elif town:
        score -= 8
    if any(norm(m) in town or town in norm(m) for m in expected_municipalities if town):
        score += 20
    if item.get("kind") == "structured":
        score += 2
    if item.get("page") == source_url:
        score += 1
    if CONTACT_HINT.search(urlparse(item.get("page") or "").path):
        score += 2
    return score

def contact_pages(source_url: str, links, expected_municipalities: list[str]):
    parsed = urlparse(source_url)
    base = f"{parsed.scheme}://{parsed.netloc}/"
    choices = []
    for href, label in links:
        absolute = urljoin(source_url, href)
        p = urlparse(absolute)
        if p.scheme not in {"http", "https"} or p.netloc != parsed.netloc:
            continue
        local_hint = any(norm(m) and (norm(m) in norm(label or "") or norm(m) in norm(p.path)) for m in expected_municipalities)
        if CONTACT_HINT.search(label or "") or CONTACT_HINT.search(p.path) or local_hint:
            choices.append(absolute.split("#")[0])
    for guess in ("contact", "contact/", "over-ons/contact", "over-ons/contact/", "locaties", "locaties/"):
        choices.append(urljoin(base, guess))
    seen = set()
    result = []
    for url in choices:
        if url not in seen and url != source_url:
            seen.add(url)
            result.append(url)
    return result[:6]

def pdok_geocode(item: dict, expected_municipalities: list[str]):
    query = " ".join(x for x in [item.get("address"), item.get("postcode"), item.get("town")] if x)
    if not query:
        return None
    url = (
        "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
        f"?q={quote_plus(query)}&fq=type%3Aadres&rows=5"
    )
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with OPENER.open(req, timeout=TIMEOUT) as response:
            payload = json.loads(response.read(750_000).decode("utf-8"))
    except Exception:
        return None
    docs = ((payload.get("response") or {}).get("docs") or [])
    if not docs:
        return None

    expected = set(expected_municipalities)
    ranked = []
    for doc in docs:
        municipality = doc.get("gemeentenaam") or ""
        score = float(doc.get("score") or 0)
        if municipality in expected:
            score += 50
        if municipality in TWENTE_MUNICIPALITIES:
            score += 20
        ranked.append((score, doc))
    doc = max(ranked, key=lambda x: x[0])[1]
    point = doc.get("centroide_ll") or doc.get("centroid_ll") or ""
    match = re.search(r"POINT\(([-0-9.]+)\s+([-0-9.]+)\)", point)
    if not match:
        return None
    lon, lat = float(match.group(1)), float(match.group(2))
    if not (50.5 <= lat <= 53.7 and 3.0 <= lon <= 7.5):
        return None
    return {
        "address": " ".join(x for x in [doc.get("straatnaam"), doc.get("huis_nlt") or doc.get("huisnummer")] if x).strip() or item.get("address") or "",
        "postcode": (doc.get("postcode") or item.get("postcode") or "").replace(" ", "").upper(),
        "town": doc.get("woonplaatsnaam") or item.get("town") or "",
        "locationMunicipality": doc.get("gemeentenaam") or "",
        "lat": lat,
        "lon": lon,
        "displayAddress": doc.get("weergavenaam") or "",
    }

def canonical_municipality(name: str) -> str:
    return MUNICIPALITY_ALIASES.get(name or "", name or "")

def mark_map_mode(location: dict, expected_municipalities: list[str]):
    """Keep the real contact address, but mark a local service-area pin when the
    address itself is outside the municipalities where the offer is available."""
    if not location:
        return location
    expected = {canonical_municipality(m) for m in expected_municipalities if m}
    actual = canonical_municipality(location.get("locationMunicipality") or "")
    if expected and actual and actual not in expected:
        location["mapLocationType"] = "service-area"
    else:
        location["mapLocationType"] = location.get("mapLocationType") or "address"
    return location

def discover_for_group(group: list[dict]):
    expected = sorted({
        m for v in group
        for m in ((v.get("municipalities") or []) + ([v.get("municipality")] if v.get("municipality") else []))
        if m
    })

    # Eerst reeds bekende en geocodeerde locatie gebruiken.
    for v in group:
        if v.get("address") and v.get("town") and isinstance(v.get("lat"), (int, float)) and isinstance(v.get("lon"), (int, float)):
            return {
                "address": v["address"], "postcode": v.get("postcode") or "", "town": v["town"],
                "lat": v["lat"], "lon": v["lon"], "locationMunicipality": v.get("locationMunicipality") or v.get("municipality") or "",
                "locationType": v.get("locationType") or "existing",
                "locationSource": v.get("locationSource") or v.get("source") or "",
                "mapLocationType": v.get("mapLocationType") or "",
            }

    # Een handmatig of eerder gevonden adres zonder coördinaten is betrouwbaarder
    # dan opnieuw gokken op basis van een willekeurige aanbodpagina. Geocodeer dat eerst.
    priority = {"service": 0, "visiting": 0, "existing": 1, "contact": 2, "source-address": 3, "": 4}
    seeded = sorted(
        [v for v in group if v.get("address") and v.get("town")],
        key=lambda v: (priority.get(v.get("locationType") or "", 5), 0 if v.get("postcode") else 1)
    )
    for v in seeded:
        geo = pdok_geocode({
            "address": v.get("address") or "",
            "postcode": v.get("postcode") or "",
            "town": v.get("town") or "",
        }, expected)
        time.sleep(REQUEST_DELAY)
        if geo:
            geo["locationType"] = v.get("locationType") or "contact"
            geo["locationSource"] = v.get("locationSource") or v.get("source") or ""
            return mark_map_mode(geo, expected)

    ranked_sources = sorted(
        [v for v in group if v.get("source") or v.get("locationSource")],
        key=lambda v: ({"first-party": 0, "provider": 0, "regional": 1, "municipal-directory": 2}.get(v.get("sourceKind"), 3), v.get("source", ""))
    )
    tried = set()
    best = None
    best_score = -1

    source_candidates = []
    for v in ranked_sources[:10]:
        # locationSource is an explicit hint for pages where the actual offer page
        # contains no address (for example a course page plus a regional location page).
        for url in (v.get("locationSource"), v.get("source")):
            if url and url not in source_candidates:
                source_candidates.append(url)

    for source_url in source_candidates[:16]:
        if source_url in tried:
            continue
        tried.add(source_url)
        try:
            page_html = fetch(source_url)
            time.sleep(REQUEST_DELAY)
        except Exception:
            continue
        addresses, links = extract_addresses(page_html, source_url)
        for item in addresses:
            score = score_address(item, expected, source_url)
            if score > best_score:
                best, best_score = item, score
        if best_score >= 34:
            break

        for url in contact_pages(source_url, links, expected):
            if url in tried:
                continue
            tried.add(url)
            try:
                contact_html = fetch(url)
                time.sleep(REQUEST_DELAY)
            except Exception:
                continue
            found, _ = extract_addresses(contact_html, url)
            for item in found:
                score = score_address(item, expected, source_url)
                if score > best_score:
                    best, best_score = item, score
            if best_score >= 34:
                break
        if best_score >= 34:
            break

    if not best or best_score < 8:
        return None
    geo = pdok_geocode(best, expected)
    time.sleep(REQUEST_DELAY)
    if not geo:
        return None
    geo["locationType"] = "contact" if CONTACT_HINT.search(urlparse(best.get("page") or "").path) else "source-address"
    geo["locationSource"] = best.get("page") or ""
    return mark_map_mode(geo, expected)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Zoek ook opnieuw voor al verrijkte organisaties.")
    args = parser.parse_args()

    inv = load(INVENTORY)
    extra = load(EXTRA) if EXTRA.exists() else {"checked": "", "sources": [], "candidates": []}
    base_count = len(inv.get("candidates", []))
    inv.setdefault("candidates", []).extend(extra.get("candidates", []))

    groups = defaultdict(list)
    for candidate in inv.get("candidates", []):
        groups[norm(org_name(candidate))].append(candidate)

    changed = 0
    resolved_groups = 0
    unresolved = []
    today = date.today().isoformat()

    for key, group in sorted(groups.items()):
        # Geocodeer eerst ieder expliciet aanbodadres afzonderlijk. Dit is belangrijk
        # voor organisaties met meerdere echte locaties: die mogen niet allemaal
        # het eerste contactadres van de organisatie erven.
        for candidate in group:
            if not (candidate.get("address") and candidate.get("town")):
                continue
            if isinstance(candidate.get("lat"), (int, float)) and isinstance(candidate.get("lon"), (int, float)):
                continue
            candidate_expected = sorted(set(
                (candidate.get("municipalities") or []) +
                ([candidate.get("municipality")] if candidate.get("municipality") else [])
            ))
            geo = pdok_geocode({
                "address": candidate.get("address") or "",
                "postcode": candidate.get("postcode") or "",
                "town": candidate.get("town") or "",
            }, candidate_expected)
            time.sleep(REQUEST_DELAY)
            if geo:
                geo["locationType"] = candidate.get("locationType") or "visiting"
                geo["locationSource"] = candidate.get("locationSource") or candidate.get("source") or ""
                geo = mark_map_mode(geo, candidate_expected)
                candidate.update({
                    "address": geo["address"],
                    "postcode": geo.get("postcode") or candidate.get("postcode") or "",
                    "town": geo["town"],
                    "lat": geo["lat"],
                    "lon": geo["lon"],
                    "locationMunicipality": geo.get("locationMunicipality") or "",
                    "locationType": geo.get("locationType") or candidate.get("locationType") or "visiting",
                    "locationSource": geo.get("locationSource") or candidate.get("locationSource") or candidate.get("source") or "",
                    "mapLocationType": geo.get("mapLocationType") or "address",
                    "addressChecked": today,
                })
                changed += 1

        already = next((
            v for v in group
            if v.get("address") and v.get("town") and isinstance(v.get("lat"), (int, float)) and isinstance(v.get("lon"), (int, float))
        ), None)
        expected = sorted({
            m for v in group
            for m in ((v.get("municipalities") or []) + ([v.get("municipality")] if v.get("municipality") else []))
            if m
        })
        if already and not args.force:
            location = mark_map_mode({
                "address": already["address"], "postcode": already.get("postcode") or "", "town": already["town"],
                "lat": already["lat"], "lon": already["lon"],
                "locationMunicipality": already.get("locationMunicipality") or already.get("municipality") or "",
                "locationType": already.get("locationType") or "existing",
                "locationSource": already.get("locationSource") or already.get("source") or "",
                "mapLocationType": already.get("mapLocationType") or "",
            }, expected)
        else:
            location = discover_for_group(group)

        if not location:
            unresolved.append(org_name(group[0]))
            continue

        resolved_groups += 1
        for candidate in group:
            # Een expliciet aanbodadres nooit vervangen door een generiek groepsadres,
            # ook niet wanneer PDOK het adres nog niet kon geocoderen.
            if candidate.get("address") and candidate.get("town"):
                continue
            before = (
                candidate.get("address"), candidate.get("postcode"), candidate.get("town"),
                candidate.get("lat"), candidate.get("lon"), candidate.get("locationType"), candidate.get("mapLocationType")
            )
            candidate.update({
                "address": location["address"],
                "postcode": location.get("postcode") or "",
                "town": location["town"],
                "lat": location["lat"],
                "lon": location["lon"],
                "locationMunicipality": location.get("locationMunicipality") or "",
                "locationType": location.get("locationType") or ("contact" if len(group) > 1 else "source-address"),
                "locationSource": location.get("locationSource") or "",
                "mapLocationType": location.get("mapLocationType") or "address",
                "addressChecked": today,
            })
            after = (
                candidate.get("address"), candidate.get("postcode"), candidate.get("town"),
                candidate.get("lat"), candidate.get("lon"), candidate.get("locationType")
            )
            if before != after:
                changed += 1

    inv["addressEnrichmentVersion"] = 1
    inv["addressEnrichedAt"] = today
    inv["addressEnrichmentMethod"] = (
        "Adres uit bron-, contact- of locatiepagina; terugval per organisatie; geocode via PDOK Locatieserver; contactadressen buiten het werkgebied krijgen een transparante werkgebied-pin."
    )

    print(f"{resolved_groups}/{len(groups)} organisaties hebben een kaartbaar adres; {changed} aanbodregels bijgewerkt.")
    if unresolved:
        print("Nog zonder kaartbaar adres:", ", ".join(unresolved[:40]))
        if len(unresolved) > 40:
            print(f"... en {len(unresolved) - 40} andere.")

    if not args.dry_run:
        combined = inv.get("candidates", [])
        inv["candidates"] = combined[:base_count]
        extra["candidates"] = combined[base_count:]
        extra["addressEnrichmentVersion"] = inv["addressEnrichmentVersion"]
        extra["addressEnrichedAt"] = inv["addressEnrichedAt"]
        extra["addressEnrichmentMethod"] = inv["addressEnrichmentMethod"]
        dump(INVENTORY, inv)
        dump(EXTRA, extra)

if __name__ == "__main__":
    main()
