# Sociale kaart Twente — lokale herstelkopie

Dit project is gemaakt uit de bestanden en gegevens die uit de huidige `chatgpt.site`-versie konden worden teruggehaald. Voor het draaien en bewerken van deze kopie zijn **geen ChatGPT Sites-credits** nodig.

## Snel starten op Windows

1. Pak de ZIP uit.
2. Dubbelklik op `start-local.bat`.
3. De browser opent normaal automatisch op `http://127.0.0.1:8877/` (of een andere vrije poort die in het zwarte venster staat).
4. Laat het zwarte venster open zolang je de site gebruikt.
5. Stoppen kan met `Ctrl+C` of door het venster te sluiten.

Als `py` of `python` niet wordt gevonden, installeer Python 3 via python.org en vink bij de installatie `Add Python to PATH` aan.

## Wat is uit de live site teruggehaald?

De volgende onderdelen zijn rechtstreeks uit de door jou aangeleverde/live bestanden overgenomen:

- `style.css` — hoofdopmaak van de kaart;
- `app.js` — logica van kaart, filters, thema's en details;
- `portal.js` — inventarisatie, aanmelden, beheer en bestandsimport;
- `leaflet.js` en `leaflet.css` — Leaflet 1.9.4;
- `data/original-export-2026-09-16.json` — de gedownloade inventarisatie;
- 35 gecontroleerde/gepubliceerde kaartlocaties;
- 247 broninventarisatie-vermeldingen;
- de HTML-opbouw van Inventarisatie, Aanmelden en Beheer;
- de portal-opmaak is gereconstrueerd uit de door jou geplakte `portal.css`.

`source-original/` bevat kopieën van de ruwe aangeleverde bestanden zodat je altijd terug kunt naar het bronmateriaal.

## Wat is gereconstrueerd?

De live Sites-backend kon niet als bronbestand worden geëxporteerd. Daarom staat er `server.py` in deze kopie. Die vervangt lokaal de API-routes die `app.js` en `portal.js` verwachten.

Ook de exacte bron-HTML van de hoofdpagina was niet als los bestand aangeleverd. `index.html` is daarom opnieuw opgebouwd rond de **originele CSS en JavaScript** en gebruikt dezelfde IDs/classes die `app.js` verwacht. De functies en vormgeving sluiten daardoor zo nauw mogelijk aan bij de huidige live versie.

## Gegevens en beheer

Lokale wijzigingen worden opgeslagen in:

`data/state.json`

Daarin staan ook contactgegevens uit nieuwe lokale aanmeldingen. Dit bestand wordt door de lokale server **niet openbaar geserveerd**. Maak er wel zelf back-ups van als je de site actief gaat beheren.

De lokale beheeromgeving is bewust direct toegankelijk op:

`http://127.0.0.1:8765/beheer`

Dat is veilig zolang `server.py` alleen op `127.0.0.1` draait. **Zet deze Python-server niet rechtstreeks openbaar op internet** zonder echte authenticatie en een database.

## Gemeentegrenzen / kaart

De 14 Twentse gemeentegrenzen staan lokaal in `twente.geojson`. Daardoor wacht de site bij het openen niet op een externe grens-API. De grijze achtergrondkaart wordt via PDOK geladen; daarvoor is internet nodig.

## Bestand importeren

In `/beheer` kun je:

- CSV direct uitlezen;
- Excel (`.xlsx`) uitlezen via ExcelJS;
- Word (`.docx`) uitlezen via Mammoth.

Voor Excel en Word worden bibliotheken vanaf jsDelivr geladen. CSV werkt zonder die twee bibliotheken.

## Bestanden bewerken

Open de map in bijvoorbeeld Visual Studio Code. De belangrijkste bestanden zijn:

- `index.html` — hoofdpagina;
- `style.css` — kaartvormgeving;
- `app.js` — kaartgedrag;
- `voorzieningen/index.html` — inventarisatie;
- `aanmelden/index.html` — formulier;
- `beheer/index.html` — beheeromgeving;
- `portal.css` — opmaak van deze drie pagina's;
- `portal.js` — logica van deze drie pagina's;
- `server.py` — lokale backend/API;
- `data/facilities.base.json` — oorspronkelijke 35 kaartlocaties;
- `inventory.json` — 247 bronvermeldingen en bronoverzicht;
- `data/state.json` — actuele lokale werkstand.

## Herstellen naar de aangeleverde kaartlocaties

Verwijder `data/state.json` en start `server.py` opnieuw. De server maakt dan een nieuwe werkstand vanuit `data/facilities.base.json`.


## V7: automatische voorinvulling en controlehulp

`enrichment.py` bevat één centrale, uitlegbare set sleutelwoordregels. Bij het starten worden de bestaande inventarisatie en werkstand opnieuw verwerkt. Ook nieuwe bestandsimports en nieuwe aanmeldingen gaan automatisch door dezelfde regels.

De voorinvulling kan onder andere voorstellen of aanvullen:

- primair onderwerp en meerdere relevante thema's;
- gemeente wanneer die eenduidig bekend is;
- doelgroep bij duidelijke woorden zoals jongeren, mantelzorg, senioren of nieuwkomers;
- kosten of toegang alleen wanneer woorden als `gratis`, `vrij toegankelijk`, `zonder indicatie` of `op afspraak` dit expliciet ondersteunen;
- zoeklabels/subthema's en een lijst met velden die nog gecontroleerd moeten worden.

De bestaande waarde wordt niet stilzwijgend vervangen wanneer de automatische classificatie iets anders denkt. Zo'n verschil wordt als **themaconflict** gemarkeerd. In Beheer staat daarnaast de knop **Voorinvulling opnieuw uitvoeren**. Handmatig kan hetzelfde met `python enrich_all.py`.

