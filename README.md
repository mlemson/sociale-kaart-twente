# Sociale kaart Twente — GitHub Pages versie

Deze repository combineert de nieuwste v10-interface/inventarisatie met de sterkste offline onderdelen uit de tweede export. De openbare kaart is aangepast zodat hij ook onder een GitHub Pages project-URL werkt, bijvoorbeeld `https://GEBRUIKER.github.io/sociale-kaart-twente/`.

## Wat werkt op GitHub Pages

- interactieve kaart, gemeentegrenzen, zoeken, filters en detailkaarten;
- 35 gepubliceerde kaartlocaties uit de nieuwste herstelkopie;
- inventarisatie met 247 bronvermeldingen;
- Leaflet volledig lokaal in de repository;
- nauwkeuriger `twente.geojson` uit de volledige offline export;
- ExcelJS en Mammoth lokaal meegeleverd (geen CDN-afhankelijkheid);
- GitHub Actions workflow voor Pages-deployment;
- handmatig uitvoerbare workflow **Voorinvulling opnieuw uitvoeren**.

## Belangrijke beperking van GitHub Pages

GitHub Pages serveert alleen statische bestanden. Het kan `server.py`, SQLite of `/api/...` niet uitvoeren. Daarom zijn kaart en inventarisatie volledig statisch gemaakt. **Aanmelden, beheer, goedkeuren, opslaan en bronpagina-verrijking zijn niet server-side actief op de publieke Pages-site.** De formulieren geven daar een duidelijke melding in plaats van stil te falen.

De oorspronkelijke lokale backend staat onder `local-backend/`. Voor een echte publieke beheeromgeving is later een backend nodig (bijvoorbeeld Cloudflare/Supabase/een eigen server) met authenticatie en opslag. Publiceer nooit `data/state.json` wanneer daar contactgegevens in staan.

## Nieuwe repository maken en publiceren

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `sociale-kaart-twente`.
2. Upload de **inhoud** van deze map naar de root van de repository (dus `index.html` direct bovenaan).
3. Zorg dat de standaardbranch `main` heet.
4. Open op GitHub **Settings → Pages → Build and deployment → Source** en kies **GitHub Actions**.
5. Open **Actions → Deploy GitHub Pages**. Na een push start deployment automatisch; je kunt hem ook handmatig starten.

## Lokaal testen

Open een terminal in de repository en start:

```bash
python -m http.server 8000
```

Ga daarna naar `http://localhost:8000/`. Open `index.html` niet rechtstreeks via `file://`, omdat browsers JSON-fetches vanaf lokale bestanden kunnen blokkeren.

## Data bijwerken

De openbare kaart leest kaartlocaties uit `data/facilities.json` en de inventarisatie uit `inventory.json`. De automatische sleutelwoord-voorinvulling kun je lokaal uitvoeren met:

```bash
python tools/enrich_all.py
```

of op GitHub via **Actions → Voorinvulling opnieuw uitvoeren → Run workflow**. Als de workflow inhoudelijk iets verandert, commit de GitHub Actions-bot de bijgewerkte JSON terug naar `main`, waarna Pages opnieuw deployt.

## Bestandskeuze bij samenvoegen

- UI, `app.js`, `portal.js`, CSS en inventarisatie: nieuwste **v10 navigatie/UI** export.
- Gepubliceerde kaartlocaties: nieuwste export (**35**; de oudere export had **33**).
- Gemeentegrenzen: grotere `twente.geojson` uit de **volledig offline** export.
- Lokale browserbibliotheken en Leaflet-assets: uit de volledig offline export.
