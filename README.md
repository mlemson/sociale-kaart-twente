# Sociale kaart Twente — GitHub Pages

Deze repository bevat de publieke Sociale kaart Twente. De openbare site is statisch en geschikt voor GitHub Pages.

## Opzet

De kaart maakt onderscheid tussen **aanbod**, **organisaties** en **kaartpunten**:

- `inventory.json` bevat de broninventarisatie met afzonderlijke vormen van voorliggend aanbod;
- `data/catalog.json` groepeert dat aanbod per organisatie;
- `data/facilities.json` bevat de kaartbare bezoek-, contact- en vestigingslocaties;
- `data/review-queue.json` bevat alleen uitzonderingen die menselijke aandacht nodig hebben.

Een organisatie hoeft daardoor niet voor iedere activiteit een aparte kaartpin te krijgen. Zoeken doorzoekt wél het volledige onderliggende aanbod.

## Adressen automatisch achterhalen

`tools/enrich_addresses.py` probeert voor iedere organisatie een bruikbaar adres te vinden:

1. een bestaand bezoek- of uitvoeringsadres;
2. een adres op de officiële bronpagina;
3. een contact-, locatie- of vestigingspagina op hetzelfde domein;
4. een eerder bekend contactadres van dezelfde organisatie.

Het gevonden adres wordt gegeocodeerd via de **PDOK Locatieserver**. Daarna bouwt `tools/build_catalog.py` de kaartdata opnieuw op.

Als een regionale voorziening alleen een contactadres buiten het eigen werkgebied heeft, blijft het echte contactadres zichtbaar in het detailvenster. De kaart gebruikt dan een **werkgebied-pin** in de gekozen Twentse gemeente, zodat bijvoorbeeld een provinciaal fonds met kantoor in Zwolle niet ten onrechte als voorziening in Zwolle wordt gepresenteerd.

## Controle zonder alles handmatig af te lopen

De redactionele workflow is gebaseerd op uitzonderingen:

- **Brononderbouwd** — duidelijke officiële/lokale bron, kerngegevens en een kaartbare locatie;
- **Handmatig gecontroleerd** — een concrete locatie die expliciet is nagekeken;
- **Aandacht nodig** — bron, kerngegevens of locatie ontbreekt, of er is een inhoudelijk conflict.

De kaart verwijst bij aanbod altijd terug naar de bron, omdat openingstijden, voorwaarden, bedragen en beschikbaarheid kunnen wijzigen.

**Laatste automatische adrescontrole (1 oktober 2026):** 105 organisaties, 281 aanbodregels en 129 kaartlocaties; alle 281 aanbodregels hebben een adres en geocodeerde coördinaten.

## Nieuwe bronnen toevoegen

Voeg een aanbodregel toe aan `inventory.json` met minimaal naam, bron, gemeente(n), onderwerp en een korte beschrijving. Een adres mag worden meegegeven, maar hoeft geen coördinaten te hebben.

Bij wijzigingen in `inventory.json` start `.github/workflows/enrich.yml` automatisch:

```
bron → adres zoeken → PDOK geocoderen → catalogus bouwen → kaartdata opslaan
```

De workflow draait daarnaast iedere maandag en kan handmatig worden gestart.

## Presentatie

De publieke website gebruikt één vaste stijl onder de naam **Sociale Kaart Twente**. De eerdere ontwerpvarianten Wijkteams, Online Hulp, Gemeente Enschede en Wijkwijzer zijn niet meer als schakelbare stijlen zichtbaar.

De interface houdt alleen functionele tekst over. Privacy, disclaimer en contact staan compact in de footer.

Externe algemene contactadressen worden niet buiten Twente als kaartpin getoond. De adresverrijker zoekt eerst naar een lokale locatie. Is alleen een landelijk of provinciaal contactadres beschikbaar, dan blijft dat echte adres in de detailinformatie staan en wordt de pin in het relevante Twentse werkgebied geplaatst.

## Dark mode

De openbare kaart en de voorzieningen-, aanmeld- en beheerpagina's hebben een **Donker/Licht**-schakelaar. De keuze wordt lokaal in de browser onthouden. Bij een eerste bezoek volgt de site de systeemvoorkeur van de gebruiker.

De donkere kaart dimt de PDOK-ondergrond en houdt gemeentegrenzen, pins en labels leesbaar. De website gebruikt één vaste visuele stijl, gebaseerd op de eerdere Wijkwijzer-richting.

## GitHub Pages

`.github/workflows/pages.yml` publiceert de statische site vanaf `main`. Gebruik bij **Settings → Pages → Build and deployment** de bron **GitHub Actions**.

De site gebruikt Leaflet 1.9.4 en PDOK voor de kaartondergrond.

## Automatische controles

`.github/workflows/validate.yml` controleert bij pushes en pull requests:

- JavaScript-syntax;
- geldige JSON en GeoJSON;
- of de catalogusgenerator zonder fouten kan draaien;
- unieke en geldige kaartcoördinaten;
- aanwezigheid van de vereiste GitHub Pages-bestanden.

De validatie vereist niet dat gegenereerde JSON al vóór de adresworkflow is bijgewerkt; de verrijkingsworkflow schrijft die afgeleide bestanden terug.

## Lokaal testen

Open de site via een lokale webserver, niet rechtstreeks via `file://`:

```bash
python -m http.server 8000
```

Open daarna `http://localhost:8000/`.

## Beheer

GitHub Pages zelf heeft geen Python-server, SQLite of schrijf-API. De huidige openbare site en broncatalogus werken volledig statisch. Voor een toekomstige openbare redactieomgeving met accounts en wijzigingen is een aparte backend nodig.

Een deel van de oude lokale backend staat nog onder `local-backend/` als referentiemateriaal.

## Belangrijkste bestanden

- `index.html`, `app.js`, `style.css` — kaart, zoeken en dark mode;
- `voorzieningen.html`, `portal.js`, `portal.css` — volledige catalogus;
- `inventory.json` — broninventarisatie;
- `tools/enrich_addresses.py` — adresherkenning en PDOK-geocodering;
- `tools/build_catalog.py` — organisatiegroepering en kaartdata;
- `twente.geojson` — grenzen van de 14 Twentse gemeenten.
