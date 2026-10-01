'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const municipalities = ['Almelo', 'Borne', 'Dinkelland', 'Enschede', 'Haaksbergen', 'Hellendoorn', 'Hengelo', 'Hof van Twente', 'Losser', 'Oldenzaal', 'Rijssen-Holten', 'Tubbergen', 'Twenterand', 'Wierden'];
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
const definitions = [['name', 'Naam voorziening', 160, true], ['municipality', 'Gemeente', 0, true], ['category', 'Onderwerp', 0, true], ['address', 'Straat en huisnummer', 200, true], ['town', 'Plaats', 100, true], ['source', 'Website met informatie over dit aanbod', 1000, true], ['description', 'Wat kunnen inwoners hier doen?', 2000, true], ['audience', 'Voor wie?', 500], ['costs', 'Kosten', 300], ['access', 'Hoe kun je meedoen? Indicatie of verwijzing nodig?', 500], ['openingHours', 'Openingstijden / spreekuur', 500], ['phone', 'Publiek telefoonnummer', 80], ['email', 'Publiek e-mailadres', 254]];
function fields(target, v={}) {
    target.innerHTML = definitions.map( ([key,label,max,required]) => {
        const attrs = `name="${key}" ${required ? 'required' : ''}`;
        const opts = key === 'municipality' ? municipalities.map(x => [x, x]) : Object.entries(categories);
        let control;
        if (['municipality', 'category'].includes(key))
            control = `<select ${attrs}><option value="">Kies…</option>${opts.map( ([k,t]) => `<option value="${esc(k)}" ${k === v[key] ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
        else if (['description', 'audience', 'access', 'openingHours'].includes(key))
            control = `<textarea ${attrs} maxlength="${max}">${esc(v[key])}</textarea>`;
        else
            control = `<input ${attrs} type="${key === 'source' ? 'url' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}" maxlength="${max}" value="${esc(v[key])}" ${key === 'source' ? 'placeholder="https://…"' : ''}>`;
        return `<label class="field ${['name', 'source', 'description', 'audience', 'access', 'openingHours', 'email'].includes(key) ? 'wide' : ''}">${label}${required ? ' *' : ''}${control}</label>`;
    }
    ).join('');
}
function facilityData(form) {
    return {
        ...Object.fromEntries(definitions.map( ([k]) => [k, form.elements[k].value])),
        candidateId: form.dataset.candidateId || ''
    };
}
function message(id, text, type='notice') {
    const el = $(id);
    el.hidden = !text;
    el.className = 'notice ' + type;
    el.textContent = text;
}
async function api(path, body) {
    // GitHub Pages is statisch: GET-data komt uit bestanden in de repository.
    if (!body) {
        if (path === '/api/facilities') path = 'data/facilities.json';
        else if (path === '/inventory.json') path = 'inventory.json';
        else if (path === '/api/import-candidates') return [];
        else if (path === '/api/session') return {authenticated:false, admin:false, staticHosting:true};
    }
    if (body || path.startsWith('/api/admin/') || path === '/api/submissions') {
        throw Error('Deze openbare GitHub Pages-versie kan geen gegevens opslaan. Gebruik de lokale beheeromgeving uit de repository voor aanmelden, importeren en publiceren.');
    }
    const r = await fetch(path, {cache:'no-store'});
    if (!r.ok) throw Error(`${r.status} ${r.statusText}`);
    return r.json();
}
function safeLink(url, label) {
    try {
        const u = new URL(url);
        if (!['https:', 'http:'].includes(u.protocol))
            return '';
        return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
    } catch {
        return '';
    }
}
function enrichmentLabel(v) {
    const e = v?.enrichment;
    if (!e) return '';
    const themes = (v.themes || []).map(k => categories[k]).filter(Boolean);
    const review = (e.reviewFields || []).length;
    const bits = [];
    if (themes.length) bits.push(`thema${themes.length > 1 ? 's' : ''}: ${themes.join(', ')}`);
    if (e.audienceSuggestion) bits.push(`doelgroep: ${e.audienceSuggestion}`);
    if (e.categoryConflict) bits.push(`thema controleren`);
    bits.push(`${review} veld${review === 1 ? '' : 'en'} nog controleren`);
    return bits.join(' · ');
}
function enrichmentPanel(v) {
    const e = v?.enrichment;
    if (!e) return '';
    const suggested = e.suggestedCategory ? categories[e.suggestedCategory] : '';
    const reasons = (e.categoryReasons || []).join(', ');
    const labels = {municipality:'gemeente',category:'onderwerp',address:'adres',town:'plaats',source:'bron',description:'omschrijving',audience:'doelgroep',costs:'kosten',access:'toegang',openingHours:'openingstijden',phone:'telefoon',email:'e-mail'};
    const review = (e.reviewFields || []).map(k => labels[k] || k);
    const online = e.online || {};
    const onlineAuto = (online.autoFilled || []).map(k => labels[k] || k);
    const sourceSuggestion = online.suggestions?.source ? `<br>Specifiekere bron gevonden: ${safeLink(online.suggestions.source, 'open voorgestelde bron')}` : '';
    const evidence = Object.entries(online.evidence || {}).slice(0, 8).map(([k,x]) => `<li><strong>${esc(labels[k] || k)}:</strong> ${esc(x?.text || '')} ${x?.url ? safeLink(x.url, 'bron') : ''}</li>`).join('');
    const onlineBlock = online.status ? `<div class="online-enrichment"><p><strong>Bronpagina:</strong> ${online.status === 'gelezen' ? `gelezen${online.pages?.length ? ` (${online.pages.length} pagina${online.pages.length === 1 ? '' : '’s'})` : ''}` : esc(online.status)}${online.checkedAt ? ` · ${esc(new Date(online.checkedAt).toLocaleString('nl-NL'))}` : ''}.${onlineAuto.length ? `<br><strong>Automatisch ingevuld uit de bron:</strong> ${esc(onlineAuto.join(', '))}.` : ''}${sourceSuggestion}</p>${online.error ? `<p class="auto-warning">${esc(online.error)}</p>` : ''}${evidence ? `<details><summary>Gevonden aanwijzingen tonen</summary><ul class="evidence-list">${evidence}</ul></details>` : ''}</div>` : '';
    return `<div class="auto-enrichment"><strong>Automatische voorinvulling</strong><p>${suggested ? `Voorgesteld onderwerp: <b>${esc(suggested)}</b> (${esc(e.categoryConfidence || 'onbekend')})${reasons ? ` · herkend: ${esc(reasons)}` : ''}.` : 'Geen betrouwbaar onderwerp uit sleutelwoorden afgeleid.'}${e.audienceSuggestion ? `<br>Voorgestelde doelgroep: ${esc(e.audienceSuggestion)}.` : ''}</p><p><strong>Nog controleren:</strong> ${review.length ? esc(review.join(', ')) : 'geen open automatische controlepunten'}.</p>${e.categoryConflict ? '<p class="auto-warning">Let op: het voorgestelde onderwerp wijkt af van de bestaande indeling. Controleer dit bij de bron.</p>' : ''}${onlineBlock}</div>`;
}

function lock(form, on) {
    form.querySelectorAll('button').forEach(b => b.disabled = on);
}
async function submission() {
    const form = $('submission-form');
    fields($('facility-fields'));
    let data = []
      , key = crypto.randomUUID();
    form.elements.kind.addEventListener('change', () => {
        delete form.dataset.candidateId;
        $('existing-field').hidden = form.elements.kind.value === 'new';
        form.elements.facilityId.required = form.elements.kind.value !== 'new';
    }
    );
    form.elements.facilityId.addEventListener('change', () => {
        delete form.dataset.candidateId;
        const v = data.find(x => x.id === form.elements.facilityId.value);
        if (v)
            fields($('facility-fields'), v);
    }
    );
    try {
        data = await api('/api/facilities');
        form.elements.facilityId.innerHTML += [...data].sort( (a, b) => a.name.localeCompare(b.name, 'nl')).map(v => `<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.municipality)}</option>`).join('');
        const p = new URLSearchParams(location.search)
          , id = p.get('id');
        if (id && data.some(v => v.id === id)) {
            form.elements.kind.value = 'change';
            form.elements.kind.dispatchEvent(new Event('change'));
            form.elements.facilityId.value = id;
            form.elements.facilityId.dispatchEvent(new Event('change'));
        } else if (p.get('candidate')) {
            const inv = await api('/inventory.json');
            const v = inv.candidates.find(v => v.id === p.get('candidate'));
            if (v) {
                form.dataset.candidateId = v.id;
                fields($('facility-fields'), {
                    name: v.name || '',
                    source: v.source || '',
                    municipality: v.municipality || (v.municipalities?.length === 1 ? v.municipalities[0] : ''),
                    category: v.category || v.enrichment?.suggestedCategory || '',
                    address: v.address || '',
                    town: v.town || '',
                    description: v.description || '',
                    audience: v.audience || v.enrichment?.audienceSuggestion || '',
                    costs: v.costs || v.enrichment?.costSuggestion || '',
                    access: v.access || v.enrichment?.accessSuggestion || '',
                    openingHours: v.openingHours || '',
                    phone: v.phone || '',
                    email: v.email || ''
                });
                const auto = v.enrichment;
                if (auto) {
                    const open = (auto.reviewFields || []).length;
                    message('page-message', `Deze bronvermelding is automatisch vooringevuld op basis van herkenbare sleutelwoorden. ${open} veld${open === 1 ? '' : 'en'} moet${open === 1 ? '' : 'en'} nog worden gecontroleerd bij de bron.`, 'notice');
                }
            }
        }
    } catch (e) {
        message('page-message', e.message, 'error');
    }
    form.addEventListener('submit', async e => {
        e.preventDefault();
        lock(form, true);
        message('form-message', 'Melding versturen…');
        try {
            const b = Object.fromEntries(new FormData(form))
              , r = await api('/api/submissions', {
                ...b,
                facility: facilityData(form),
                requestKey: key
            });
            form.reset();
            delete form.dataset.candidateId;
            fields($('facility-fields'));
            $('existing-field').hidden = true;
            form.elements.facilityId.required = false;
            key = crypto.randomUUID();
            message('form-message', `Ontvangen! Je ontvangstnummer is ${r.id}. Bewaar dit nummer. De beheerder beoordeelt je melding voordat deze openbaar wordt. Er is geen e-mail verstuurd.`, 'success');
            $('form-message').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        } catch (e) {
            message('form-message', e.message, 'error');
        } finally {
            lock(form, false);
        }
    }
    );
}
async function inventory() {
    let selected = [], limit = 60;
    const [published, catalog, reviewQueue, inv] = await Promise.all([
        api('/api/facilities'),
        api('data/catalog.json'),
        api('data/review-queue.json'),
        api('/inventory.json')
    ]);
    const norm = s => String(s || '').toLocaleLowerCase('nl').replace(/[^\p{L}\p{N}]/gu, '');
    const orgFromName = name => {
        const value = String(name || '').trim();
        return value.includes(' · ') ? value.split(' · ', 1)[0].trim() : value;
    };
    const groups = new Map(catalog.map(g => [norm(g.organization), {...g, locations: []}]));
    for (const location of published) {
        const org = orgFromName(location.name);
        const key = norm(org);
        if (!groups.has(key)) {
            groups.set(key, {
                id: 'map-' + location.id,
                organization: org,
                municipalities: [],
                categories: [],
                offers: [],
                offerCount: 0,
                reviewNeeded: 0,
                sourceBacked: 0,
                manual: 0,
                sources: [],
                primarySource: location.source || '',
                status: 'manual',
                checked: location.checked || '',
                locations: []
            });
        }
        const g = groups.get(key);
        g.locations.push(location);
        if (location.municipality && !g.municipalities.includes(location.municipality)) g.municipalities.push(location.municipality);
        for (const k of [...(location.tags || []), location.category].filter(Boolean)) if (!g.categories.includes(k)) g.categories.push(k);
        if (location.source && !g.sources.includes(location.source)) g.sources.push(location.source);
        g.manual = (g.manual || 0) + 1;
        if (!g.primarySource) g.primarySource = location.source || '';
    }
    const all = [...groups.values()].sort((a,b) => a.organization.localeCompare(b.organization, 'nl'));

    $('inventory-municipality').innerHTML += municipalities.map(n => `<option>${esc(n)}</option>`).join('');
    $('inventory-category').innerHTML += Object.entries(categories).map(([k,n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');

    function matchingOffers(g, q, category) {
        return (g.offers || []).filter(o => {
            const text = [o.title,o.name,o.description,o.audience,o.access,...(o.tags||[]),...(o.subthemes||[]),...(o.themes||[])].join(' ').toLocaleLowerCase('nl');
            return (!q || text.includes(q)) && (!category || o.category === category || (o.themes || []).includes(category) || (o.tags || []).includes(category));
        });
    }
    function render() {
        const q = $('inventory-search').value.trim().toLocaleLowerCase('nl'),
              m = $('inventory-municipality').value,
              s = $('inventory-status').value,
              c = $('inventory-category').value,
              a = $('inventory-access').value;
        selected = all.filter(g => {
            const offers = matchingOffers(g, q, c);
            const groupText = [g.organization,...(g.municipalities||[]),...(g.categories||[])].join(' ').toLocaleLowerCase('nl');
            const qMatch = !q || groupText.includes(q) || offers.length;
            const categoryMatch = !c || (g.categories || []).includes(c) || offers.length;
            const areaMatch = !m || (g.municipalities || []).includes(m);
            const typeMatch = !s || (s === 'published' ? (g.locations || []).length : (g.offers || []).length);
            const statusMatch = !a ||
                (a === 'review-needed' && (g.reviewNeeded || 0) > 0) ||
                (a === 'source-backed' && (g.offers || []).length > 0 && (g.reviewNeeded || 0) === 0) ||
                (a === 'confirmed' && (g.locations || []).length > 0);
            return qMatch && categoryMatch && areaMatch && typeMatch && statusMatch;
        });
        const offerTotal = selected.reduce((n,g) => n + (g.offerCount || 0), 0);
        $('inventory-count').textContent = `${selected.length} organisaties · ${offerTotal} vormen van aanbod · ${published.length} kaartlocaties · ${reviewQueue.length} aandachtspunten`;
        $('inventory-rows').innerHTML = selected.slice(0, limit).map(g => {
            const matches = matchingOffers(g, q, c);
            const shown = (q || c ? matches : (g.offers || [])).slice(0, 6);
            const extra = Math.max(0, (q || c ? matches.length : (g.offers || []).length) - shown.length);
            const statusClass = (g.reviewNeeded || 0) ? 'attention' : (g.locations || []).length ? 'approved' : 'source-backed';
            const statusLabel = (g.reviewNeeded || 0)
                ? `${g.reviewNeeded} aandachtspunt${g.reviewNeeded === 1 ? '' : 'en'}`
                : (g.locations || []).length
                    ? `Brononderbouwd · ${g.locations.length} kaartlocatie${g.locations.length === 1 ? '' : 's'}`
                    : 'Brononderbouwd';
            const offerHtml = shown.length
                ? `<details class="offer-details"><summary>Bekijk ${q || c ? 'passend' : 'alle'} aanbod (${q || c ? matches.length : g.offerCount || 0})</summary><div class="offer-list">${shown.map(o => `<div><strong>${esc(o.title)}</strong>${o.audience ? `<small>Voor: ${esc(o.audience)}</small>` : ''}${o.source ? `<small>${safeLink(o.source,'bron bekijken')}</small>` : ''}</div>`).join('')}${extra ? `<small>+${extra} andere onderdelen. Open de bron of verfijn je zoekopdracht.</small>` : ''}</div></details>`
                : '';
            const topics = (g.categories || []).slice(0,3).map(k => categories[k] || k).join(', ') || 'Nog bepalen';
            const first = (g.offers || [])[0];
            const editHref = first ? `aanmelden.html?candidate=${encodeURIComponent(first.id)}` : (g.locations || [])[0] ? `aanmelden.html?id=${encodeURIComponent(g.locations[0].id)}` : 'aanmelden.html';
            return `<tr>
                <td><strong>${esc(g.organization)}</strong><small>${g.offerCount || 0} vormen van aanbod${(g.locations || []).length ? ` · ${g.locations.length} kaartlocatie${g.locations.length===1?'':'s'}` : ''}</small>${offerHtml}</td>
                <td>${esc((g.municipalities || []).join(', ') || 'Twente / nog bepalen')}</td>
                <td>${esc(topics)}${(g.categories || []).length > 3 ? `<small>+${g.categories.length-3} andere onderwerpen</small>` : ''}</td>
                <td><span class="badge ${statusClass}">${esc(statusLabel)}</span><small>Bronronde: ${esc(g.checked || inv.checked || 'onbekend')}</small></td>
                <td>${g.primarySource ? safeLink(g.primarySource,'Website / bron ↗') : '<span class="hint">Geen bronlink</span>'}<small><a href="${editHref}">Gegevens aanvullen →</a></small></td>
            </tr>`;
        }).join('') || '<tr><td colspan="5">Geen passend aanbod gevonden. Probeer een bredere zoekterm of een ander onderwerp.</td></tr>';
        $('load-more').hidden = selected.length <= limit;
    }
    ['inventory-search','inventory-municipality','inventory-status','inventory-category','inventory-access'].forEach(id => $(id).addEventListener('input', () => { limit = 60; render(); }));
    $('load-more').onclick = () => { limit += 60; render(); };
    $('download-json').onclick = () => {
        const u = URL.createObjectURL(new Blob([JSON.stringify({
            exportedAt: new Date().toISOString(),
            scope: inv.method,
            organizations: selected
        }, null, 2)], {type:'application/json'}));
        const a = document.createElement('a');
        a.href = u;
        a.download = 'sociale-kaart-twente-organisaties-en-aanbod.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
    };
    $('source-overview').innerHTML = municipalities.map(m => {
        const orgs = all.filter(g => (g.municipalities || []).includes(m));
        const attention = orgs.reduce((n,g) => n + (g.reviewNeeded || 0), 0);
        return `<div class="source-card"><strong>${esc(m)}</strong>${orgs.length} organisaties · ${published.filter(v => v.municipality === m).length} kaartlocaties<p>${(inv.sources.filter(s => s.municipalities.includes(m))).map(s => safeLink(s.url, s.title)).join('<br>')}</p><span>${attention ? attention + ' aandachtspunt(en)' : 'Geen uitzonderingen in de huidige brondata'} · bronronde ${esc(inv.checked)}</span></div>`;
    }).join('');
    render();
}

const importAliases = {
    name: ['naam', 'voorziening', 'organisatie', 'aanbod', 'titel'],
    municipality: ['gemeente', 'municipality'],
    category: ['onderwerp', 'categorie', 'thema', 'type'],
    address: ['adres', 'straat', 'bezoekadres', 'straat en huisnummer'],
    town: ['plaats', 'woonplaats', 'dorp', 'stad'],
    source: ['website', 'url', 'bron', 'link'],
    description: ['omschrijving', 'beschrijving', 'toelichting', 'aanbod'],
    audience: ['doelgroep', 'voor wie'],
    costs: ['kosten', 'prijs', 'bijdrage'],
    access: ['toegang', 'aanmelden', 'indicatie', 'verwijzing'],
    openingHours: ['openingstijden', 'spreekuur', 'tijden'],
    phone: ['telefoon', 'telefoonnummer', 'tel', 'mobiel'],
    email: ['e mail', 'email', 'e-mailadres', 'mail']
};
const cleanHeader = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function importKeyFor(header) {
    const h = cleanHeader(header);
    return Object.entries(importAliases).find( ([,names]) => names.some(n => h === n || h.includes(n)))?.[0] || '';
}
function inferMunicipality(text) {
    const n = cleanHeader(text);
    return municipalities.find(m => n.includes(cleanHeader(m))) || '';
}
function inferCategory(text) {
    const n = cleanHeader(text);
    const rules = [
        ['geld', 6, /geldloket|geldzorgen|budgethulp|budget|schuld|administratie|papierwerk|formulier|toeslag|voedselbank|kledingbank|armoede|minima|fonds|voorzieningenwijzer/],
        ['taal', 6, /taalhuis|taalpunt|taalondersteuning|digitaalhuis|digivaardig|bibliotheek|informatiepunt digitale overheid|inburger|nieuwkomer/],
        ['mantelzorg', 7, /mantelzorg|dementie|alzheimer|palliatief|terminale thuiszorg|respijt/],
        ['vrijwillig', 6, /vrijwilligerswerk|vrijwilligerspunt|vrijwillig|maatjesproject|maatje|buddy|burenhulp|noaberhulp/],
        ['jeugd', 6, /jongerenwerk|jongerencentrum|jeugd|jongeren|kinderen|peuter|puber|opvoeden|opgroeien|ouderschap|gezin/],
        ['vervoer', 7, /automaatje|auto maatje|vervoer|duofiets|belbus|boodschappenbus|maaltijd|tafeltje dekje/],
        ['bewegen', 7, /buurtsportcoach|beweegmakelaar|passend sporten|aangepast sporten|sport|beweeg|wandelgroep/],
        ['mentaal', 7, /mentaal|psychisch|zelfregie|ervaringsdeskund|ixta noa|realcovery|ziens|herstel|lotgenoot/],
        ['ontmoeten', 6, /ontmoet|inloophuis|inloop|huiskamer|buurthuis|wijkcentrum|noaberhoes|trefpunt|seniorenwerk/],
        ['advies', 5, /maatschappelijk werk|clientondersteun|sociaal raadsl|buurtbemiddeling|juridisch|wijkteam|zorgloket/]
    ];
    let best = ['', 0];
    for (const [key, weight, rx] of rules) {
        const matches = n.match(new RegExp(rx.source, 'g')) || [];
        const score = matches.length * weight;
        if (score > best[1]) best = [key, score];
    }
    return best[0];
}
function inferAudience(text) {
    const n = cleanHeader(text);
    const rules = [
        [/dementie|alzheimer/, 'Mensen met dementie en hun naasten'],
        [/mantelzorg/, 'Mantelzorgers'],
        [/senioren|ouderen|55\+|65\+/, 'Ouderen / senioren'],
        [/peuter|kinderen|jeugd|jongeren|puber|tiener/, 'Kinderen en jongeren'],
        [/ouders|opvoeden|opgroeien|gezin/, 'Ouders en gezinnen'],
        [/nieuwkomer|inburger|statushouder/, 'Nieuwkomers / mensen die de Nederlandse taal leren'],
        [/schuld|armoede|minima|voedselbank|geldzorgen/, 'Mensen met geldzorgen of een laag inkomen'],
        [/psychisch|mentaal|zelfregie|ervaringsdeskund|herstel/, 'Mensen met psychische kwetsbaarheid of herstelvragen']
    ];
    return rules.find(([rx]) => rx.test(n))?.[1] || '';
}
function inferCosts(text) {
    const n = cleanHeader(text);
    if (/gratis|kosteloos|geen kosten/.test(n)) return 'Gratis';
    if (/eigen bijdrage|kleine bijdrage/.test(n)) return 'Mogelijk een eigen bijdrage; controleer het actuele bedrag bij de aanbieder.';
    return '';
}
function inferAccess(text) {
    const n = cleanHeader(text);
    if (/zonder (gemeentelijke )?indicatie|geen indicatie nodig|zonder verwijzing|geen verwijzing nodig/.test(n)) return 'Zonder indicatie of verwijzing';
    if (/vrij toegankelijk|vrije inloop/.test(n)) return 'Vrij toegankelijk';
    if (/geen afspraak nodig|kunt binnenlopen|kan binnenlopen/.test(n)) return 'Inloop zonder afspraak';
    if (/op afspraak|afspraak maken/.test(n)) return 'Op afspraak';
    return '';
}

function importRowsFromMatrix(matrix) {
    const data = matrix.filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim()));
    if (!data.length)
        return [];
    const first = data[0].map(importKeyFor)
      , hasHeaders = first.includes('name') || first.filter(Boolean).length >= 2
      , headers = hasHeaders ? first : data[0].map( (_, i) => i === 0 ? 'name' : '');
    return data.slice(hasHeaders ? 1 : 0).map(row => {
        const v = {
            name: '',
            municipality: '',
            category: '',
            address: '',
            town: '',
            source: '',
            description: '',
            audience: '',
            costs: '',
            access: '',
            openingHours: '',
            phone: '',
            email: ''
        };
        row.forEach( (cell, i) => {
            const k = headers[i];
            if (k && !v[k])
                v[k] = String(cell ?? '').trim();
        }
        );
        const joined = row.join(' ');
        v.municipality = municipalities.includes(v.municipality) ? v.municipality : inferMunicipality(v.municipality + ' ' + joined);
        v.category = Object.hasOwn(categories, v.category) ? v.category : inferCategory(v.category + ' ' + joined);
        if (!v.audience) v.audience = inferAudience(joined);
        if (!v.costs) v.costs = inferCosts(joined);
        if (!v.access) v.access = inferAccess(joined);
        if (v.source && /^www\./i.test(v.source))
            v.source = 'https://' + v.source;
        return v;
    }
    ).filter(v => v.name);
}
function parseCsv(text) {
    const sample = text.split(/\r?\n/, 1)[0]
      , delimiter = [';', ',', '\t'].sort( (a, b) => sample.split(b).length - sample.split(a).length)[0];
    let rows = []
      , row = []
      , cell = ''
      , quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else
                quoted = !quoted;
        } else if (c === delimiter && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((c === '\n' || c === '\r' && text[i + 1] !== '\n') && !quoted) {
            row.push(cell);
            if (row.some(v => v.trim()))
                rows.push(row);
            row = [];
            cell = '';
        } else if (c !== '\r')
            cell += c;
    }
    row.push(cell);
    if (row.some(v => v.trim()))
        rows.push(row);
    return rows;
}
function excelCell(v) {
    if (v == null)
        return '';
    if (v instanceof Date)
        return v.toLocaleDateString('nl-NL');
    if (typeof v !== 'object')
        return String(v);
    if (v.text)
        return String(v.text);
    if (v.hyperlink)
        return String(v.hyperlink);
    if (v.result != null)
        return excelCell(v.result);
    if (Array.isArray(v.richText))
        return v.richText.map(x => x.text || '').join('');
    return String(v);
}
async function readImport(file) {
    const buf = await file.arrayBuffer()
      , name = file.name.toLowerCase();
    if (name.endsWith('.csv'))
        return importRowsFromMatrix(parseCsv(new TextDecoder().decode(buf)));
    if (name.endsWith('.xlsx')) {
        if (!globalThis.ExcelJS)
            throw Error('De Excel-lezer kon niet worden geladen. Vernieuw de pagina.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        return wb.worksheets.flatMap(ws => {
            const matrix = [];
            ws.eachRow({
                includeEmpty: false
            }, r => matrix.push(r.values.slice(1).map(excelCell)));
            return importRowsFromMatrix(matrix);
        }
        );
    }
    if (name.endsWith('.docx')) {
        if (!globalThis.mammoth)
            throw Error('De Word-lezer kon niet worden geladen. Vernieuw de pagina.');
        const {value} = await mammoth.convertToHtml({
            arrayBuffer: buf
        })
          , doc = new DOMParser().parseFromString(value, 'text/html')
          , tables = [...doc.querySelectorAll('table')];
        if (tables.length)
            return tables.flatMap(t => importRowsFromMatrix([...t.rows].map(r => [...r.cells].map(c => c.textContent.trim()))));
        const blocks = [...doc.querySelectorAll('h1,h2,h3,h4,p')].map(e => ({
            tag: e.tagName,
            text: e.textContent.trim()
        })).filter(x => x.text);
        const heads = blocks.some(x => x.tag.startsWith('H'));
        if (heads) {
            const rows = [];
            for (const b of blocks) {
                if (b.tag.startsWith('H'))
                    rows.push([b.text, '']);
                else if (rows.length)
                    rows.at(-1)[1] += (rows.at(-1)[1] ? ' ' : '') + b.text;
            }
            return rows.map( ([name,description]) => ({
                name,
                description,
                municipality: inferMunicipality(name + ' ' + description),
                category: inferCategory(name + ' ' + description),
                address: '',
                town: '',
                source: '',
                audience: inferAudience(name + ' ' + description),
                costs: inferCosts(name + ' ' + description),
                access: inferAccess(name + ' ' + description),
                openingHours: ''
            }));
        }
        return blocks.slice(0, 500).map(b => ({
            name: b.text.slice(0, 160),
            description: b.text.length > 160 ? b.text : '',
            municipality: inferMunicipality(b.text),
            category: inferCategory(b.text),
            address: '',
            town: '',
            source: (b.text.match(/https?:\/\/\S+/) || [''])[0],
            audience: inferAudience(b.text),
            costs: inferCosts(b.text),
            access: inferAccess(b.text),
            openingHours: ''
        }));
    }
    throw Error('Gebruik een Excel-, CSV- of Word-bestand (.xlsx, .csv of .docx).');
}
async function admin() {
    const session = await api('/api/session');
    if (!session.admin) {
        $('login-panel').hidden = false;
        if (session.authenticated)
            message('page-message', 'Je bent ingelogd, maar dit account heeft geen beheerrechten. Gebruik het aangewezen beheerdersaccount.', 'error');
        return;
    }
    $('admin-workspace').hidden = false;
    let selected = null
      , records = []
      , facilities = []
      , importRows = []
      , importKey = crypto.randomUUID();

    const duplicateDialog = $('duplicate-dialog');
    const duplicateDecisionLabel = v => ({
        merge: 'Samenvoegen',
        skip: 'Overslaan',
        new: 'Als nieuw toevoegen'
    }[v] || 'Keuze nodig');
    const duplicateTypeLabel = v => ({
        facility: 'bestaande kaartvoorziening',
        pending: 'melding die al te beoordelen staat',
        inventory: 'bestaande inventarisatieregel',
        batch: 'eerdere regel uit dit bestand'
    }[v] || 'bestaande vermelding');
    function duplicateMeta(v) {
        return [v.municipality || v.town, v.address, categories[v.category] || v.category].filter(Boolean).join(' · ') || 'Nog weinig gegevens bekend';
    }
    function duplicateStateHtml(v, i) {
        const finding = v._duplicateFinding;
        if (!finding || !finding.matches?.length)
            return '<div class="duplicate-state"><span class="badge approved">Geen sterke match</span></div>';
        const best = finding.matches[0]
          , decision = v.duplicateDecision
          , cls = decision || 'check'
          , text = decision ? `${duplicateDecisionLabel(decision)}${decision === 'merge' ? ' · ' + esc(best.name) : ''}` : `Mogelijk dubbel · ${esc(best.name)}`;
        return `<div class="duplicate-state"><span class="badge ${cls}">${text}</span><small>${esc(best.status || duplicateTypeLabel(best.type))} · ${Math.round((best.score || 0) * 100)}% match</small><button type="button" data-duplicate-edit="${i}">${decision ? 'Keuze wijzigen' : 'Nu beoordelen'}</button></div>`;
    }
    function setDuplicateChoice(row, finding, choice) {
        const best = finding?.matches?.[0];
        row.duplicateDecision = choice;
        row.duplicateMatchType = best?.type || '';
        row.duplicateMatchId = best?.id || '';
        row._duplicateDirty = false;
    }
    function askDuplicateChoice(row, finding, position, total) {
        const best = finding.matches[0];
        $('duplicate-progress').textContent = total ? `${position}/${total}` : '';
        $('duplicate-import-name').textContent = row.name || 'Naam ontbreekt';
        $('duplicate-import-meta').textContent = duplicateMeta(row);
        $('duplicate-match-name').textContent = best.name || 'Naam onbekend';
        $('duplicate-match-meta').textContent = `${duplicateTypeLabel(best.type)} · ${duplicateMeta(best)}`;
        $('duplicate-reason').textContent = `${best.confidence === 'sterk' ? 'Sterke' : 'Waarschijnlijke'} overeenkomst: ${(best.reasons || []).join(', ')}. Vergelijk de twee regels en kies wat hiermee moet gebeuren.`;
        return new Promise(resolve => {
            const buttons = [...duplicateDialog.querySelectorAll('[data-duplicate-choice]')];
            const finish = choice => {
                buttons.forEach(b => b.onclick = null);
                setDuplicateChoice(row, finding, choice);
                duplicateDialog.close();
                resolve(choice);
            };
            buttons.forEach(b => b.onclick = () => finish(b.dataset.duplicateChoice));
            duplicateDialog.oncancel = e => e.preventDefault();
            duplicateDialog.showModal();
        });
    }
    async function detectAndResolveDuplicates(rows, {force = false} = {}) {
        if (!rows.length)
            return 0;
        message('import-message', 'Controleren op dubbele voorzieningen…');
        const result = await api('/api/admin/import-duplicates', {rows});
        const byIndex = new Map((result.duplicates || []).map(x => [x.index, x]));
        rows.forEach((row, i) => {
            const finding = byIndex.get(i) || null;
            row._duplicateFinding = finding;
            if (!finding) {
                row.duplicateDecision = '';
                row.duplicateMatchType = '';
                row.duplicateMatchId = '';
                row._duplicateDirty = false;
                return;
            }
            const best = finding.matches[0];
            const sameChoice = row.duplicateDecision && row.duplicateMatchType === best.type && String(row.duplicateMatchId) === String(best.id) && !row._duplicateDirty;
            if (!sameChoice)
                row.duplicateDecision = '';
        });
        const unresolved = rows.map((row, i) => ({row, i, finding: byIndex.get(i)})).filter(x => x.finding && (force || !x.row.duplicateDecision || x.row._duplicateDirty));
        for (let j = 0; j < unresolved.length; j++)
            await askDuplicateChoice(unresolved[j].row, unresolved[j].finding, j + 1, unresolved.length);
        return byIndex.size;
    }
    function renderImport() {
        const municipalityOptions = ['<option value="">Nog bepalen</option>', ...municipalities.map(m => `<option ${m === undefined ? '' : ''}>${esc(m)}</option>`)].join('')
          , categoryOptions = v => `<option value="">Nog bepalen</option>` + Object.entries(categories).map( ([k,n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(n)}</option>`).join('');
        $('import-rows').innerHTML = importRows.map( (v, i) => `<tr data-import-row="${i}"><td><input class="import-include" type="checkbox" ${v._include === false ? '' : 'checked'} aria-label="Regel ${i + 1} meenemen"></td><td>${duplicateStateHtml(v, i)}</td><td><input name="name" value="${esc(v.name)}" maxlength="160" aria-label="Naam regel ${i + 1}"></td><td><select name="municipality" aria-label="Gemeente regel ${i + 1}">${municipalityOptions.replace(`>${esc(v.municipality)}</option>`, ` selected>${esc(v.municipality)}</option>`)}</select></td><td><select name="category" aria-label="Onderwerp regel ${i + 1}">${categoryOptions(v.category)}</select></td><td><input name="address" value="${esc(v.address)}" maxlength="200" aria-label="Adres regel ${i + 1}"></td><td><input name="town" value="${esc(v.town)}" maxlength="100" aria-label="Plaats regel ${i + 1}"></td><td><input name="source" type="url" value="${esc(v.source)}" maxlength="1000" placeholder="https://…" aria-label="Website regel ${i + 1}"></td></tr>`).join('');
        const dupes = importRows.filter(v => v._duplicateFinding?.matches?.length).length;
        const merges = importRows.filter(v => v.duplicateDecision === 'merge').length;
        const skips = importRows.filter(v => v.duplicateDecision === 'skip').length;
        $('import-count').textContent = `${importRows.length} regels herkend · ${dupes} mogelijke dubbelen · ${merges} samenvoegen · ${skips} overslaan`;
        $('import-preview').hidden = false;
        $('import-rows').querySelectorAll('[data-import-row]').forEach(tr => {
            const include = tr.querySelector('.import-include');
            include.onchange = () => importRows[+tr.dataset.importRow]._include = include.checked;
            tr.querySelectorAll('input[name],select[name]').forEach(el => el.addEventListener('input', () => {
            const row = importRows[+tr.dataset.importRow];
            row[el.name] = el.value;
            if (['name','municipality','address','town','source'].includes(el.name))
                row._duplicateDirty = true;
            const state = tr.querySelector('.duplicate-state .badge');
            if (row._duplicateFinding && state) {
                state.className = 'badge check';
                state.textContent = 'Gegevens gewijzigd · opnieuw controleren';
            }
        }
        ));
        });
        $('import-rows').querySelectorAll('[data-duplicate-edit]').forEach(btn => btn.onclick = async () => {
            const i = +btn.dataset.duplicateEdit
              , row = importRows[i]
              , finding = row._duplicateFinding;
            if (!finding)
                return;
            await askDuplicateChoice(row, finding, 1, 1);
            renderImport();
        });
    }
    $('read-import').onclick = async () => {
        const file = $('import-file').files[0];
        if (!file) {
            message('import-message', 'Kies eerst een bestand.', 'error');
            return;
        }
        if (file.size > 10_000_000) {
            message('import-message', 'Dit bestand is groter dan 10 MB. Maak een kleiner bestand.', 'error');
            return;
        }
        message('import-message', 'Bestand uitlezen…');
        $('import-preview').hidden = true;
        try {
            importRows = (await readImport(file)).slice(0, 500);
            importRows.forEach(v => v._include = true);
            if (!importRows.length)
                throw Error('Geen voorzieningen herkend. Gebruik bij voorkeur een tabel met een kolom Naam of Voorziening.');
            importKey = crypto.randomUUID();
            const duplicateCount = await detectAndResolveDuplicates(importRows, {force: true});
            renderImport();
            message('import-message', `${importRows.length} regels herkend. ${duplicateCount ? `${duplicateCount} mogelijke dubbelen zijn één voor één beoordeeld. ` : 'Geen sterke dubbelen gevonden. '}Controleer de gegevens hieronder.`, 'success');
        } catch (e) {
            message('import-message', e.message, 'error');
        }
    }
    ;
    $('submit-import').onclick = async () => {
        let rows = importRows.filter(v => v._include !== false && v.name.trim());
        if (!rows.length) {
            message('import-message', 'Selecteer minimaal één regel met een naam.', 'error');
            return;
        }
        try {
            // Nog één controle vlak vóór opslaan. Zo kan een wijziging in naam/adres
            // niet ongemerkt langs de duplicate-detectie glippen.
            await detectAndResolveDuplicates(rows);
        } catch (e) {
            message('import-message', e.message, 'error');
            return;
        }
        lock($('import-preview'), true);
        message('import-message', 'Regels toevoegen aan de controlelijst…');
        try {
            const result = await api('/api/admin/import', {
                fileName: $('import-file').files[0].name,
                importKey,
                rows
            });
            message('import-message', `${result.imported} concepten staan nu bij Te beoordelen. ${result.merged || 0} keuzes zijn samengevoegd en ${result.skipped || 0} regels overgeslagen. ${result.webQueued || 0} broncontroles zijn op de achtergrond ingepland.`, 'success');
            $('import-preview').hidden = true;
            await refresh();
        } catch (e) {
            message('import-message', e.message, 'error');
        } finally {
            lock($('import-preview'), false);
        }
    }
    ;
    async function refresh() {
        const [r,f] = await Promise.all([api('/api/admin/submissions?status=' + $('review-status').value), api('/api/facilities')]);
        records = r;
        facilities = f;
        selected = null;
        $('review-count').textContent = `${r.length} meldingen`;
        $('review-list').innerHTML = r.map(s => `<button class="review-item" data-id="${esc(s.id)}"><strong>${esc(s.payload.name)}</strong><small>${esc(s.payload.municipality || 'Gemeente nog bepalen')} · ${s.payload.importNeedsReview ? 'Bestandsimport · volledig controleren' : {
            new: 'Nieuw',
            change: 'Wijziging',
            remove: 'Gestopt'
        }[s.kind]}<br>${esc(new Date(s.created_at).toLocaleString('nl-NL'))}</small></button>`).join('') || '<div class="panel">Er zijn geen meldingen in deze lijst.</div>';
        $('review').innerHTML = '<h2>Selecteer een melding</h2><p>Open een melding om de gegevens en bron te bekijken.</p>';
        $('review-list').querySelectorAll('button').forEach(b => b.onclick = () => open(records.find(s => s.id === b.dataset.id)));
    }
    function open(s) {
        selected = s;
        const current = facilities.find(x => x.id === s.facility_id);
        const revision = current?.revision || 0;
        $('review').innerHTML = `<h2>${esc(s.payload.name)}</h2>${s.payload.importNeedsReview ? '<p class="notice import-warning"><strong>Geïmporteerd concept.</strong> De automatische voorinvulling bespaart werk, maar controleer de bron vóór publicatie.</p>' : ''}${enrichmentPanel(s.payload)}<dl class="info-pairs"><dt>Ontvangstnummer</dt><dd>${esc(s.id)}</dd><dt>Contact</dt><dd>${esc(s.organization)}<br>${esc(s.contact_name)} · ${esc(s.contact_email)}</dd><dt>Toelichting</dt><dd>${esc(s.message || 'Geen toelichting')}</dd><dt>Bron</dt><dd>${safeLink(s.payload.source, 'Open de bron') || 'Nog niet herkend'}</dd></dl>${current ? `<details><summary>Vergelijk met huidige vermelding</summary><dl class="info-pairs">${definitions.map( ([k,label]) => `<dt>${label}</dt><dd>${esc(current[k] || 'Onbekend')}</dd>`).join('')}</dl></details>` : ''}${s.status === 'pending' ? `<form id="review-form"><div id="review-fields" class="grid-fields"></div>${s.kind === 'remove' ? '<p class="notice">Bij goedkeuren verdwijnt deze voorziening van de openbare kaart.</p>' : '<label class="checkbox"><input name="confirmed" type="checkbox"><span>Ik heb de bron, het adres en de toegankelijkheid van het aanbod gecontroleerd.</span></label>'}<label class="field">Notitie / reden voor afwijzing<textarea name="note" maxlength="1000"></textarea></label><div id="review-message" role="status" hidden></div><div class="actions"><button class="action" type="submit">${s.kind === 'remove' ? 'Verwijderen van de kaart' : 'Goedkeuren en publiceren'}</button><button type="button" class="action secondary" id="reject">Afwijzen</button></div></form>` : `<p class="notice">${s.status === 'approved' ? 'Goedgekeurd' : 'Afgewezen'} · ${esc(s.review_note || 'Geen notitie')}</p>`}`;
        if (s.status !== 'pending')
            return;
        fields($('review-fields'), s.payload);
        const form = $('review-form');
        form.dataset.candidateId = s.payload.candidateId || '';
        if (s.kind === 'remove') {
            $('review-fields').hidden = true;
            form.querySelectorAll('#review-fields [required]').forEach(x => x.required = false);
        }
        async function decide(action) {
            lock(form, true);
            message('review-message', 'Beoordeling opslaan…');
            try {
                await api('/api/admin/review', {
                    id: s.id,
                    action,
                    revision,
                    facility: facilityData(form),
                    confirmed: form.elements.confirmed?.checked === true,
                    note: form.elements.note.value
                });
                await refresh();
                message('page-message', action === 'approve' ? 'Opgeslagen. De openbare kaart is bijgewerkt.' : 'De melding is afgewezen.', 'success');
            } catch (e) {
                message('review-message', e.message, 'error');
            } finally {
                lock(form, false);
            }
        }
        form.onsubmit = e => {
            e.preventDefault();
            if (s.kind !== 'remove' && !form.elements.confirmed.checked) {
                message('review-message', 'Controleer de bron en vink de bevestiging aan.', 'error');
                return;
            }
            void decide('approve');
        };
        $('reject').onclick = () => void decide('reject');
    }

    $('review-status').onchange = () => void refresh();
    $('refresh-reviews').onclick = () => void refresh();
    $('enrich-all').onclick = async () => {
        message('page-message', 'Voorinvulling opnieuw uitvoeren…');
        try {
            const result = await api('/api/admin/enrich-all', {});
            message('page-message', `Voorinvulling bijgewerkt: ${result.inventory || 0} inventarisatieregels en ${result.facilities || 0} kaartlocaties.`, 'success');
            await refresh();
        } catch (e) {
            message('page-message', e.message, 'error');
        }
    };
    $('web-enrich-all').onclick = async () => {
        message('web-enrich-status', 'Bronpagina’s worden op de achtergrond uitgelezen…');
        try {
            const result = await api('/api/admin/web-enrich-all', {force: true});
            const status = result.status || {};
            message('web-enrich-status', result.started === false
                ? 'Er draait al een broncontrole.'
                : `Broncontrole gestart voor ${status.total || 'de beschikbare'} bronnen.`, 'success');
        } catch (e) {
            message('web-enrich-status', e.message, 'error');
        }
    };
    await refresh();
}

async function initPortal() {
    const page = document.body.dataset.page || '';
    document.querySelectorAll('.portal-header nav a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const active = (page === 'voorzieningen' && href.includes('voorzieningen')) ||
            (page === 'aanmelden' && href.includes('aanmelden')) ||
            (page === 'beheer' && href.includes('beheer'));
        if (active) a.setAttribute('aria-current', 'page');
    });
    if (page === 'voorzieningen') return inventory();
    if (page === 'aanmelden') return submission();
    if (page === 'beheer') return admin();
}

initPortal().catch(e => {
    console.error(e);
    message('page-message', e.message || 'De pagina kon niet volledig worden geladen.', 'error');
});
