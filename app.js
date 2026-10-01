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
    advies: 'Advies & hulp',
    ontmoeten: 'Ontmoeten',
    geld: 'Geld & papierwerk',
    taal: 'Taal & digitaal',
    mantelzorg: 'Mantelzorg',
    vrijwillig: 'Vrijwilligerswerk',
    jeugd: 'Jeugd & opvoeden',
    mentaal: 'Mentaal welzijn & herstel',
    vervoer: 'Vervoer & maaltijden',
    bewegen: 'Sport & bewegen'
};
const themes = {
    wijkteams: {
        name: 'Wijkteams',
        sub: 'ENSCHEDE',
        symbol: 'w.',
        eyebrow: 'SAMEN IN TWENTE',
        title: 'Vind je weg naar hulp <em>dichtbij.</em>',
        footer: 'Een ontwerp in de stijl van Wijkteams Enschede'
    },
    online: {
        name: 'Online Hulp',
        sub: 'ENSCHEDE',
        symbol: 'o.',
        eyebrow: 'WAT KUNNEN WE VOOR JE DOEN?',
        title: 'Een beetje hulp. <em>Dicht bij jou.</em>',
        footer: 'Een ontwerp in de stijl van Online Hulp Enschede'
    },
    gemeente: {
        name: 'Enschede',
        sub: 'GEMEENTE',
        symbol: 'E',
        eyebrow: 'WONEN EN LEVEN / SOCIALE KAART',
        title: 'Hulp en ondersteuning <em>in Twente.</em>',
        footer: 'Ontwerprichting voor Gemeente Enschede'
    },
    wijkwijzer: {
        name: 'Wijkwijzer',
        sub: 'ENSCHEDE',
        symbol: 'w↗',
        eyebrow: 'JE BENT WELKOM',
        title: 'Fijn als je weet <em>waar je terechtkunt.</em>',
        footer: 'Wijkwijzer · eigen interpretatie, huisstijl nog te verifiëren'
    }
};
let state = {
    municipality: '',
    category: '',
    search: '',
    nearby: false,
    selected: null,
    theme: 'wijkteams'
};
let map, geo, geoLayer, tileLayer, locations = [], catalog = [], layers = {}, anchors = {}, markerLayer, labelLayer, filtered = [], catalogFiltered = [];
const initialParams = new URLSearchParams(location.search);
function updateAddressBar(url) {
    try {
        history.replaceState(null, '', url);
    } catch {/* Some browsers restrict history updates for downloaded file URLs. */
    }
}
function setTheme(theme) {
    if (!themes[theme])
        return;
    state.theme = theme;
    document.body.dataset.theme = theme;
    const t = themes[theme];
    $('brand').innerHTML = `<span class="brand-symbol">${t.symbol}</span><span>${t.name}<span class="brand-sub">${t.sub}</span></span>`;
    $('brand').href = `?stijl=${theme}`;
    $('eyebrow').textContent = t.eyebrow;
    $('headline').innerHTML = t.title;
    $('footer-brand').textContent = t.footer;
    document.querySelectorAll('.design-options button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
    const u = new URL(location.href);
    u.searchParams.set('stijl', theme);
    updateAddressBar(u);
    if (map) {
        styleBoundaries();
        renderMarkers();
        requestAnimationFrame( () => map.invalidateSize({
            pan: false
        }));
    }
}
setTheme(initialParams.get('stijl') || 'wijkteams');
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
$('search-icon').innerHTML = icon('search');
document.querySelectorAll('.design-options button').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
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
function openInfo() {
    $('info-dialog').showModal();
}
$('about').addEventListener('click', openInfo);
$('coverage').addEventListener('click', openInfo);
$('info-dialog').querySelector('.dialog-close').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('click', e => {
    if (e.target === $('info-dialog')) {
        const r = e.target.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            e.target.close();
    }
}
);
$('municipality').addEventListener('change', e => chooseMunicipality(e.target.value));
$('back').addEventListener('click', () => chooseMunicipality(''));
$('nav-map').addEventListener('click', () => chooseMunicipality(''));
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
$('nearby').addEventListener('change', e => {
    state.nearby = e.target.checked;
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
function servesMunicipality(p, municipality) {
    if (!municipality) return true;
    return p.municipality === municipality || (p.serviceMunicipalities || []).includes(municipality);
}
function chooseMunicipality(name) {
    if (!map)
        return;
    const known = !name || layers[name] || locations.some(p => servesMunicipality(p, name));
    if (!known)
        return;
    state.municipality = name;
    state.selected = null;
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
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (!state.municipality || servesMunicipality(p, state.municipality)))
        .map(p => [p.lat, p.lon]);

    // Een regionaal aanbod kan een contactadres net buiten de gekozen gemeente hebben.
    // Neem zulke adressen mee zodat de pin niet buiten beeld valt.
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
        const areaMatch = !state.municipality || state.nearby || servesMunicipality(p, state.municipality);
        const categoryMatch = !state.category || (p.tags || []).includes(state.category);
        const text = [
            p.name, p.address, p.postcode, p.town, p.municipality, p.locationMunicipality,
            ...(p.serviceMunicipalities || []), p.description, p.audience, p.phone, p.email,
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
function matchedCatalog() {
    const q = state.search.toLocaleLowerCase('nl');
    return catalog.filter(g => {
        const areaMatch = !state.municipality || state.nearby || (g.municipalities || []).includes(state.municipality);
        const offers = (g.offers || []).filter(offerMatches);
        const categoryMatch = !state.category || (g.categories || []).includes(state.category) || offers.length;
        const text = [g.organization, ...(g.municipalities || []), ...(g.categories || [])].join(' ').toLocaleLowerCase('nl');
        const queryMatch = !q || text.includes(q) || offers.length;
        return areaMatch && categoryMatch && queryMatch;
    });
}
function catalogOfferSummary(group, max = 3) {
    const matched = (group.offers || []).filter(offerMatches);
    const pool = (state.search || state.category) ? matched : (group.offers || []);
    const shown = pool.slice(0, max).map(o => o.title || o.name);
    const extra = Math.max(0, pool.length - shown.length);
    return {pool, text: shown.join(' · ') + (extra ? ` · +${extra}` : '')};
}

function render() {
    filtered = matchedLocations();
    catalogFiltered = matchedCatalog();
    $('results-title').textContent = state.municipality ? (state.nearby ? state.municipality + ' & omgeving' : state.municipality) : 'In de regio';
    $('result-count').textContent = `${filtered.length} kaartlocaties · ${catalogFiltered.length} organisaties`;
    $('map-title').textContent = state.municipality || 'Twente';
    $('map-subtitle').textContent = state.municipality ? 'Kaartlocaties én aanbod uit lokale bronnen' : 'Klik op een gemeente of zoek in het volledige aanbod';

    const sortedLocations = [...filtered].sort((a, b) => {
        const av = a.municipality === state.municipality ? -1 : 0,
              bv = b.municipality === state.municipality ? -1 : 0;
        return av - bv || a.name.localeCompare(b.name, 'nl');
    });
    const mappedCatalogIds = new Set(filtered.map(p => p.catalogOrganizationId).filter(Boolean));
    const sortedCatalog = catalogFiltered.filter(g => !mappedCatalogIds.has(g.id)).sort((a,b) => {
        const am = (a.municipalities || []).includes(state.municipality) ? -1 : 0,
              bm = (b.municipalities || []).includes(state.municipality) ? -1 : 0;
        return am - bm || a.organization.localeCompare(b.organization, 'nl');
    });

    const locationHtml = sortedLocations.length
        ? `<div class="results-section"><div class="results-section-title"><strong>Op de kaart</strong><span>${sortedLocations.length}</span></div>${sortedLocations.map(p => `<button class="result-card ${p.id === state.selected ? 'active' : ''}" data-id="${esc(p.id)}"><span class="category-icon">${icon(p.category)}</span><span class="result-body"><span class="result-title">${esc(p.name)}</span><span class="result-address">${esc(p.address)} · ${esc(p.town)}</span><span class="result-tag">${esc(categories[p.category] || 'Sociaal aanbod')}</span></span><span class="result-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>`
        : '';

    const catalogLimit = (state.search || state.category || state.municipality) ? 30 : 12;
    const shownCatalog = sortedCatalog.slice(0, catalogLimit);
    const catalogHtml = shownCatalog.length
        ? `<div class="results-section catalog-section"><div class="results-section-title"><strong>Meer aanbod uit bronnen</strong><span>${sortedCatalog.length}</span></div>${shownCatalog.map(g => {
            const summary = catalogOfferSummary(g);
            const category = g.categories?.[0] || 'advies';
            const status = g.reviewNeeded ? `${g.reviewNeeded} aandachtspunt${g.reviewNeeded === 1 ? '' : 'en'}` : 'Brononderbouwd';
            return `<button class="result-card catalog-card ${'catalog:' + g.id === state.selected ? 'active' : ''}" data-catalog-id="${esc(g.id)}"><span class="category-icon">${icon(category)}</span><span class="result-body"><span class="result-title">${esc(g.organization)}</span><span class="result-address">${esc((g.municipalities || []).join(', ') || 'Twente')} · ${g.offerCount || 0} vormen van aanbod</span>${summary.text ? `<span class="catalog-match">${esc(summary.text)}</span>` : ''}<span class="result-tag ${g.reviewNeeded ? 'needs-review' : ''}">${esc(status)}</span></span><span class="result-arrow" aria-hidden="true">↗</span></button>`;
        }).join('')}${sortedCatalog.length > catalogLimit ? `<a class="all-offers-link" href="voorzieningen.html">Bekijk alle ${sortedCatalog.length} organisaties →</a>` : ''}</div>`
        : '';

    $('results').innerHTML = locationHtml + catalogHtml || '<div class="empty">Nog geen passend aanbod gevonden.<button id="reset-filters">Toon de hele selectie</button></div>';
    $('results').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => showLocation(b.dataset.id, true)));
    $('results').querySelectorAll('[data-catalog-id]').forEach(b => b.addEventListener('click', () => showCatalog(b.dataset.catalogId)));
    $('reset-filters')?.addEventListener('click', () => {
        state.category = '';
        state.search = '';
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
    const summary = catalogOfferSummary(g, 12);
    const offers = summary.pool.length ? summary.pool : (g.offers || []);
    const statusText = g.reviewNeeded
        ? `${g.reviewNeeded} onderdeel${g.reviewNeeded === 1 ? '' : 'en'} met een aandachtspunt; de overige informatie is rechtstreeks aan een bron gekoppeld.`
        : 'Dit aanbod is rechtstreeks gekoppeld aan een lokale of regionale bron. Controleer bij de aanbieder de actuele tijden, kosten en beschikbaarheid.';
    const offerHtml = offers.slice(0,12).map(o => `<div class="detail-offer"><strong>${esc(o.title || o.name)}</strong>${o.audience ? `<span>Voor: ${esc(o.audience)}</span>` : ''}${o.description ? `<span>${esc(o.description)}</span>` : ''}${o.source ? `<a href="${esc(o.source)}" target="_blank" rel="noopener">Bekijk deze bron ↗</a>` : ''}</div>`).join('');
    const first = (g.offers || [])[0];
    d.innerHTML = `<button class="detail-close" aria-label="Sluiten">×</button><span class="category-icon">${icon(g.categories?.[0] || 'advies')}</span><h2>${esc(g.organization)}</h2><p>${esc(statusText)}</p><p class="detail-address">${esc((g.municipalities || []).join(', ') || 'Twente')} · ${g.offerCount || 0} vormen van aanbod</p><div class="detail-links">${g.primarySource ? `<a class="primary-link" href="${esc(g.primarySource)}" target="_blank" rel="noopener">Website / bron ↗</a>` : ''}<a href="voorzieningen.html">Volledige voorzieningenlijst ↗</a></div><div class="detail-offers">${offerHtml}</div>${offers.length > 12 ? `<p class="meta">+${offers.length-12} andere onderdelen; verfijn je zoekopdracht of open de voorzieningenlijst.</p>` : ''}${first ? `<p><a href="aanmelden.html?candidate=${encodeURIComponent(first.id)}">Gegevens aanvullen of wijzigen →</a></p>` : ''}<p class="meta">Bronronde: ${esc(g.checked || 'onbekend')}</p>`;
    d.querySelector('.detail-close').addEventListener('click', () => {
        state.selected = null;
        render();
    });
}

function showLocation(id, pan=false) {
    const p = locations.find(v => v.id === id);
    if (!p) return;
    const serviceAreas = (p.serviceMunicipalities && p.serviceMunicipalities.length) ? p.serviceMunicipalities : [p.municipality].filter(Boolean);
    const defaultMunicipality = serviceAreas[0] || p.municipality;
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
    const addressLabel = isContact ? 'Contact-/vestigingsadres' : 'Bezoekadres';
    const locationMunicipality = p.locationMunicipality || p.municipality || '';
    const serviceLine = serviceAreas.length
        ? `<p class="detail-service-area"><strong>Actief in</strong><br>${esc(serviceAreas.join(', '))}</p>`
        : '';
    const locationNote = isContact
        ? '<p class="location-note">Dit is het contact- of vestigingsadres. De activiteit zelf kan op een andere locatie, in de wijk of bij inwoners thuis plaatsvinden.</p>'
        : '';
    d.innerHTML = `<button class="detail-close" aria-label="Locatie sluiten">×</button><span class="category-icon">${icon(p.category)}</span><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p class="detail-address"><strong>${addressLabel}</strong><br>${esc(p.address)}${p.postcode ? ` · ${esc(p.postcode)}` : ''}<br>${esc(p.town)}${locationMunicipality ? ` · gemeente ${esc(locationMunicipality)}` : ''}</p>${locationNote}<div class="detail-links"><a class="primary-link" href="${esc(p.source)}" target="_blank" rel="noopener">Website & informatie ↗</a><a href="${route}" target="_blank" rel="noopener">Route ↗</a></div><div class="detail-extra">${[["Doelgroep", p.audience], ["Kosten", p.costs], ["Toegang", p.access], ["Openingstijden", p.openingHours], ["Telefoon", p.phone], ["E-mail", p.email]].filter(([,v]) => v).map(([k,v]) => `<p><strong>${k}</strong><br>${esc(v)}</p>`).join('')}${serviceLine}</div><p><a href="aanmelden.html?id=${encodeURIComponent(p.id)}">Wijziging doorgeven →</a></p><p class="meta">Bron geraadpleegd: ${esc(p.checked || 'onbekend')}</p>`;
    d.querySelector('.detail-close').addEventListener('click', () => {
        state.selected = null;
        render();
    });
    if (pan && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        map.setView([p.lat, p.lon], 14, {animate: false});
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
            const m = makeMarker(pos, `<span class="cluster-button">${counts[name]}</span>`, 'cluster-icon', [34, 34], `${name}: ${counts[name]} opgenomen locaties`);
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
    filtered.filter(p => Number.isFinite(p.lat)).forEach(p => {
        const pt = map.latLngToLayerPoint([p.lat, p.lon]);
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
            const m = makeMarker([p.lat, p.lon], `<span class="point-button ${state.selected === p.id ? 'active' : ''}">${icon(p.category)}</span>`, 'cluster-icon', [32, 32], p.name);
            m.bindTooltip(esc(p.name), {
                direction: 'top',
                offset: [0, -14]
            });
            m.on('click', () => showLocation(p.id));
            markerLayer.addLayer(m);
        } else {
            const lat = items.reduce( (s, p) => s + p.lat, 0) / items.length
              , lon = items.reduce( (s, p) => s + p.lon, 0) / items.length;
            const m = makeMarker([lat, lon], `<span class="cluster-button">${items.length}</span>`, 'cluster-icon', [34, 34], `${items.length} locaties, klik om te bekijken`);
            m.on('click', () => {
                const b = L.latLngBounds(items.map(p => [p.lat, p.lon]));
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
        $('coverage-description').textContent = `De kaart bevat ${locations.length} kaartbare voorzieningen en contactlocaties. Daarnaast kun je zoeken in ${catalog.length} organisaties met samen ${catalog.reduce((n,g) => n + (g.offerCount || 0), 0)} vormen van sociaal aanbod. Als een activiteit geen eigen bezoekadres heeft, tonen we het gevonden contact- of vestigingsadres en vermelden we dat expliciet.`;
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
                        state.nearby = false;
                        $('nearby').checked = false;
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
