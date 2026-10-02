'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    advies: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/><path d="M8 10h8M8 14h5"/>',
    ontmoeten: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
    geld: '<path d="M20 7V5a1 1 0 0 0-1-1H5a3 3 0 0 0 0 6h15v10H5a3 3 0 0 1-3-3V7M20 13h-5v4h5"/>',
    taal: '<path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3ZM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5Z"/>',
    mantelzorg: '<path d="m12 21-9-9a6 6 0 0 1 9-8 6 6 0 0 1 9 8Z"/>',
    vrijwillig: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.advies}</svg>`;
const categories = {
    advies: 'Advies',
    ontmoeten: 'Ontmoeten',
    geld: 'Geldzaken',
    taal: 'Taal / digitaal',
    mantelzorg: 'Mantelzorg',
    vrijwillig: 'Vrijwilligerswerk',
    jeugd: 'Jeugd',
    mentaal: 'Mentale gezondheid',
    vervoer: 'Vervoer',
    bewegen: 'Sport'
};
let state = {
    municipality: '',
    category: '',
    search: '',
    showActiveHere: false,
    selected: null,
    theme: 'wijkwijzer'
};
let map, geo, geoLayer, tileLayer, locations = [], catalog = [], layers = {}, anchors = {}, markerLayer, labelLayer, filtered = [], catalogFiltered = [];
const initialParams = new URLSearchParams(location.search);
function updateAddressBar(url) {
    try {
        history.replaceState(null, '', url);
    } catch {/* Some browsers restrict history updates for downloaded file URLs. */
    }
}
document.body.dataset.theme = 'wijkwijzer';
{
    const u = new URL(location.href);
    if (u.searchParams.has('stijl')) {
        u.searchParams.delete('stijl');
        updateAddressBar(u);
    }
}
function setColorScheme(mode, persist = true) {
    const dark = mode === 'dark';
    document.documentElement.dataset.colorScheme = dark ? 'dark' : 'light';
    const btn = $('color-scheme-toggle');
    if (btn) {
        btn.setAttribute('aria-pressed', String(dark));
        btn.textContent = dark ? 'Licht' : 'Donker';
        btn.setAttribute('aria-label', dark ? 'Schakel lichte modus in' : 'Schakel donkere modus in');
    }
    if (persist) {
        try { localStorage.setItem('sociale-kaart-color-scheme', dark ? 'dark' : 'light'); } catch {}
    }
    if (map) requestAnimationFrame(() => map.invalidateSize({pan:false}));
}
function initialColorScheme() {
    const fromDom = document.documentElement.dataset.colorScheme;
    if (fromDom === 'dark' || fromDom === 'light') return fromDom;
    try {
        const saved = localStorage.getItem('sociale-kaart-color-scheme');
        if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
setColorScheme(initialColorScheme(), false);
$('color-scheme-toggle')?.addEventListener('click', () => {
    setColorScheme(document.documentElement.dataset.colorScheme === 'dark' ? 'light' : 'dark');
});
function bindLegalDialog(buttonId, dialogId) {
    const button = $(buttonId), dialog = $(dialogId);
    if (!button || !dialog) return;
    button.addEventListener('click', () => dialog.showModal());
    dialog.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', e => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
}
bindLegalDialog('privacyBtn', 'privacyDialog');
bindLegalDialog('disclaimerBtn', 'disclaimerDialog');
$('search-icon').innerHTML = icon('search');
$('brand').addEventListener('click', e => {
    e.preventDefault();
    chooseMunicipality('');
}
);
function renderTopics() {
    $('topics').innerHTML = `<button data-category="" aria-pressed="${!state.category}">Alles</button>` + Object.entries(categories).map( ([key,label]) => `<button data-category="${key}" aria-pressed="${key === state.category}">${icon(key)}${label}</button>`).join('');
    $('topics').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        state.category = state.category === b.dataset.category ? '' : b.dataset.category;
        state.selected = null;
        renderTopics();
        render();
    }
    ));
}
renderTopics();
$('municipality').addEventListener('change', e => chooseMunicipality(e.target.value));
$('back').addEventListener('click', () => chooseMunicipality(''));
$('search').addEventListener('input', e => {
    state.search = e.target.value.trim();
    state.selected = null;
    $('clear-search').hidden = !state.search;
    render();
}
);
$('clear-search').addEventListener('click', () => {
    $('search').value = '';
    state.search = '';
    $('clear-search').hidden = true;
    render();
    $('search').focus();
}
);
$('active-here').addEventListener('change', e => {
    state.showActiveHere = e.target.checked;
    state.selected = null;
    render();
}
);
$('basemap').addEventListener('click', () => {
    if (!map)
        return;
    const on = map.hasLayer(tileLayer);
    if (on)
        map.removeLayer(tileLayer);
    else
        tileLayer.addTo(map);
    $('basemap').setAttribute('aria-pressed', String(!on));
    $('basemap').textContent = on ? 'Ondergrond uit' : 'Ondergrond aan';
}
);
function canonicalMunicipality(value) {
    return value === 'Hengelo (O)' ? 'Hengelo' : String(value || '').trim();
}
function servesMunicipality(p, municipality) {
    if (!municipality) return true;
    return canonicalMunicipality(p.municipality) === municipality || (p.serviceMunicipalities || []).some(area => canonicalMunicipality(area) === municipality);
}
function actualMunicipality(p) {
    return canonicalMunicipality(p.locationMunicipality || p.municipality);
}
function isPhysicalLocation(p) {
    return Boolean(
        p &&
        p.physicalLocation === true &&
        p.mapLocationType !== 'service-area' &&
        p.address &&
        p.town &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon)
    );
}
function physicallyInMunicipality(p, municipality) {
    if (!isPhysicalLocation(p)) return false;
    if (!municipality) return true;
    return actualMunicipality(p) === municipality;
}
function offerMunicipalities(offer, group) {
    const own = [...(offer.municipalities || []), offer.municipality]
        .map(canonicalMunicipality)
        .filter(Boolean);
    return [...new Set(own.length ? own : (group.municipalities || []).map(canonicalMunicipality).filter(Boolean))];
}
function offerServesMunicipality(offer, group, municipality) {
    if (!municipality) return true;
    return offerMunicipalities(offer, group).includes(municipality);
}
function chooseMunicipality(name) {
    if (!map)
        return;
    const known = !name || layers[name] || locations.some(p => servesMunicipality(p, name));
    if (!known)
        return;
    state.municipality = name;
    state.selected = null;
    state.showActiveHere = false;
    $('active-here').checked = false;
    $('municipality').value = name;
    const u = new URL(location.href);
    if (name)
        u.searchParams.set('gemeente', name);
    else
        u.searchParams.delete('gemeente');
    updateAddressBar(u);
    fitSelection();
    render();
}
function fitSelection() {
    let bounds = null;
    if (state.municipality && layers[state.municipality])
        bounds = layers[state.municipality].getBounds();
    else if (!state.municipality && geoLayer)
        bounds = geoLayer.getBounds();

    const pts = locations
        .filter(p => physicallyInMunicipality(p, state.municipality) && p.lat >= 51.95 && p.lat <= 52.58 && p.lon >= 6.25 && p.lon <= 7.25)
        .map(p => [p.lat, p.lon]);

    // Alleen echte bezoek-/voorzieningslocaties bepalen het kaartbeeld.
    if (pts.length) {
        const pointBounds = L.latLngBounds(pts);
        if (bounds && bounds.isValid && bounds.isValid())
            bounds.extend(pointBounds);
        else
            bounds = pointBounds;
    }
    if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, {
            paddingTopLeft: [30, 95],
            paddingBottomRight: [35, 75],
            animate: false,
            maxZoom: state.municipality ? 13 : 11
        });
    } else {
        map.setView([52.28, 6.70], 10, {animate: false});
    }
}
function matchedLocations() {
    const q = state.search.toLocaleLowerCase('nl');
    return locations.filter(p => {
        const areaMatch = physicallyInMunicipality(p, state.municipality);
        const categoryMatch = !state.category || (p.tags || []).includes(state.category);
        const text = [
            p.name, p.address, p.postcode, p.town, actualMunicipality(p),
            p.description, p.audience, p.phone, p.email,
            ...(p.subthemes || []), ...(p.tags || []), ...(p.tags || []).map(t => categories[t] || '')
        ].join(' ').toLocaleLowerCase('nl');
        return areaMatch && categoryMatch && (!q || text.includes(q));
    });
}
function offerMatches(offer) {
    const q = state.search.toLocaleLowerCase('nl');
    const categoryMatch = !state.category || offer.category === state.category || (offer.themes || []).includes(state.category) || (offer.tags || []).includes(state.category);
    const text = [offer.title, offer.name, offer.description, offer.audience, offer.access, offer.costs, ...(offer.subthemes || []), ...(offer.tags || []), ...(offer.themes || [])].join(' ').toLocaleLowerCase('nl');
    return categoryMatch && (!q || text.includes(q));
}
function catalogOffersForGroup(group, applyTextFilter = true) {
    const areaOffers = (group.offers || []).filter(offer => offerServesMunicipality(offer, group, state.municipality));
    return applyTextFilter ? areaOffers.filter(offerMatches) : areaOffers;
}
function matchedCatalog() {
    const q = state.search.toLocaleLowerCase('nl');
    return catalog.filter(g => {
        const areaOffers = catalogOffersForGroup(g, false);
        if (!areaOffers.length) return false;
        const offers = areaOffers.filter(offerMatches);
        if (state.category && !offers.length) return false;
        const text = [g.organization, ...offerMunicipalities({}, g), ...(g.categories || [])].join(' ').toLocaleLowerCase('nl');
        return !q || text.includes(q) || offers.length;
    });
}
function catalogOfferSummary(group, max = 3) {
    const areaOffers = catalogOffersForGroup(group, false);
    const matched = areaOffers.filter(offerMatches);
    const q = state.search.toLocaleLowerCase('nl');
    const groupText = [group.organization, ...(group.categories || [])].join(' ').toLocaleLowerCase('nl');
    const pool = matched.length || state.category || (q && !groupText.includes(q)) ? matched : areaOffers;
    const shown = pool.slice(0, max).map(o => o.title || o.name);
    const extra = Math.max(0, pool.length - shown.length);
    return {pool, text: shown.join(' · ') + (extra ? ` · +${extra}` : '')};
}

function render() {
    filtered = matchedLocations();
    catalogFiltered = matchedCatalog();
    const areaName = state.municipality || 'Twente';
    $('results-title').textContent = areaName;
    $('map-title').textContent = areaName;

    const sortedLocations = [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, 'nl')
    );
    const mappedCatalogIds = new Set(sortedLocations.map(p => p.catalogOrganizationId).filter(Boolean));
    const mappedOrganizationNames = new Set(sortedLocations.map(p => String(p.name || '').split(' · ')[0].trim().toLocaleLowerCase('nl')).filter(Boolean));
    const sortedCatalog = catalogFiltered
        .filter(g => !mappedCatalogIds.has(g.id) && !mappedOrganizationNames.has(String(g.organization || '').trim().toLocaleLowerCase('nl')))
        .sort((a, b) => a.organization.localeCompare(b.organization, 'nl'));

    const activeToggle = $('active-here');
    const activeToggleWrap = $('active-area-toggle');
    const activeLabel = $('active-here-label');
    const activeCount = $('active-here-count');
    activeLabel.textContent = `Ook in ${areaName} actief`;
    activeCount.textContent = sortedCatalog.length ? String(sortedCatalog.length) : '';
    activeToggle.disabled = sortedCatalog.length === 0;
    activeToggleWrap.classList.toggle('disabled', sortedCatalog.length === 0);
    if (!sortedCatalog.length && state.showActiveHere) {
        state.showActiveHere = false;
        activeToggle.checked = false;
    }

    $('result-count').textContent = sortedCatalog.length
        ? `${sortedLocations.length} locaties · ${sortedCatalog.length} ook actief`
        : (sortedLocations.length ? `${sortedLocations.length} locaties` : '');

    const locationTitle = state.municipality ? `Locaties in ${areaName}` : 'Fysieke locaties in Twente';
    const locationHtml = sortedLocations.map(p => {
        const meta = [p.town, categories[p.category] || ''].filter(Boolean).join(' · ');
        return `<button class="result-card ${p.id === state.selected ? 'active' : ''}" data-id="${esc(p.id)}"><span class="category-icon">${icon(p.category)}</span><span class="result-body"><span class="result-title">${esc(p.name)}</span><span class="result-address">${esc(meta)}</span></span></button>`;
    }).join('');
    const physicalSection = `<div class="results-section-title"><strong>${esc(locationTitle)}</strong><span>${sortedLocations.length}</span></div>` +
        (locationHtml || '<div class="empty compact">Geen fysieke locaties gevonden met deze filters.</div>');

    const catalogLimit = (state.search || state.category || state.municipality) ? 30 : 12;
    const shownCatalog = sortedCatalog.slice(0, catalogLimit);
    const catalogHtml = shownCatalog.map(g => {
        const summary = catalogOfferSummary(g);
        const category = g.categories?.[0] || 'advies';
        const meta = [`Actief in ${areaName}`, g.offerCount > 1 ? `${g.offerCount} onderdelen` : ''].filter(Boolean).join(' · ');
        return `<button class="result-card catalog-card ${'catalog:' + g.id === state.selected ? 'active' : ''}" data-catalog-id="${esc(g.id)}"><span class="category-icon">${icon(category)}</span><span class="result-body"><span class="result-title">${esc(g.organization)}</span><span class="result-address">${esc(meta)}</span>${summary.text ? `<span class="catalog-match">${esc(summary.text)}</span>` : ''}</span></button>`;
    }).join('');
    const activeSection = state.showActiveHere && sortedCatalog.length
        ? `<div class="results-section-title secondary"><strong>Ook in ${esc(areaName)} actief</strong><span>geen lokale kaartlocatie</span></div>` +
          catalogHtml +
          (sortedCatalog.length > catalogLimit ? '<a class="all-offers-link" href="voorzieningen.html">Alle voorzieningen</a>' : '')
        : '';

    $('results').innerHTML = physicalSection + activeSection;
    $('results').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => showLocation(b.dataset.id, true)));
    $('results').querySelectorAll('[data-catalog-id]').forEach(b => b.addEventListener('click', () => showCatalog(b.dataset.catalogId)));
    $('reset-filters')?.addEventListener('click', () => {
        state.category = '';
        state.search = '';
        state.showActiveHere = false;
        $('active-here').checked = false;
        $('search').value = '';
        $('clear-search').hidden = true;
        renderTopics();
        chooseMunicipality('');
    });
    $('detail').hidden = !state.selected;
    if (map) {
        styleBoundaries();
        renderMarkers();
    }
}
function showCatalog(id) {
    const g = catalog.find(v => v.id === id);
    if (!g) return;
    state.selected = 'catalog:' + id;
    render();
    const d = $('detail');
    d.hidden = false;
    const areaName = state.municipality || 'Twente';
    const summary = catalogOfferSummary(g, 12);
    const offers = summary.pool;
    const offerHtml = offers.slice(0,12).map(o => `<div class="detail-offer"><strong>${esc(o.title || o.name)}</strong>${o.audience ? `<span>Voor: ${esc(o.audience)}</span>` : ''}${o.source ? `<a href="${esc(o.source)}" target="_blank" rel="noopener">Bron</a>` : ''}</div>`).join('');
    const first = offers[0] || (g.offers || [])[0];
    d.innerHTML = `<button class="detail-close" aria-label="Sluiten">×</button><span class="category-icon">${icon(g.categories?.[0] || 'advies')}</span><h2>${esc(g.organization)}</h2><p class="detail-address"><strong>Ook actief in ${esc(areaName)}</strong><br>Deze organisatie heeft binnen deze selectie geen fysieke kaartlocatie.</p><div class="detail-links">${g.primarySource ? `<a class="primary-link" href="${esc(g.primarySource)}" target="_blank" rel="noopener">Website</a>` : ''}<a href="voorzieningen.html">Alle voorzieningen</a></div><div class="detail-offers">${offerHtml}</div>${offers.length > 12 ? `<p class="meta">+${offers.length-12} meer</p>` : ''}${first ? `<p><a href="aanmelden.html?candidate=${encodeURIComponent(first.id)}">Correctie doorgeven</a></p>` : ''}`;
    d.querySelector('.detail-close').addEventListener('click', () => {
        state.selected = null;
        render();
    });
}
function showLocation(id, pan=false) {
    const p = locations.find(v => v.id === id);
    if (!p) return;
    const serviceAreas = (p.serviceMunicipalities && p.serviceMunicipalities.length) ? p.serviceMunicipalities : [p.municipality].filter(Boolean);
    const defaultMunicipality = actualMunicipality(p) || canonicalMunicipality(serviceAreas[0]) || canonicalMunicipality(p.municipality);
    if (!state.municipality && defaultMunicipality) {
        state.municipality = defaultMunicipality;
        $('municipality').value = defaultMunicipality;
        const u = new URL(location.href);
        u.searchParams.set('gemeente', defaultMunicipality);
        updateAddressBar(u);
    }
    state.selected = id;
    render();
    const d = $('detail');
    d.hidden = false;
    const route = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([p.address,p.postcode,p.town].filter(Boolean).join(', '));
    const isContact = ['contact','source-address'].includes(p.locationType);
    const isServiceAreaPin = p.mapLocationType === 'service-area' || (Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat >= 51.95 && p.lat <= 52.58 && p.lon >= 6.25 && p.lon <= 7.25));
    const addressLabel = isContact || isServiceAreaPin ? 'Contactadres' : 'Bezoekadres';
    const locationMunicipality = p.locationMunicipality || p.municipality || '';
    const serviceLine = serviceAreas.length
        ? `<p class="detail-service-area"><strong>Actief in</strong><br>${esc(serviceAreas.join(', '))}</p>`
        : '';
    const locationNote = isServiceAreaPin
        ? '<p class="location-note">De pin op de kaart markeert het werkgebied, niet dit contactadres. Het aanbod is wel beschikbaar in de gekozen gemeente.</p>'
        : isContact
            ? '<p class="location-note">Dit is het contact- of vestigingsadres. De activiteit zelf kan op een andere locatie, in de wijk of bij inwoners thuis plaatsvinden.</p>'
            : '';
    const routeLink = (!isContact && !isServiceAreaPin) ? `<a href="${route}" target="_blank" rel="noopener">Route</a>` : '';
    d.innerHTML = `<button class="detail-close" aria-label="Locatie sluiten">×</button><span class="category-icon">${icon(p.category)}</span><h2>${esc(p.name)}</h2>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p class="detail-address"><strong>${addressLabel}</strong><br>${esc(p.address)}${p.postcode ? ` · ${esc(p.postcode)}` : ''}<br>${esc(p.town)}</p>${locationNote}<div class="detail-links"><a class="primary-link" href="${esc(p.source)}" target="_blank" rel="noopener">Website</a>${routeLink}</div><div class="detail-extra">${[["Voor wie", p.audience], ["Kosten", p.costs], ["Toegang", p.access], ["Telefoon", p.phone], ["E-mail", p.email]].filter(([,v]) => v).map(([k,v]) => `<p><strong>${k}</strong><br>${esc(v)}</p>`).join('')}${serviceLine}</div><p><a href="aanmelden.html?id=${encodeURIComponent(p.id)}">Correctie doorgeven</a></p>`;
    d.querySelector('.detail-close').addEventListener('click', () => {
        state.selected = null;
        render();
    });
    if (pan && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        map.setView(markerCoords(p), 14, {animate: false});
        if (window.innerWidth <= 760)
            $('map').scrollIntoView({behavior: 'smooth', block: 'start'});
    }
}
function styleBoundaries() {
    const style = getComputedStyle(document.body)
      , primary = style.getPropertyValue('--primary').trim()
      , accent = style.getPropertyValue('--accent').trim()
      , fill = style.getPropertyValue('--mapfill').trim();
    Object.entries(layers).forEach( ([name,layer]) => {
        const selected = name === state.municipality;
        layer.setStyle({
            color: selected ? primary : accent,
            weight: selected ? 3 : 1.4,
            opacity: selected ? 1 : state.municipality ? .35 : .75,
            fillColor: fill,
            fillOpacity: selected ? .15 : state.municipality ? .05 : .38
        });
        if (selected)
            layer.bringToFront();
    }
    );
}
function centroid(feature) {
    const polys = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    let biggest = null
      , bigArea = -1;
    for (const poly of polys) {
        const ring = poly[0];
        let area = 0
          , x = 0
          , y = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            const [ax,ay] = ring[i]
              , [bx,by] = ring[i + 1]
              , v = ax * by - bx * ay;
            area += v;
            x += (ax + bx) * v;
            y += (ay + by) * v;
        }
        if (Math.abs(area) > bigArea) {
            bigArea = Math.abs(area);
            biggest = [y / (3 * area), x / (3 * area)];
        }
    }
    return biggest;
}
function makeMarker(coords, html, className, size, label) {
    return L.marker(coords, {
        icon: L.divIcon({
            className,
            html,
            iconSize: size,
            iconAnchor: [size[0] / 2, size[1] / 2]
        }),
        keyboard: true,
        title: label,
        alt: label
    });
}
function markerCoords(p) {
    const outsideTwente = Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat >= 51.95 && p.lat <= 52.58 && p.lon >= 6.25 && p.lon <= 7.25);
    if (p.mapLocationType === 'service-area' || outsideTwente) {
        const areas = (p.serviceMunicipalities && p.serviceMunicipalities.length) ? p.serviceMunicipalities : [p.municipality].filter(Boolean);
        const preferred = state.municipality && areas.includes(state.municipality) ? state.municipality : areas[0];
        if (preferred && anchors[preferred]) return anchors[preferred];
    }
    return [p.lat, p.lon];
}
function renderMarkers() {
    if (!map)
        return;
    markerLayer.clearLayers();
    labelLayer.clearLayers();
    const counts = {};
    filtered.forEach(p => {
        const areas = (p.serviceMunicipalities && p.serviceMunicipalities.length) ? p.serviceMunicipalities : [p.municipality];
        [...new Set(areas.filter(Boolean))].forEach(name => counts[name] = (counts[name] || 0) + 1);
    });
    const regional = !state.municipality && map.getZoom() < 12 && Object.keys(anchors).length > 0;
    Object.entries(anchors).forEach( ([name,center]) => {
        if (state.municipality && name !== state.municipality && map.getZoom() > 12)
            return;
        const label = makeMarker(center, `<span>${esc(name)}</span>`, 'municipal-label ' + (state.municipality === name ? 'selected' : ''), [145, 18], name);
        label.options.interactive = false;
        label.options.keyboard = false;
        labelLayer.addLayer(label);
        if (regional && counts[name]) {
            const pt = map.latLngToLayerPoint(center).add([0, 27])
              , pos = map.layerPointToLatLng(pt);
            const m = makeMarker(pos, `<span class="cluster-button">${counts[name]}</span>`, 'cluster-icon', [34, 34], `${name}: ${counts[name]} voorzieningen met een kaartbaar adres`);
            m.on('click', () => chooseMunicipality(name));
            m.on('keypress', e => {
                if (e.originalEvent.key === 'Enter')
                    chooseMunicipality(name)
            }
            );
            markerLayer.addLayer(m);
        }
    }
    );
    if (regional)
        return;
    const groups = [];
    filtered.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).forEach(p => {
        const coords = markerCoords(p);
        const pt = map.latLngToLayerPoint(coords);
        let g = groups.find(g => g.point.distanceTo(pt) < 38);
        if (!g) {
            g = {
                point: pt,
                items: []
            };
            groups.push(g);
        }
        g.items.push(p);
    }
    );
    groups.forEach(g => {
        const items = g.items;
        if (items.length === 1) {
            const p = items[0];
            const m = makeMarker(markerCoords(p), `<span class="point-button ${state.selected === p.id ? 'active' : ''}">${icon(p.category)}</span>`, 'cluster-icon', [32, 32], p.name);
            m.bindTooltip(esc(p.name), {
                direction: 'top',
                offset: [0, -14]
            });
            m.on('click', () => showLocation(p.id));
            markerLayer.addLayer(m);
        } else {
            const coords = items.map(markerCoords);
            const lat = coords.reduce((s, p) => s + p[0], 0) / coords.length
              , lon = coords.reduce((s, p) => s + p[1], 0) / coords.length;
            const m = makeMarker([lat, lon], `<span class="cluster-button">${items.length}</span>`, 'cluster-icon', [34, 34], `${items.length} locaties, klik om te bekijken`);
            m.on('click', () => {
                const b = L.latLngBounds(items.map(markerCoords));
                if (map.getZoom() < 17 && b.getNorthEast().distanceTo(b.getSouthWest()) > 40) {
                    map.fitBounds(b, {
                        padding: [65, 75],
                        maxZoom: 17,
                        animate: false
                    });
                    return;
                }
                state.selected = null;
                const d = $('detail');
                d.hidden = false;
                d.innerHTML = `<button class="detail-close" aria-label="Sluiten">×</button><h2>${items.length} voorzieningen hier</h2>` + items.map(p => `<button class="result-card" data-id="${p.id}"><span class="category-icon">${icon(p.category)}</span><span class="result-body"><span class="result-title">${esc(p.name)}</span><span class="result-address">${esc(p.address)}</span></span></button>`).join('');
                d.querySelector('.detail-close').onclick = () => d.hidden = true;
                d.querySelectorAll('[data-id]').forEach(b => b.onclick = () => showLocation(b.dataset.id));
            }
            );
            markerLayer.addLayer(m);
        }
    }
    );
}
async function loadJson(url) {
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok)
        throw Error(`${response.status} ${response.statusText}`);
    return response.json();
}
function normalizeTwenteGeo(data) {
    const wanted = new Set(['Almelo','Borne','Dinkelland','Enschede','Haaksbergen','Hellendoorn','Hengelo','Hof van Twente','Losser','Oldenzaal','Rijssen-Holten','Tubbergen','Twenterand','Wierden']);
    const features = (data && Array.isArray(data.features) ? data.features : []).filter(f => {
        const p = f.properties || {};
        const name = p.naam || p.name || p.gemeentenaam || p.GM_NAAM || p.gemeente;
        if (!wanted.has(name))
            return false;
        p.naam = name;
        f.properties = p;
        return true;
    });
    return features.length === 14 ? {type: 'FeatureCollection', features} : null;
}
async function loadTwenteGeo() {
    // V6: de 14 Twentse gemeentegrenzen zitten lokaal in het project.
    // Geen PDOK/andere externe grens-API meer tijdens het openen van de kaart.
    const normalized = normalizeTwenteGeo(await loadJson('twente.geojson'));
    if (!normalized)
        throw Error('Het lokale twente.geojson bevat niet exact de 14 Twentse gemeenten.');
    return normalized;
}

async function init() {
    try {
        if (window.TWENTE_EMBEDDED_DATA) {
            ({geo, locations} = window.TWENTE_EMBEDDED_DATA);
        } else {
            // Beide bronnen zijn lokaal; laad ze tegelijk voor een snelle start.
            [locations, geo, catalog] = await Promise.all([
                loadJson('data/facilities.json'),
                loadTwenteGeo(),
                loadJson('data/catalog.json')
            ]);
        }
        const names = ['Almelo','Borne','Dinkelland','Enschede','Haaksbergen','Hellendoorn','Hengelo','Hof van Twente','Losser','Oldenzaal','Rijssen-Holten','Tubbergen','Twenterand','Wierden']
            .filter(n => !geo || geo.features.some(f => f.properties.naam === n) || locations.some(p => p.municipality === n))
            .sort((a,b) => a.localeCompare(b, 'nl'));
        names.forEach(n => {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = n;
            $('municipality').append(o);
        });
        if (typeof L === 'undefined')
            throw Error('De interactieve kaart kon niet worden geladen. De lijst blijft beschikbaar.');
        map = L.map('map', {
            zoomControl: false,
            scrollWheelZoom: true,
            zoomSnap: .25,
            minZoom: 8,
            maxZoom: 18
        });
        L.control.zoom({
            position: 'topright'
        }).addTo(map);
        L.control.scale({
            position: 'bottomleft',
            imperial: false
        }).addTo(map);
        // Hersteld naar de oorspronkelijke kaartopbouw: PDOK BRT-A grijs als ondergrond.
        // Geen CARTO/OpenStreetMap-laag en geen API-keyprovider.
        tileLayer = L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png',{
            attribution: 'Ondergrond: <a href="https://www.pdok.nl/introductie/-/article/basisregistratie-topografie-brt-achtergrondkaart">Kadaster / PDOK</a>',
            maxNativeZoom: 19,
            maxZoom: 20,
            opacity: .65
        }).addTo(map);
        if (geo) {
            geoLayer = L.geoJSON(geo, {
                onEachFeature(feature, layer) {
                    const name = feature.properties.naam;
                    layers[name] = layer;
                    anchors[name] = centroid(feature);
                    layer.on('click', () => chooseMunicipality(name));
                    layer.on('mouseover', () => {
                        layer.setStyle({weight: 3, fillOpacity: .45});
                    });
                    layer.on('mouseout', styleBoundaries);
                    layer.on('add', () => {
                        const el = layer.getElement();
                        if (el) {
                            el.setAttribute('tabindex', '0');
                            el.setAttribute('role', 'button');
                            el.setAttribute('aria-label', 'Bekijk gemeente ' + name);
                            el.addEventListener('keydown', e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    chooseMunicipality(name);
                                }
                            });
                        }
                    });
                }
            }).addTo(map);
        } else {
            console.warn('Officiële gemeentegrenzen zijn niet bereikbaar; locatiepunten blijven wel beschikbaar.');
        }
        markerLayer = L.layerGroup().addTo(map);
        labelLayer = L.layerGroup().addTo(map);
        map.on('zoomend moveend', renderMarkers);
        let timer;
        new ResizeObserver( () => {
            clearTimeout(timer);
            timer = setTimeout( () => {
                map.invalidateSize({
                    pan: false
                });
            }
            , 100)
        }
        ).observe($('map'));
        chooseMunicipality(names.includes(initialParams.get('gemeente')) ? initialParams.get('gemeente') : '');
        if (document.modelContext?.registerTool) {
            try {
                void Promise.resolve(document.modelContext.registerTool({
                    name: 'filter_sociale_kaart',
                    title: 'Filter de sociale kaart',
                    description: 'Kies een gemeente en onderwerp in de sociale kaart. Retourneert kaartlocaties en organisaties uit de broncatalogus.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            gemeente: {
                                type: 'string',
                                enum: ['', ...names]
                            },
                            onderwerp: {
                                type: 'string',
                                enum: ['', ...Object.keys(categories)]
                            }
                        },
                        additionalProperties: false
                    },
                    annotations: {
                        readOnlyHint: false,
                        untrustedContentHint: false
                    },
                    execute(input) {
                        if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['gemeente', 'onderwerp'].includes(k)) || input.gemeente !== undefined && !['', ...names].includes(input.gemeente) || input.onderwerp !== undefined && !['', ...Object.keys(categories)].includes(input.onderwerp))
                            throw Error('Ongeldige gemeente of onderwerp');
                        state.category = input.onderwerp || '';
                        state.search = '';
                        $('search').value = '';
                        state.showActiveHere = false;
                        $('active-here').checked = false;
                        renderTopics();
                        chooseMunicipality(input.gemeente || '');
                        return {
                            gemeente: state.municipality,
                            locaties: filtered.map(p => ({
                                naam: p.name,
                                adres: p.address,
                                plaats: p.town,
                                bron: p.source
                            })),
                            organisaties: catalogFiltered.slice(0, 50).map(g => ({
                                naam: g.organization,
                                gemeenten: g.municipalities,
                                aanbod: g.offerCount,
                                bron: g.primarySource
                            }))
                        };
                    }
                })).catch( () => {}
                );
            } catch {}
        }
    } catch (error) {
        $('map-error').hidden = false;
        $('map-error').textContent = error.message + ' Vernieuw de pagina om opnieuw te proberen.';
        render();
    }
}
init();
