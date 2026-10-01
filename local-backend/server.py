#!/usr/bin/env python3
"""Lokale server voor de herstelde Sociale kaart Twente.

Geen ChatGPT Sites-account of credits nodig. De server vervangt lokaal de API
waar de Sites-versie tegen praat en verwerkt inventarisatieregels via enrichment.py.
De 14 Twentse gemeentegrenzen staan lokaal in twente.geojson en worden bij het
openen niet extern opgehaald.
"""
from __future__ import annotations

import json
import mimetypes
import difflib
import queue
import os
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone, date
from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from enrichment import enrich_inventory, enrich_submission_payload, enrich_published
from web_enrichment import WebSourceEnricher

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATE_FILE = DATA / "state.json"
BASE_FACILITIES = DATA / "facilities.base.json"
INVENTORY_FILE = ROOT / "inventory.json"
GEO_CACHE = ROOT / "twente.geojson"
LOCK = threading.RLock()
WEB_LOCK = threading.RLock()
WEB_PROCESS_LOCK = threading.Lock()
WEB_ENRICHER = WebSourceEnricher(DATA / "web-cache.json")
WEB_QUEUE = queue.Queue()
WEB_STATUS = {"running": False, "done": 0, "total": 0, "updated": 0, "failed": 0, "current": "", "queued": 0, "startedAt": "", "finishedAt": "", "lastError": ""}

TWENTE = {
    "Almelo", "Borne", "Dinkelland", "Enschede", "Haaksbergen", "Hellendoorn",
    "Hengelo", "Hof van Twente", "Losser", "Oldenzaal", "Rijssen-Holten",
    "Tubbergen", "Twenterand", "Wierden"
}

PDOK_GEOCODE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def initial_state():
    return {
        "facilities": load_json(BASE_FACILITIES, []),
        "submissions": [],
        "request_keys": {},
        "import_keys": {},
        "last_saved": now_iso(),
    }


def load_state():
    with LOCK:
        state = load_json(STATE_FILE, None)
        if not isinstance(state, dict):
            state = initial_state()
            save_state(state)
        state.setdefault("facilities", [])
        state.setdefault("submissions", [])
        state.setdefault("request_keys", {})
        state.setdefault("import_keys", {})
        return state


def save_state(state):
    with LOCK:
        state["last_saved"] = now_iso()
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATE_FILE)


def save_json_atomic(path: Path, data):
    with LOCK:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)


def get_enriched_inventory(persist=True):
    raw = load_json(INVENTORY_FILE, {"candidates": [], "sources": []})
    enriched = enrich_inventory(raw)
    if persist and enriched != raw:
        save_json_atomic(INVENTORY_FILE, enriched)
    return enriched


def enrich_all_data():
    """Haal bestaande én nieuwe records door dezelfde voorinvulregels."""
    inventory = get_enriched_inventory(persist=True)
    state = load_state()
    changed = False

    facilities = []
    for row in state.get("facilities", []):
        enriched = enrich_published(row)
        facilities.append(enriched)
        changed = changed or enriched != row
    state["facilities"] = facilities

    for submission in state.get("submissions", []):
        old = submission.get("payload") or {}
        new = enrich_submission_payload(old)
        if new != old:
            submission["payload"] = new
            changed = True
    if changed:
        save_state(state)

    return {
        "inventory": len(inventory.get("candidates") or []),
        "facilities": len(state.get("facilities") or []),
        "submissions": len(state.get("submissions") or []),
        "enrichmentVersion": inventory.get("enrichmentVersion", 0),
    }


