# Sociale kaart Twente — GitHub Pages

Deze repository bevat de publieke Sociale kaart Twente en een lokale beheeromgeving. De publieke site is statisch en geschikt voor GitHub Pages.

## Huidige opzet

De kaart maakt bewust onderscheid tussen **kaartlocaties** en **aanbod uit bronnen**:

- `data/facilities.json`: concrete locaties met adres en coördinaten voor de kaart;
- `data/catalog.json`: organisaties met hun onderliggende activiteiten en vormen van ondersteuning;
- `inventory.json`: broninventarisatie waaruit de catalogus wordt opgebouwd;
- `data/review-queue.json`: alleen de uitzonderingen die echt menselijke aandacht nodig hebben.

Op dit moment worden 247 bronvermeldingen gegroepeerd tot ongeveer 85 organisaties. De automatische basiscontrole markeert 228 vermeldingen als brononderbouwd en 19 als aandachtspunt. Deze aantallen veranderen mee met de inventarisatie.

### Waarom deze structuur?

Een organisatie als Alifa hoeft niet twintig keer als losse kaartpin te verschijnen. De kaart kan één organisatie/locatie tonen, terwijl zoeken wel alle onderliggende vormen van aanbod vindt. Zo blijft de interface rustig zonder informatie weg te gooien.

## Controle zonder handmatig alles af te lopen

De oude werkwijze vroeg impliciet om vrijwel iedere bronvermelding handmatig te controleren. Dat is vervangen door een uitzonderingenmodel:

- **Brononderbouwd**: naam, gebied en bron zijn aanwezig en de automatische indeling bevat geen conflict.
- **Handmatig gecontroleerd**: een concrete kaartlocatie die al expliciet is gecontroleerd.
- **Aandacht nodig**: bron of kerngegevens ontbreken, of automatische bronindeling spreekt bestaande gegevens tegen.

De aandachtlijst wordt gegenereerd door:

```bash
python tools/build_catalog.py
```

Daarmee worden ook de publieke JSON-bestanden opnieuw opgebouwd.

> Brononderbouwd betekent niet dat openingstijden, kosten of beschikbaarheid voor altijd correct zijn. De detailpagina verwijst daarom altijd naar de aanbieder als actuele bron.

## GitHub Pages

De repository bevat `.github/workflows/pages.yml`. Stel bij **Settings → Pages → Build and deployment → Source** GitHub Actions in. Een push naar `main` publiceert de site vervolgens automatisch.

De publieke site gebruikt Leaflet 1.9.4 via unpkg en PDOK voor de kaartondergrond. Alle eigen data, JavaScript en styling staan in deze repository.

## Automatische controles

`.github/workflows/validate.yml` controleert bij pushes en pull requests:

- JavaScript-syntax;
- geldige JSON/GeoJSON;
- of `tools/build_catalog.py` exact reproduceerbare data oplevert;
- of de voor GitHub Pages benodigde bestanden aanwezig zijn.

`.github/workflows/enrich.yml` bouwt de afgeleide catalogus en aandachtlijst iedere maandag opnieuw en kan ook handmatig worden gestart.

## Lokaal testen

Gebruik een lokale webserver; open de bestanden niet rechtstreeks via `file://` omdat browsers lokale JSON-fetches kunnen blokkeren.

```bash
python -m http.server 8000
```

Open daarna `http://localhost:8000/`.

## Beheer

GitHub Pages kan geen Python-server, SQLite of schrijf-API uitvoeren. Aanmelden, importeren, goedkeuren en server-side bronverrijking zijn daarom niet actief op de publieke Pages-site.

Een deel van de oorspronkelijke lokale backend is teruggevonden onder `local-backend/`, maar het oude transportarchief was afgekapt en ondersteunende Python-modules ontbreken. Beschouw deze map daarom als referentiemateriaal, niet als een werkende beheeromgeving. Voor een latere publieke beheeromgeving is een nieuwe backend nodig, bijvoorbeeld Supabase, Cloudflare of een eigen server met authenticatie.

## Belangrijkste bestanden

- `index.html`, `app.js`, `style.css` — openbare kaart en zoekervaring;
- `voorzieningen.html`, `portal.js`, `portal.css` — volledige voorzieningen-/organisatiecatalogus;
- `inventory.json` — broninventarisatie;
- `tools/build_catalog.py` — bouwt publieke data en aandachtlijst;
- `twente.geojson` — gemeentegrenzen;
- `local-backend/` — gedeeltelijk hersteld referentiemateriaal van de oude lokale redactieomgeving.