De automatische voorinvulling is nadrukkelijk voorwerk. Bron, adres, actuele toegang, kosten en openingstijden blijven controlepunten vóór publicatie.

## Later openbaar hosten

De kaart/front-end kan zonder ChatGPT Sites worden gehost. Voor `Aanmelden` en `Beheer` is voor een echte openbare productieversie wel een backend met beveiligde login en database nodig. De Python-backend in deze herstelkopie is bedoeld voor lokaal gebruik en ontwikkeling.


## Poort
Deze herstelde versie gebruikt standaard **127.0.0.1:8877** in plaats van 8765. Als 8877 al bezet is, kiest `server.py` automatisch een vrije poort tussen 8878 en 8900 (en anders een door Windows toegewezen vrije poort). Kijk in het zwarte servervenster voor de exacte URL.

## Kaartlaag / PDOK (v3-fix)
De lokale versie gebruikt de actuele BRT-Achtergrondkaart via `https://service.pdok.nl/brt/achtergrondkaart/...` en gewone Leaflet-zoomniveaus (`9`, niet `09`). De voorzieningen worden nu los van de gemeentegrenzen geladen. Als de lokale Python-server PDOK niet kan bereiken, probeert de browser de officiële gemeentegrenzen rechtstreeks bij PDOK op te halen. Daardoor verdwijnen de voorzieningen niet meer wanneer alleen de grens-API tijdelijk niet bereikbaar is.


## V6: gemeentegrenzen lokaal

De kaart wacht bij het openen niet meer op een externe GeoJSON/API-aanvraag. `twente.geojson` bevat precies de 14 Twentse gemeenten en wordt lokaal door `server.py` geserveerd. Daardoor verdwijnt de eerdere 502/time-out op `/twente.geojson`. De PDOK BRT-A grijze achtergrondkaart uit V5 is verder ongewijzigd gebleven.

De meegeleverde grensgeometrie is een compacte 2026-webcartografieversie (gesimplificeerd). Voor zeer nauwkeurige GIS-toepassingen kan later een ongegeneraliseerde BRK/PDOK-export in hetzelfde `twente.geojson`-bestand worden gezet zonder de rest van de site te wijzigen.

## V8 – automatische bronpagina-verrijking

In **Beheer** staat nu de knop **Bronpagina’s automatisch uitlezen**. Deze verwerkt alle
bestaande inventarisatieregels, kaartlocaties en openstaande meldingen op de achtergrond.
De kaart zelf hoeft hier niet op te wachten.

De bronverrijking probeert, voor zover de publieke website dit betrouwbaar ondersteunt,
alvast te vinden:

- concrete omschrijving van het aanbod;
- bezoekadres, postcode en plaats (met PDOK-normalisatie wanneer mogelijk);
- thema’s/subthema’s en doelgroep;
- kosten of expliciete gratis-vermelding;
- toegang, inloop/afspraak/aanmelding en expliciete indicatie-/verwijzingsinformatie;
- openingstijden of spreekuren;
- publiek telefoonnummer en e-mailadres;
- een specifiekere aanbodpagina wanneer de opgegeven bron alleen een algemene homepage is.

Automatisch gevonden velden worden **niet als gecontroleerd beschouwd**. In Beheer blijven
ze bij **Nog controleren** staan en per veld wordt bronbewijs getoond. Bestaande handmatig
ingevulde waarden worden niet stilletjes overschreven.

Nieuwe aanmeldingen en bestandsimports met een website worden automatisch in een
achtergrondwachtrij gezet voor dezelfde broncontrole. Pagina’s worden maximaal zeven dagen
lokaal gecachet in `data/web-cache.json`, zodat dezelfde website niet steeds opnieuw wordt
belast. De crawler beperkt zich tot publieke HTTP(S)-adressen, respecteert `robots.txt` waar
mogelijk en leest per voorziening maximaal enkele relevante pagina’s.

Als een website tijdelijk niet bereikbaar is, blijft de voorziening gewoon in de
controlelijst staan. Start later opnieuw **Bronpagina’s automatisch uitlezen** om zulke
bronnen nogmaals te proberen.

## V9: dubbele voorzieningen veilig afhandelen bij import

De bestandsimport controleert nieuwe Excel-, CSV- en Word-regels nu vóór opslag op waarschijnlijke dubbelen. De controle vergelijkt naam, adres, gemeente/plaats, bron, telefoon en e-mail met:

- voorzieningen die al op de kaart staan;
- meldingen die al onder **Te beoordelen** staan;
- bestaande inventarisatieregels;
- eerdere regels uit hetzelfde importbestand.

Bij iedere waarschijnlijke dubbel verschijnt een korte vergelijking met drie keuzes:

- **Samenvoegen** — combineert de gegevens. Bij een bestaande kaartvoorziening ontstaat één wijzigingsmelding die nog gecontroleerd en goedgekeurd moet worden. Bij een reeds openstaande melding worden de gegevens in die ene melding gecombineerd. Bij een inventarisatieregel wordt één concept gekoppeld aan die kandidaat.
- **Overslaan** — deze importregel wordt niet toegevoegd.
- **Als nieuw toevoegen** — voegt de regel bewust als afzonderlijke voorziening toe, ook al lijkt er een overeenkomst te zijn.

De server controleert de keuze opnieuw vlak vóór opslag. Een waarschijnlijke dubbel zonder expliciete keuze wordt dus niet stilzwijgend geïmporteerd. De import gebruikt bovendien een import-sleutel zodat een dubbele klik/netwerkretry dezelfde import niet nogmaals uitvoert.