def request_json(url: str, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "SocialeKaartTwenteLocal/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def get_twente_geojson():
    """Lees de lokaal gebundelde grenzen; nooit netwerkverkeer bij kaartstart."""
    data = load_json(GEO_CACHE, None)
    if not isinstance(data, dict):
        raise RuntimeError("Lokaal twente.geojson ontbreekt of is ongeldig")
    feats = data.get("features") or []
    names = {((f.get("properties") or {}).get("naam")) for f in feats}
    if len(feats) != 14 or names != TWENTE:
        raise RuntimeError("Lokaal twente.geojson bevat niet exact de 14 Twentse gemeenten")
    return data


def geocode(address: str, town: str):
    query = ", ".join(x for x in [address, town] if x).strip()
    if not query:
        return {}
    try:
        qs = urllib.parse.urlencode({"q": query, "fq": "type:adres", "rows": 5})
        data = request_json(PDOK_GEOCODE + "?" + qs, timeout=12)
        docs = (data.get("response") or {}).get("docs") or []
        if not docs:
            return {}
        d = docs[0]
        # centroide_ll is doorgaans 'POINT(lon lat)'
        m = re.search(r"POINT\(([-\d.]+)\s+([-\d.]+)\)", str(d.get("centroide_ll", "")))
        out = {
            "geocodedAddress": d.get("weergavenaam") or query,
            "bagId": d.get("adresseerbaarobject_id") or d.get("id") or "",
            "geocodeSource": PDOK_GEOCODE + "?" + qs,
            "postcode": d.get("postcode") or "",
            "town": d.get("woonplaatsnaam") or "",
            "municipality": d.get("gemeentenaam") or "",
            "street": d.get("straatnaam") or "",
        }
        if m:
            out["lon"] = float(m.group(1))
            out["lat"] = float(m.group(2))
        return out
    except Exception:
        return {}



def _web_status_snapshot():
    with WEB_LOCK:
        status = dict(WEB_STATUS)
        status["queued"] = WEB_QUEUE.qsize()
        return status


def _mark_web_verified_fields(record: dict, fields):
    e = record.setdefault("enrichment", {})
    online = e.setdefault("online", {})
    auto = set(online.get("autoFilled") or [])
    auto.update(fields)
    online["autoFilled"] = sorted(auto)
    review = set(e.get("reviewFields") or [])
    review.update(fields)
    e["reviewFields"] = sorted(review)


def _apply_geocode_prefill(record: dict, *, mode="candidate") -> dict:
    """Normaliseer een automatisch gevonden adres via PDOK, zonder handwerk te overschrijven."""
    if mode == "published" or not record.get("address"):
        return record
    online = ((record.get("enrichment") or {}).get("online") or {})
    if "address" not in set(online.get("autoFilled") or []):
        return record
    geo = geocode(record.get("address", ""), record.get("town", ""))
    if not geo:
        return record
    filled = []
    if not record.get("town") and geo.get("town"):
        record["town"] = geo["town"]
        filled.append("town")
    if not record.get("municipality") and geo.get("municipality") in TWENTE:
        record["municipality"] = geo["municipality"]
        filled.append("municipality")
    if geo.get("postcode"):
        record.setdefault("postcode", geo["postcode"])
    if geo.get("lat") is not None and geo.get("lon") is not None:
        record["lat"], record["lon"] = geo["lat"], geo["lon"]
    record["geocodedAddress"] = geo.get("geocodedAddress", "")
    record["bagId"] = geo.get("bagId", "")
    if filled:
        _mark_web_verified_fields(record, filled)
    return record


def _web_enrich_record(record: dict, *, mode="candidate", force=False) -> dict:
    enriched = WEB_ENRICHER.enrich(record, mode=mode, force=force)
    return _apply_geocode_prefill(enriched, mode=mode)


def _run_web_enrich_all(force=False):
    with WEB_PROCESS_LOCK:
        return _run_web_enrich_all_locked(force=force)


def _run_web_enrich_all_locked(force=False):
    with WEB_LOCK:
        if WEB_STATUS["running"]:
            return
        WEB_STATUS.update({
            "running": True, "done": 0, "total": 0, "updated": 0, "failed": 0,
            "current": "Inventarisatie voorbereiden…", "startedAt": now_iso(),
            "finishedAt": "", "lastError": ""
        })
    try:
        inventory = get_enriched_inventory(persist=False)
        state = load_state()
        candidates = inventory.get("candidates") or []
        facility_rows = state.get("facilities") or []
        pending = [x for x in (state.get("submissions") or []) if x.get("status") == "pending"]
        total = len(candidates) + len(facility_rows) + len(pending)
        with WEB_LOCK:
            WEB_STATUS["total"] = total

        dirty_inventory = False
        dirty_state = False
        processed_since_save = 0

        for idx, row in enumerate(candidates):
            name = row.get("name") or f"inventarisatieregel {idx + 1}"
            with WEB_LOCK:
                WEB_STATUS["current"] = name
            old = json.dumps(row, ensure_ascii=False, sort_keys=True)
            new = _web_enrich_record(row, mode="candidate", force=force)
            candidates[idx] = new
            changed = json.dumps(new, ensure_ascii=False, sort_keys=True) != old
            dirty_inventory = dirty_inventory or changed
            online = ((new.get("enrichment") or {}).get("online") or {})
            with WEB_LOCK:
                WEB_STATUS["done"] += 1
                WEB_STATUS["updated"] += int(changed)
                WEB_STATUS["failed"] += int(online.get("status") == "mislukt")
            processed_since_save += 1
            if processed_since_save >= 10:
                if dirty_inventory:
                    save_json_atomic(INVENTORY_FILE, inventory)
                    dirty_inventory = False
                processed_since_save = 0

        for idx, row in enumerate(facility_rows):
            name = row.get("name") or f"kaartlocatie {idx + 1}"
            with WEB_LOCK:
                WEB_STATUS["current"] = name
            old = json.dumps(row, ensure_ascii=False, sort_keys=True)
            new = _web_enrich_record(row, mode="published", force=force)
            facility_rows[idx] = new
            changed = json.dumps(new, ensure_ascii=False, sort_keys=True) != old
            dirty_state = dirty_state or changed
            online = ((new.get("enrichment") or {}).get("online") or {})
            with WEB_LOCK:
                WEB_STATUS["done"] += 1
                WEB_STATUS["updated"] += int(changed)
                WEB_STATUS["failed"] += int(online.get("status") == "mislukt")

        for sub in pending:
            row = sub.get("payload") or {}
            name = row.get("name") or sub.get("id") or "melding"
            with WEB_LOCK:
                WEB_STATUS["current"] = name
            old = json.dumps(row, ensure_ascii=False, sort_keys=True)
            new = _web_enrich_record(row, mode="candidate", force=force)
            sub["payload"] = new
            changed = json.dumps(new, ensure_ascii=False, sort_keys=True) != old
            dirty_state = dirty_state or changed
            online = ((new.get("enrichment") or {}).get("online") or {})
            with WEB_LOCK:
                WEB_STATUS["done"] += 1
                WEB_STATUS["updated"] += int(changed)
                WEB_STATUS["failed"] += int(online.get("status") == "mislukt")

        inventory["candidates"] = candidates
        if dirty_inventory or candidates:
            save_json_atomic(INVENTORY_FILE, inventory)
        state["facilities"] = facility_rows
        if dirty_state:
            save_state(state)
    except Exception as exc:
        with WEB_LOCK:
            WEB_STATUS["lastError"] = str(exc)
    finally:
        with WEB_LOCK:
            WEB_STATUS["running"] = False
            WEB_STATUS["current"] = ""
            WEB_STATUS["finishedAt"] = now_iso()


def start_web_enrich_all(force=False):
    with WEB_LOCK:
        if WEB_STATUS["running"]:
            return False
        WEB_STATUS["running"] = True
        # De worker zet de overige velden direct daarna; deze vlag voorkomt dubbele starts.
    def run():
        with WEB_LOCK:
            WEB_STATUS["running"] = False
        _run_web_enrich_all(force=force)
    threading.Thread(target=run, daemon=True, name="web-enrichment-all").start()
    return True


def _web_enrich_submission(sid: str):
    # Eén webverrijkingsproces tegelijk voorkomt dat twee achtergrondtaken elkaars
    # state.json/inventory.json overschrijven.
    with WEB_PROCESS_LOCK:
        state = load_state()
        sub = next((x for x in state.get("submissions", []) if x.get("id") == sid and x.get("status") == "pending"), None)
        if not sub:
            return
        old = sub.get("payload") or {}
        sub["payload"] = _web_enrich_record(old, mode="candidate", force=False)
        save_state(state)


def _web_queue_worker():
    while True:
        sid = WEB_QUEUE.get()
        try:
            _web_enrich_submission(sid)
        except Exception as exc:
            print("Bronverrijking melding mislukt:", sid, exc)
        finally:
            WEB_QUEUE.task_done()


def enqueue_web_submission(sid: str):
    WEB_QUEUE.put(sid)


def make_submission_id():
    return "ST-" + datetime.now().strftime("%Y%m%d") + "-" + secrets.token_hex(3).upper()


def sanitize_facility(v: dict):
    keys = ["name", "municipality", "category", "address", "town", "source", "description", "audience", "costs", "access", "openingHours", "phone", "email", "candidateId"]
    out = {k: str(v.get(k, "") or "").strip() for k in keys}
    return out


_MATCH_STOPWORDS = {
    "de", "het", "een", "en", "van", "voor", "bij", "in", "op", "aan", "met",
    "stichting", "organisatie", "enschede", "twente", "locatie", "centrum"
}


def _match_norm(value: str) -> str:
    value = str(value or "").lower().strip()
    value = value.replace("&", " en ")
    value = re.sub(r"https?://(www\\.)?", "", value)
    value = re.sub(r"[^a-z0-9à-ÿ]+", " ", value, flags=re.I)
    return re.sub(r"\\s+", " ", value).strip()


def _match_tokens(value: str):
    return {x for x in _match_norm(value).split() if len(x) > 1 and x not in _MATCH_STOPWORDS}


def _source_host(value: str) -> str:
    try:
        parsed = urllib.parse.urlparse(str(value or "").strip())
        return (parsed.hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def _candidate_facility(row: dict) -> dict:
    municipalities = row.get("municipalities") or []
    municipality = row.get("municipality") or (municipalities[0] if len(municipalities) == 1 else "")
    return sanitize_facility({
        "name": row.get("name", ""),
        "municipality": municipality,
        "category": row.get("category", ""),
        "address": row.get("address", ""),
        "town": row.get("town", ""),
        "source": row.get("source", ""),
        "description": row.get("description", ""),
        "audience": row.get("audience", ""),
        "costs": row.get("costs", ""),
        "access": row.get("access", ""),
        "openingHours": row.get("openingHours", ""),
        "phone": row.get("phone", ""),
        "email": row.get("email", ""),
        "candidateId": row.get("id", ""),
    })


def _merge_facility_data(base: dict, incoming: dict) -> dict:
    """Combineer twee records zonder bruikbare bestaande velden weg te gooien.

    De geïmporteerde regel wint als die voor een veld expliciet informatie bevat.
    Lege importvelden laten de reeds bekende waarde staan. De beheerder ziet de
    resulterende wijzigingsmelding daarna nog steeds vóór publicatie.
    """
    merged = sanitize_facility(base or {})
    new = sanitize_facility(incoming or {})
    for key, value in new.items():
        if value:
            merged[key] = value
    return enrich_submission_payload(merged)


def _duplicate_score(a: dict, b: dict):
    an, bn = _match_norm(a.get("name")), _match_norm(b.get("name"))
    if not an or not bn:
        return 0.0, []
    seq = difflib.SequenceMatcher(None, an, bn).ratio()
    at, bt = _match_tokens(an), _match_tokens(bn)
    union = at | bt
    jaccard = len(at & bt) / len(union) if union else 0.0
    name_strength = max(seq, jaccard)
    score = seq * 0.54 + jaccard * 0.26
    reasons = []
    exact_name = an == bn
    if exact_name:
        score = max(score, 0.92)
        reasons.append("dezelfde naam")
    elif seq >= 0.82 or jaccard >= 0.75:
        reasons.append("sterk gelijkende naam")

    aa, ba = _match_norm(a.get("address")), _match_norm(b.get("address"))
    exact_address = bool(aa and ba and aa == ba)
    if exact_address:
        score += 0.24
        reasons.append("hetzelfde adres")

    am = _match_norm(a.get("municipality") or a.get("town"))
    bm = _match_norm(b.get("municipality") or b.get("town"))
    same_area = bool(am and bm and am == bm)
    if same_area:
        score += 0.02

    # Een algemene organisatie-URL of centraal telefoon/e-mailadres is géén
    # zelfstandig duplicaatbewijs: Alifa/Humanitas/Wijkteams gebruiken dezelfde
    # contactgegevens voor veel verschillende diensten. Deze signalen tellen
    # daarom alleen mee als de namen óók al redelijk op elkaar lijken.
    asrc, bsrc = str(a.get("source") or "").strip(), str(b.get("source") or "").strip()
    if name_strength >= 0.48 and asrc and bsrc and _match_norm(asrc) == _match_norm(bsrc):
        score += 0.04
        reasons.append("dezelfde bron")
    elif name_strength >= 0.60:
        ah, bh = _source_host(asrc), _source_host(bsrc)
        if ah and bh and ah == bh:
            score += 0.01

    ap, bp = _match_norm(a.get("phone")), _match_norm(b.get("phone"))
    same_phone = bool(ap and bp and ap == bp)
    if same_phone and name_strength >= 0.48:
        score += 0.05
        reasons.append("hetzelfde telefoonnummer")

    ae, be = _match_norm(a.get("email")), _match_norm(b.get("email"))
    same_email = bool(ae and be and ae == be)
    if same_email and name_strength >= 0.48:
        score += 0.06
        reasons.append("hetzelfde e-mailadres")

    same_category = bool(a.get("category") and b.get("category") and a.get("category") == b.get("category"))
    if same_category and name_strength >= 0.45:
        score += 0.015

    score = min(1.0, score)
    qualifies = (
        exact_name
        or (exact_address and (seq >= 0.55 or jaccard >= 0.38))
        or score >= 0.90
    )
    return (score if qualifies else 0.0), reasons


def _duplicate_pool(state: dict):
    pool = []
    published_candidate_ids = {str(f.get("candidateId") or "") for f in state.get("facilities", []) if f.get("candidateId")}
    for f in state.get("facilities", []):
        pool.append({"type": "facility", "id": str(f.get("id") or ""), "record": sanitize_facility(f), "status": "Op de kaart"})
    for sub in state.get("submissions", []):
        if sub.get("status") != "pending":
            continue
        payload = sub.get("payload") or {}
        pool.append({"type": "pending", "id": str(sub.get("id") or ""), "record": sanitize_facility(payload), "status": "Al te beoordelen"})
    inv = get_enriched_inventory(persist=False)
    claimed = {str((s.get("payload") or {}).get("candidateId") or "") for s in state.get("submissions", []) if s.get("status") == "pending"}
    for c in inv.get("candidates") or []:
        cid = str(c.get("id") or "")
        if not cid or cid in published_candidate_ids or cid in claimed:
            continue
        pool.append({"type": "inventory", "id": cid, "record": _candidate_facility(c), "status": "Inventarisatie"})
    return pool


def find_import_duplicates(rows, state: dict):
    """Zoek waarschijnlijk dubbele records, inclusief dubbelen binnen hetzelfde importbestand."""
    base_pool = _duplicate_pool(state)
    earlier_rows = []
    results = []
    for index, raw in enumerate(rows):
        fac = sanitize_facility(raw if isinstance(raw, dict) else {})
        if not fac.get("name"):
            earlier_rows.append(fac)
            continue
        matches = []
        for item in base_pool:
            score, reasons = _duplicate_score(fac, item["record"])
            if not score:
                continue
            rec = item["record"]
            matches.append({
                "type": item["type"], "id": item["id"], "name": rec.get("name", ""),
                "municipality": rec.get("municipality", ""), "address": rec.get("address", ""),
                "town": rec.get("town", ""), "category": rec.get("category", ""),
                "source": rec.get("source", ""), "status": item["status"],
                "score": round(score, 3), "confidence": "sterk" if score >= 0.84 else "waarschijnlijk",
                "reasons": reasons or ["sterke overeenkomst in naam en gegevens"],
            })
        for previous_index, previous in enumerate(earlier_rows):
            if not previous.get("name"):
                continue
            score, reasons = _duplicate_score(fac, previous)
            if not score:
                continue
            matches.append({
                "type": "batch", "id": f"batch:{previous_index}", "batchIndex": previous_index,
                "name": previous.get("name", ""), "municipality": previous.get("municipality", ""),
                "address": previous.get("address", ""), "town": previous.get("town", ""),
                "category": previous.get("category", ""), "source": previous.get("source", ""),
                "status": "Eerdere regel in dit bestand", "score": round(score, 3),
                "confidence": "sterk" if score >= 0.84 else "waarschijnlijk",
                "reasons": reasons or ["sterke overeenkomst in naam en gegevens"],
            })
        matches.sort(key=lambda x: (-x["score"], 0 if x["type"] == "facility" else 1 if x["type"] == "pending" else 2))
        if matches:
            results.append({"index": index, "matches": matches[:3]})
        earlier_rows.append(fac)
    return results


def _new_import_submission(state: dict, fac: dict, file_name: str, *, kind="new", facility_id="", message=""):
    fac = enrich_submission_payload(sanitize_facility(fac))
    fac["importNeedsReview"] = True
    sid = make_submission_id()
    while any(x.get("id") == sid for x in state["submissions"]):
        sid = make_submission_id()
    state["submissions"].append({
        "id": sid,
        "kind": kind,
        "facility_id": facility_id,
        "payload": fac,
        "organization": "Bestandsimport",
        "contact_name": "—",
        "contact_email": "—",
        "message": message or f"Geïmporteerd uit {file_name or 'bestand'}; volledig controleren.",
        "status": "pending",
        "created_at": now_iso(),
        "review_note": "",
    })
    return sid


def import_candidates(state):
    out = []
    for s in state.get("submissions", []):
        if s.get("status") != "pending" or not (s.get("payload") or {}).get("importNeedsReview"):
            continue
        p = s.get("payload") or {}
        m = p.get("municipality", "")
        row = dict(p)
        row.update({
            "id": "import-" + s["id"],
            "sourceTitle": "Bestandsimport",
            "municipalities": [m] if m else (p.get("municipalities") or []),
            "category": p.get("category") or (p.get("enrichment") or {}).get("suggestedCategory") or "",
            "accessStatus": "imported",
            "access": p.get("access") or "Nog volledig controleren vóór publicatie.",
            "scope": "Bestandsimport",
            "status": "candidate",
            "imported": True,
        })
        out.append(row)
    return out


class Handler(SimpleHTTPRequestHandler):
    server_version = "SocialeKaartTwenteLocal/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def json_response(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def error_json(self, message, status=400):
        self.json_response({"error": message}, status)

    def read_body(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 12_000_000:
                raise ValueError("Verzoek te groot")
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            raise ValueError("Ongeldige JSON") from e

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/facilities":
            return self.json_response(load_state()["facilities"])
        if path == "/api/import-candidates":
            return self.json_response(import_candidates(load_state()))
        if path == "/inventory.json":
            return self.json_response(get_enriched_inventory(persist=True))
        if path == "/api/session":
            return self.json_response({"authenticated": True, "admin": True, "local": True})
        if path == "/api/admin/web-enrichment-status":
            return self.json_response(_web_status_snapshot())
        if path == "/api/admin/submissions":
            status = urllib.parse.parse_qs(parsed.query).get("status", ["pending"])[0]
            rows = [s for s in load_state()["submissions"] if s.get("status") == status]
            rows.sort(key=lambda s: s.get("created_at", ""), reverse=True)
            return self.json_response(rows)
        if path == "/twente.geojson":
            try:
                return self.json_response(get_twente_geojson())
            except Exception as e:
                return self.error_json(str(e), 502)
        if path in ("/signin-with-chatgpt", "/signout-with-chatgpt"):
            self.send_response(302)
            self.send_header("Location", "/beheer")
            self.end_headers()
            return

        aliases = {
            "/": ROOT / "index.html",
            "/voorzieningen": ROOT / "voorzieningen" / "index.html",
            "/voorzieningen/": ROOT / "voorzieningen" / "index.html",
            "/aanmelden": ROOT / "aanmelden" / "index.html",
            "/aanmelden/": ROOT / "aanmelden" / "index.html",
            "/beheer": ROOT / "beheer" / "index.html",
            "/beheer/": ROOT / "beheer" / "index.html",
        }
        if path in aliases:
            return self.serve_file(aliases[path])

        # Alleen bestanden binnen ROOT serveren.
        if path == "/data/state.json":
            self.send_error(403)
            return

        rel = Path(urllib.parse.unquote(path).lstrip("/"))
        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            self.send_error(403)
            return
        if target.is_file():
            return self.serve_file(target)
        self.send_error(404)

    def serve_file(self, path: Path):
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if path.suffix in (".js", ".css", ".html", ".json", ".geojson"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        if path.name in {"state.json"}:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            body = self.read_body()
        except ValueError as e:
            return self.error_json(str(e), 400)

        if path == "/api/submissions":
            if body.get("websiteTrap"):
                return self.error_json("Melding kon niet worden verwerkt.", 400)
            key = str(body.get("requestKey") or "")
            state = load_state()
            if key and key in state.get("request_keys", {}):
                return self.json_response({"id": state["request_keys"][key]})
            facility = enrich_submission_payload(sanitize_facility(body.get("facility") or {}))
            if not facility.get("name"):
                return self.error_json("Vul de naam van de voorziening in.")
            sid = make_submission_id()
            row = {
                "id": sid,
                "kind": body.get("kind") if body.get("kind") in {"new", "change", "remove"} else "new",
                "facility_id": str(body.get("facilityId") or ""),
                "payload": facility,
                "organization": str(body.get("organization") or ""),
                "contact_name": str(body.get("contactName") or ""),
                "contact_email": str(body.get("contactEmail") or ""),
                "message": str(body.get("message") or ""),
                "status": "pending",
                "created_at": now_iso(),
                "review_note": "",
            }
            state["submissions"].append(row)
            if key:
                state.setdefault("request_keys", {})[key] = sid
            save_state(state)
            enqueue_web_submission(sid)
            return self.json_response({"id": sid}, 201)

        if path == "/api/admin/import-duplicates":
            rows = body.get("rows") or []
            if not isinstance(rows, list):
                return self.error_json("Ongeldige importregels.")
            rows = rows[:500]
            state = load_state()
            return self.json_response({"duplicates": find_import_duplicates(rows, state), "checked": len(rows)})

        if path == "/api/admin/import":
            rows = body.get("rows") or []
            if not isinstance(rows, list) or not rows:
                return self.error_json("Geen regels ontvangen.")
            rows = [dict(x) for x in rows[:500] if isinstance(x, dict)]
            state = load_state()
            file_name = str(body.get("fileName") or "bestand")
            import_key = str(body.get("importKey") or "").strip()
            if import_key and import_key in state.get("import_keys", {}):
                return self.json_response(state["import_keys"][import_key], 200)

            # Batch-samenvoegingen eerst toepassen: de latere dubbele regel vult de
            # eerder gekozen regel aan en wordt daarna niet apart geïmporteerd.
            batch_skipped = set()
            for i, raw in enumerate(rows):
                if raw.get("duplicateDecision") != "merge" or raw.get("duplicateMatchType") != "batch":
                    continue
                match_id = str(raw.get("duplicateMatchId") or "")
                try:
                    target = int(match_id.split(":", 1)[1])
                except Exception:
                    return self.error_json(f"Ongeldige samenvoegkeuze bij regel {i + 1}.", 409)
                if target < 0 or target >= i or target >= len(rows):
                    return self.error_json(f"Ongeldige samenvoegdoelregel bij regel {i + 1}.", 409)
                merged = _merge_facility_data(rows[target], raw)
                # Bewaar de keuze van de doelregel; de inhoud wordt wel samengevoegd.
                for key in ("duplicateDecision", "duplicateMatchType", "duplicateMatchId"):
                    if rows[target].get(key):
                        merged[key] = rows[target][key]
                rows[target] = merged
                batch_skipped.add(i)

            analyses = {x["index"]: x for x in find_import_duplicates(rows, state)}
            unresolved = []
            for i, raw in enumerate(rows):
                if i in batch_skipped or not str(raw.get("name") or "").strip():
                    continue
                finding = analyses.get(i)
                if not finding:
                    continue
                decision = raw.get("duplicateDecision")
                if decision not in {"merge", "skip", "new"}:
                    unresolved.append(finding)
                    continue
                if decision == "merge":
                    mtype = str(raw.get("duplicateMatchType") or "")
                    mid = str(raw.get("duplicateMatchId") or "")
                    valid = any(m.get("type") == mtype and str(m.get("id")) == mid for m in finding.get("matches") or [])
                    if not valid and mtype != "batch":
                        unresolved.append(finding)
            if unresolved:
                return self.json_response({
                    "error": "Er zijn mogelijke dubbelen waarvoor nog geen geldige keuze is gemaakt.",
                    "duplicates": unresolved,
                }, 409)

            imported = 0
            skipped = len(batch_skipped)
            merged_count = len(batch_skipped)
            imported_ids = []
            merged_pending_ids = []
            facility_groups = {}
            inventory_groups = {}

            for i, raw in enumerate(rows):
                if i in batch_skipped:
                    continue
                fac = enrich_submission_payload(sanitize_facility(raw))
                if not fac.get("name"):
                    continue
                decision = raw.get("duplicateDecision")
                mtype = str(raw.get("duplicateMatchType") or "")
                mid = str(raw.get("duplicateMatchId") or "")

                if decision == "skip":
                    skipped += 1
                    continue

                if decision == "merge" and mtype == "facility":
                    current = next((x for x in state.get("facilities", []) if str(x.get("id")) == mid), None)
                    if not current:
                        return self.error_json(f"De gekozen bestaande voorziening voor {fac['name']} bestaat niet meer.", 409)
                    entry = facility_groups.setdefault(mid, sanitize_facility(current))
                    facility_groups[mid] = _merge_facility_data(entry, fac)
                    continue

                if decision == "merge" and mtype == "pending":
                    sub = next((x for x in state.get("submissions", []) if str(x.get("id")) == mid and x.get("status") == "pending"), None)
                    if not sub:
                        return self.error_json(f"De gekozen melding voor {fac['name']} bestaat niet meer.", 409)
                    sub["payload"] = _merge_facility_data(sub.get("payload") or {}, fac)
                    sub["payload"]["importNeedsReview"] = True
                    sub["message"] = (sub.get("message") or "") + f" | Samengevoegd met import uit {file_name}."
                    merged_count += 1
                    merged_pending_ids.append(sub["id"])
                    continue

                if decision == "merge" and mtype == "inventory":
                    inventory_groups[mid] = _merge_facility_data(inventory_groups.get(mid, {}), fac)
                    continue

                # Geen match, of bewust 'Als nieuw toevoegen'.
                sid = _new_import_submission(
                    state, fac, file_name,
                    message=(f"Geïmporteerd uit {file_name}; bewust als nieuwe voorziening toegevoegd ondanks mogelijke overeenkomst."
                             if decision == "new" else f"Geïmporteerd uit {file_name}; volledig controleren."),
                )
                imported += 1
                imported_ids.append(sid)

            # Eén wijzigingsmelding per bestaande kaartvoorziening, ook als meerdere
            # regels uit hetzelfde bestand ermee zijn samengevoegd.
            for fid, fac in facility_groups.items():
                current = next((x for x in state.get("facilities", []) if str(x.get("id")) == fid), {})
                merged = _merge_facility_data(current, fac)
                sid = _new_import_submission(
                    state, merged, file_name, kind="change", facility_id=fid,
                    message=f"Import uit {file_name} samengevoegd met bestaande kaartvoorziening; controleer de voorgestelde wijziging.",
                )
                imported += 1
                merged_count += 1
                imported_ids.append(sid)

            for candidate_id, fac in inventory_groups.items():
                inv = get_enriched_inventory(persist=False)
                candidate = next((x for x in (inv.get("candidates") or []) if str(x.get("id")) == candidate_id), None)
                base = _candidate_facility(candidate or {})
                merged = _merge_facility_data(base, fac)
                merged["candidateId"] = candidate_id
                sid = _new_import_submission(
                    state, merged, file_name,
                    message=f"Import uit {file_name} samengevoegd met bestaande inventarisatieregel {candidate_id}; één concept aangemaakt.",
                )
                imported += 1
                merged_count += 1
                imported_ids.append(sid)

            result = {
                "imported": imported,
                "merged": merged_count,
                "skipped": skipped,
                "webQueued": len(set(imported_ids + merged_pending_ids)),
            }
            if import_key:
                state.setdefault("import_keys", {})[import_key] = result
            save_state(state)
            for sid in dict.fromkeys(imported_ids + merged_pending_ids):
                enqueue_web_submission(sid)
            return self.json_response(result, 201)

        if path == "/api/admin/review":
            sid = str(body.get("id") or "")
            action = body.get("action")
            if action not in {"approve", "reject"}:
                return self.error_json("Onbekende beoordeling.")
            state = load_state()
            sub = next((s for s in state["submissions"] if s.get("id") == sid), None)
            if not sub:
                return self.error_json("Melding niet gevonden.", 404)
            if sub.get("status") != "pending":
                return self.error_json("Deze melding is al beoordeeld.", 409)
            note = str(body.get("note") or "")
            if action == "reject":
                sub["status"] = "rejected"
                sub["review_note"] = note
                sub["reviewed_at"] = now_iso()
                save_state(state)
                return self.json_response({"ok": True})

            if sub.get("kind") != "remove" and body.get("confirmed") is not True:
                return self.error_json("Bevestig eerst dat bron, adres en toegankelijkheid zijn gecontroleerd.")

            facilities = state["facilities"]
            if sub.get("kind") == "remove":
                fid = sub.get("facility_id")
                state["facilities"] = [f for f in facilities if f.get("id") != fid]
            else:
                f = sanitize_facility(body.get("facility") or {})
                required = ["name", "municipality", "category", "address", "town", "source", "description"]
                missing = [k for k in required if not f.get(k)]
                if missing:
                    return self.error_json("Vul alle verplichte voorzieningsvelden in: " + ", ".join(missing))
                old = next((x for x in facilities if x.get("id") == sub.get("facility_id")), None)
                fid = old.get("id") if old else "local-" + secrets.token_hex(6)
                revision = int((old or {}).get("revision", 0)) + (1 if old else 0)
                merged = dict(old or {})
                merged.update(f)
                merged.update({
                    "id": fid,
                    "revision": revision,
                    "status": "published",
                    "accessStatus": "confirmed",
                    "scope": "Lokaal aanbod",
                    "sourceTitle": "Gecontroleerde lokale melding",
                    "municipalities": [f["municipality"]],
                    "tags": list(dict.fromkeys([f["category"], *((old or {}).get("tags") or [])])),
                    "checked": date.today().isoformat(),
                })
                # Alleen opnieuw geocoderen als nodig; bestaande coördinaten blijven anders behouden.
                if not old or old.get("address") != f["address"] or old.get("town") != f["town"]:
                    merged.update(geocode(f["address"], f["town"]))
                merged = enrich_published(merged)
                if old:
                    state["facilities"] = [merged if x.get("id") == fid else x for x in facilities]
                else:
                    state["facilities"].append(merged)

            sub["status"] = "approved"
            sub["review_note"] = note
            sub["reviewed_at"] = now_iso()
            save_state(state)
            return self.json_response({"ok": True})

        if path == "/api/admin/web-enrich-all":
            started = start_web_enrich_all(force=bool(body.get("force")))
            return self.json_response({"started": started, "status": _web_status_snapshot()})

        if path == "/api/admin/enrich-all":
            return self.json_response(enrich_all_data())

        if path == "/api/admin/reset":
            state = initial_state()
            state["facilities"] = [enrich_published(x) for x in state.get("facilities", [])]
            save_state(state)
            return self.json_response({"ok": True, "facilities": len(state["facilities"])})

        self.error_json("Onbekend API-pad.", 404)


def _start_server():
    """Start op een eigen poort en wijk uit als die al bezet is."""
    preferred = int(os.environ.get("PORT", "8877"))
    candidates = [preferred] + [p for p in range(8878, 8901) if p != preferred]
    last_error = None
    for port in candidates:
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), Handler), port
        except OSError as exc:
            last_error = exc
    # Laat het OS als laatste redmiddel zelf een vrije poort kiezen.
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        return server, int(server.server_address[1])
    except OSError:
        raise RuntimeError(f"Geen vrije lokale poort gevonden: {last_error}")


def main():
    os.chdir(ROOT)
    enrichment_stats = enrich_all_data()
    threading.Thread(target=_web_queue_worker, daemon=True, name="web-enrichment-queue").start()
    server, port = _start_server()
    # Cache-buster voorkomt dat een browser een oude localhost-pagina uit cache toont.
    url = f"http://127.0.0.1:{port}/?local=twente-sociale-kaart"
    print("\n===============================================")
    print("  SOCIALE KAART TWENTE - LOKALE VERSIE")
    print("===============================================")
    print(f"Projectmap : {ROOT}")
    print(f"Lokale poort: {port}")
    print("Voorinvulling:", f"{enrichment_stats['inventory']} inventarisatieregels + {enrichment_stats['facilities']} kaartlocaties")
    print("Open       :", url)
    print("Stoppen    : Ctrl+C")
    print("===============================================\n")
    try:
        threading.Timer(0.7, lambda: webbrowser.open_new_tab(url)).start()
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer gestopt.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
