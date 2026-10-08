(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const uniq = values => [...new Set((values || []).filter(Boolean))];
  const esc = value => String(value == null ? "" : value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const norm = value => String(value || "").toLocaleLowerCase("nl-NL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return ["https:","http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  const topicVisuals = {
    onderwijs: "assets/wegwijzer/jeugd-school.svg",
    wonen: "assets/wegwijzer/wonen.svg",
    geld: "assets/wegwijzer/geld.svg",
    mentaal: "assets/wegwijzer/mentaal.svg",
    zorg: "assets/wegwijzer/zorg.svg",
    veiligheid: "assets/wegwijzer/veiligheid.svg",
    meedoen: "assets/wegwijzer/werk.svg",
    ontmoeten: "assets/wegwijzer/ontmoeten.svg",
    taal: "assets/wegwijzer/taal.svg",
    verslaving: "assets/wegwijzer/verslaving.svg",
    migratie: "assets/wegwijzer/nieuwkomers.svg",
    vervoer: "assets/wegwijzer/vervoer.svg",
    recht: "assets/wegwijzer/recht.svg",
    basis: "assets/wegwijzer/basis.svg"
  };

  let taxonomy = [];
  let records = [];
  let route = [];
  let searchTimer = 0;
  let detailMaps = [];

  // Alleen echte adressen gebruiken. Bij meerdere adressen gaat een locatie in
  // de gekozen gemeente vóór een willekeurig centraal kantoor elders.
  const municipalityCenters = {
    "Almelo":[52.3566,6.6635], "Borne":[52.3015,6.7485],
    "Dinkelland":[52.3787,7.0082], "Enschede":[52.2215,6.8937],
    "Haaksbergen":[52.1565,6.7395], "Hellendoorn":[52.3602,6.4682],
    "Hengelo":[52.2658,6.7930], "Hof van Twente":[52.2323,6.5862],
    "Losser":[52.2593,7.0070], "Oldenzaal":[52.3135,6.9303],
    "Rijssen-Holten":[52.3080,6.5187], "Tubbergen":[52.4072,6.7844],
    "Twenterand":[52.4084,6.6242], "Wierden":[52.3593,6.5927]
  };
  const municipalityTowns = {
    "Dinkelland":["denekamp","ootmarsum","weerselo"],
    "Hellendoorn":["nijverdal"], "Hof van Twente":["goor","delden","markelo","diepenheim"],
    "Rijssen-Holten":["rijssen","holten"],
    "Twenterand":["vriezenveen","vroomshoop","den ham","westerhaar"],
    "Wierden":["enter"], "Tubbergen":["geesteren","albergen"]
  };
  function siteIsUsable(item) {
    return Boolean(item && item.address && item.town &&
      Number.isFinite(item.lat) && Number.isFinite(item.lon) &&
      item.mapLocationType !== "service-area");
  }
  function siteInMunicipality(item, area) {
    if (!area) return true;
    if (item.locationMunicipality) return norm(item.locationMunicipality) === norm(area);
    return norm(item.town) === norm(area) ||
      (municipalityTowns[area] || []).some(town => norm(town) === norm(item.town));
  }
  function resolveLocation(record) {
    const chosen = municipality();
    const own = (record.siteCandidates || []).filter(siteIsUsable).map(item => ({
      ...item, _sourceRank: item.physicalLocation ||
        (item.mapPin && ["visiting","service","existing"].includes(item.locationType)) ? 0 : 1,
      _kind: item.physicalLocation ||
        (item.mapPin && ["visiting","service","existing"].includes(item.locationType))
        ? "physical" : "contact"
    }));
    const organizationSites = (record.organizationSites || []).filter(siteIsUsable).map(item => ({
      ...item, _sourceRank:2, _kind:"organization"
    }));
    const unique = new Map();
    for (const item of [...own,...organizationSites]) {
      const key = norm([item.address,item.postcode,item.town].join("|"));
      if (!unique.has(key) || unique.get(key)._sourceRank > item._sourceRank) unique.set(key,item);
    }
    const center = municipalityCenters[chosen];
    const distance = item => !center ? 0 :
      ((item.lat-center[0])*111)**2 + ((item.lon-center[1])*68)**2;
    const sites = [...unique.values()].sort((a,b) => {
      const localA = chosen && !siteInMunicipality(a,chosen) ? 1 : 0;
      const localB = chosen && !siteInMunicipality(b,chosen) ? 1 : 0;
      return localA-localB || a._sourceRank-b._sourceRank ||
        distance(a)-distance(b);
    });
    if (!sites.length) return {...record,detailMapType:""};
    const site = sites[0];
    return {
      ...record,
      address:site.address, postcode:site.postcode || "", town:site.town,
      lat:site.lat, lon:site.lon,
      locationMunicipality:site.locationMunicipality || site.town,
      locationType:site._kind === "organization" ? "contact" : site.locationType,
      detailMapType:site._kind,
      displayLocationNote:site._kind === "organization"
        ? "Locatie van de organisatie; dit is niet noodzakelijk de uitvoeringsplek van deze dienst."
        : chosen && !siteInMunicipality(site,chosen)
          ? "Geen bevestigde locatie in " + chosen + " bekend; deze locatie ligt elders."
          : ""
    };
  }

  function setupTheme() {
    const button = document.querySelector(".scheme-toggle");
    if (!button) return;
    const apply = (mode, save) => {
      const dark = mode === "dark";
      document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
      button.setAttribute("aria-pressed", String(dark));
      button.textContent = dark ? "Licht" : "Donker";
      button.setAttribute("aria-label", dark ? "Schakel lichte modus in" : "Schakel donkere modus in");
      if (save) {
        try { localStorage.setItem("sociale-kaart-color-scheme", dark ? "dark" : "light"); } catch {}
      }
    };
    apply(document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light", false);
    button.addEventListener("click", () => apply(document.documentElement.dataset.colorScheme === "dark" ? "light" : "dark", true));
  }

  function activityObject(item) {
    if (!item) return null;
    if (typeof item === "string") return {name: item};
    if (typeof item === "object" && item.name) return item;
    return null;
  }

  function activitiesOf(record) {
    return (record.activities || []).map(activityObject).filter(Boolean);
  }

  function activityText(record) {
    return activitiesOf(record).map(item => [
      item.name, item.description, item.location, item.schedule, item.category
    ].filter(Boolean).join(" ")).join(" ");
  }

  function mergeActivities(...lists) {
    const merged = new Map();
    lists.flat().map(activityObject).filter(Boolean).forEach(item => {
      const key = norm([item.name, item.location, item.schedule].filter(Boolean).join("|"));
      if (!key) return;
      if (!merged.has(key)) merged.set(key, item);
      else merged.set(key, {...merged.get(key), ...item});
    });
    return [...merged.values()];
  }

  function recordText(record) {
    return norm([
      record.organization, record.title, record.description, record.audience, record.access, record.costs,
      record.address, record.postcode, record.town, record.openingHours, record.phone, record.email,
      record.activitiesNote, activityText(record),
      (record.themes || []).join(" "), (record.subthemes || []).join(" "),
      (record.tags || []).join(" "), (record.routeTags || []).join(" ")
    ].join(" "));
  }

  function nodePath(node) {
    let found = null;
    const walk = (nodes, prefix) => {
      for (const item of nodes || []) {
        const path = [...prefix, item.id];
        if (item === node) {
          found = path;
          return true;
        }
        if (item.children && walk(item.children, path)) return true;
      }
      return false;
    };
    walk(taxonomy, []);
    return found || [node.id];
  }

  function termMatches(text, term) {
    const needle = norm(term);
    if (!needle) return false;
    if (needle.includes(" ")) return (" " + text + " ").includes(" " + needle + " ");
    if (needle.length <= 4) return (" " + text + " ").includes(" " + needle + " ");
    return text.includes(needle);
  }

  function matchesNode(node, record) {
    const explicit = record.guidePaths || [];
    if (explicit.length) {
      const path = nodePath(node).join("/");
      return explicit.some(value => value === path || value.startsWith(path + "/"));
    }
    if (node.children && node.children.length) return node.children.some(child => matchesNode(child, record));
    const text = record._text || recordText(record);
    const required = node.requireAny || [];
    if (required.length && !required.some(term => termMatches(text, term))) return false;
    return (node.include || []).some(term => termMatches(text, term));
  }

  function municipality() {
    return byId("guide-municipality").value;
  }

  function inMunicipality(record) {
    const chosen = municipality();
    if (!chosen) return true;
    const areas = record.municipalities || [];
    return areas.includes(chosen) || areas.includes("Twente");
  }

  function forNode(node) {
    return records.filter(record => !record.guideExclude && !record.activityOnly && inMunicipality(record) && matchesNode(node, record));
  }

  function findNode(ids) {
    let nodes = taxonomy;
    let found = null;
    for (const id of ids) {
      found = nodes.find(node => node.id === id);
      if (!found) return null;
      nodes = found.children || [];
    }
    return found;
  }

  function pathNodes() {
    const result = [];
    let nodes = taxonomy;
    for (const id of route) {
      const found = nodes.find(node => node.id === id);
      if (!found) break;
      result.push(found);
      nodes = found.children || [];
    }
    return result;
  }

  function readHash() {
    const ids = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent).filter(Boolean);
    const valid = [];
    let nodes = taxonomy;
    for (const id of ids) {
      const found = nodes.find(node => node.id === id);
      if (!found) break;
      valid.push(id);
      nodes = found.children || [];
    }
    route = valid;
  }

  function writeHash() {
    const hash = route.length ? "#" + route.map(encodeURIComponent).join("/") : "#";
    if (location.hash !== hash) history.pushState(null, "", hash);
  }

  function renderBreadcrumbs() {
    const crumbs = ['<button type="button" data-crumb="0">Start</button>'];
    pathNodes().forEach((node, index) => {
      crumbs.push('<span aria-hidden="true">›</span><button type="button" data-crumb="' + (index + 1) + '">' + esc(node.label) + "</button>");
    });
    const holder = byId("guide-breadcrumbs");
    holder.innerHTML = crumbs.join("");
    holder.querySelectorAll("[data-crumb]").forEach(button => {
      button.addEventListener("click", () => {
        route = route.slice(0, Number(button.dataset.crumb));
        writeHash();
        render();
      });
    });
  }

  function emptyState() {
    return '<div class="guide-empty"><strong>Geen passend aanbod gevonden</strong><span>Probeer een bredere route, kies Heel Twente of gebruik de zoekbalk.</span></div>';
  }

  function renderCards(nodes, parent) {
    clearDetailMaps();
    const grid = byId("guide-grid");
    const results = byId("guide-results");
    const visualRoot = !parent && route.length === 0 && byId("guide-search").value.trim().length < 2;
    grid.hidden = false;
    results.hidden = true;
    grid.classList.toggle("guide-visual-grid", visualRoot);
    grid.classList.toggle("guide-subgrid", !visualRoot);

    if (visualRoot) {
      grid.innerHTML = nodes.map(node => {
        const count = forNode(node).length;
        const image = topicVisuals[node.id] || topicVisuals.basis;
        const countLabel = count + " " + (count === 1 ? "resultaat" : "resultaten");
        return '<button class="guide-topic" type="button" data-node="' + esc(node.id) + '"' + (count ? "" : " disabled") +
          ' aria-label="' + esc(node.label + ", " + countLabel) + '">' +
          '<span class="guide-topic-art"><img src="' + esc(image) + '" alt="" aria-hidden="true"></span>' +
          '<strong>' + esc(node.label) + "</strong></button>";
      }).join("");
    } else {
      grid.innerHTML = nodes.map(node => {
        const count = forNode(node).length;
        const countLabel = count + " " + (count === 1 ? "resultaat" : "resultaten");
        return '<button class="guide-card" type="button" data-node="' + esc(node.id) + '"' + (count ? "" : " disabled") + ">" +
          '<span class="guide-card-heading"><strong>' + esc(node.label) + '</strong><span class="guide-card-count" title="' + esc(countLabel) + '" aria-label="' + esc(countLabel) + '">' + count + "</span></span>" +
          (node.description ? "<p>" + esc(node.description) + "</p>" : "") +
          "</button>";
      }).join("");
    }

    grid.querySelectorAll("[data-node]").forEach(button => {
      button.addEventListener("click", () => {
        route.push(button.dataset.node);
        writeHash();
        render();
        const stage = document.querySelector(".guide-stage");
        if (stage) window.scrollTo({top: Math.max(0, stage.offsetTop - 90), behavior: "smooth"});
      });
    });

    if (parent && parent.children && parent.children.length && forNode(parent).length) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "guide-show-all";
      all.textContent = "Toon alle voorzieningen binnen " + parent.label.toLowerCase();
      all.addEventListener("click", () => renderOffers(forNode(parent), parent));
      grid.appendChild(all);
    }
  }

  function groupOrganizations(items) {
    const groups = new Map();
    items.forEach(record => {
      const name = record.organization || record.title || "Onbekende organisatie";
      const key = norm(name);
      if (!groups.has(key)) groups.set(key, {name, items: []});
      groups.get(key).items.push(record);
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }

  function clearDetailMaps() {
    detailMaps.forEach(map => {
      try { map.remove(); } catch {}
    });
    detailMaps = [];
  }

  function hasLocationMap(record) {
    return Boolean(
      record &&
      record.detailMapType &&
      Number.isFinite(record.lat) &&
      Number.isFinite(record.lon)
    );
  }

  function miniMapHtml(record, index) {
    if (!hasLocationMap(record)) return "";
    const address = [record.address, record.postcode, record.town].filter(Boolean).join(", ");
    const label = record.detailMapType === "physical" ? "Bezoeklocatie" : record.detailMapType === "organization" ? "Locatie organisatie" : "Contactadres";
    return '<aside class="guide-offer-map" aria-label="' + esc(label + " van " + (record.title || record.organization)) + '">' +
      '<div class="guide-mini-map" data-guide-map="' + index + '"></div>' +
      '<div class="guide-mini-map-caption"><strong>' + esc(label) + '</strong><span>' + esc(address || record.town || "") + '</span>' +
      (record.displayLocationNote ? '<span class="guide-map-note">' + esc(record.displayLocationNote) + '</span>' : "") +
      '<a href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(record.lat) +
      '&mlon=' + encodeURIComponent(record.lon) + '#map=16/' +
      encodeURIComponent(record.lat) + '/' + encodeURIComponent(record.lon) +
      '" target="_blank" rel="noopener noreferrer">Bekijk op grote kaart</a></div>' +
      '</aside>';
  }

  function initMiniMaps(items) {
    if (typeof L === "undefined") {
      document.querySelectorAll("[data-guide-map]").forEach(element => {
        element.innerHTML = '<div class="guide-map-unavailable">Kaart kon niet worden geladen.</div>';
      });
      return;
    }
    const primary = getComputedStyle(document.body).getPropertyValue("--primary").trim() || "#356b58";
    document.querySelectorAll("[data-guide-map]").forEach(element => {
      const record = items[Number(element.dataset.guideMap)];
      if (!hasLocationMap(record)) return;
      const map = L.map(element, {
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: true
      }).setView([record.lat, record.lon], 15);
      L.tileLayer("https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png", {
        attribution: "Kadaster / PDOK",
        maxNativeZoom: 19,
        maxZoom: 20,
        opacity: .72
      }).addTo(map);
      L.circleMarker([record.lat, record.lon], {
        radius: 8,
        weight: 3,
        color: primary,
        fillColor: primary,
        fillOpacity: .92
      }).addTo(map).bindTooltip(esc(record.title || record.organization), {direction: "top"});
      detailMaps.push(map);
      requestAnimationFrame(() => map.invalidateSize({pan: false}));
    });
  }

  function detailRows(record) {
    const rows = [];
    if (record.audience) rows.push(["Voor wie", record.audience]);
    if (record.access) rows.push(["Toegang", record.access]);
    if (record.costs) rows.push(["Kosten", record.costs]);
    if (record.address) {
      const addressLabel = ["contact", "source-address"].includes(record.locationType) ? "Contactadres" : "Adres";
      rows.push([addressLabel, [record.address, record.postcode, record.town].filter(Boolean).join(", ")]);
    }
    if (record.openingHours) rows.push(["Opening", record.openingHours]);
    if (record.phone) rows.push(["Telefoon", record.phone]);
    if (record.email) rows.push(["E-mail", record.email]);
    if ((record.municipalities || []).length) rows.push(["Gebied", uniq(record.municipalities).join(", ")]);
    return rows.map(row => "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>").join("");
  }

  function offerMeta(record) {
    const parts = [];
    const title = record.title || record.organization || "Voorziening";
    if (record.organization && norm(record.organization) !== norm(title)) parts.push(record.organization);
    const area = municipality();
    const areas = uniq((record.municipalities || []).filter(a => a !== "Twente"));
    if (area && inMunicipality(record)) parts.push(area);
    else if (areas.length >= 10) parts.push("Heel Twente");
    else if (areas.length) parts.push(areas.slice(0,3).join(", ") + (areas.length > 3 ? " e.a." : ""));
    else if (record.town) parts.push(record.town);
    return parts;
  }

  function previewFact(label, value) {
    if (!value) return "";
    return '<span class="guide-result-fact"><strong>' + esc(label) + '</strong><span>' + esc(value) + '</span></span>';
  }

  function activityPreviewHtml(record) {
    const activities = activitiesOf(record);
    if (!activities.length) return "";
    const names = activities.slice(0, 3).map(item => item.name);
    const extra = activities.length > names.length ? " +" + (activities.length - names.length) + " meer" : "";
    return '<span class="guide-result-activities"><strong>Activiteiten</strong><span>' +
      esc(names.join(", ") + extra) + '</span></span>';
  }

  function activitiesHtml(record) {
    const activities = activitiesOf(record);
    if (!activities.length) return "";
    const source = safeUrl(record.activitiesSource);
    const items = activities.map(item => {
      const meta = [item.category, item.schedule, item.location].filter(Boolean);
      return '<div class="guide-activity-item"><strong>' + esc(item.name) + '</strong>' +
        (meta.length ? '<span>' + esc(meta.join(" · ")) + '</span>' : "") +
        (item.description ? '<p>' + esc(item.description) + '</p>' : "") + '</div>';
    }).join("");
    return '<section class="guide-activities" aria-label="Activiteiten en mogelijkheden">' +
      '<div class="guide-activities-head"><h5>Activiteiten en mogelijkheden</h5><span>' + activities.length + '</span></div>' +
      '<div class="guide-activity-list">' + items + '</div>' +
      (record.activitiesNote ? '<p class="guide-activities-note">' + esc(record.activitiesNote) + '</p>' : "") +
      (source ? '<a class="guide-activities-source" href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">Bekijk het actuele activiteitenaanbod</a>' : "") +
      '</section>';
  }

  function relatedOffersHtml(record) {
    const orgKey = norm(record.organization);
    if (!orgKey) return "";
    const related = records
      .filter(item => item.id !== record.id && !item.guideExclude && !item.activityOnly && norm(item.organization) === orgKey)
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "nl-NL"));
    if (!related.length) return "";
    const visible = related.slice(0, 12);
    return '<details class="guide-related"><summary>Meer aanbod van ' + esc(record.organization) +
      ' <span>' + related.length + '</span></summary><div class="guide-related-list">' +
      visible.map(item => '<div><strong>' + esc(item.title || item.organization) + '</strong>' +
        (item.description ? '<span>' + esc(item.description) + '</span>' : "") + '</div>').join("") +
      (related.length > visible.length ? '<p>+' + (related.length - visible.length) + ' andere vormen van aanbod.</p>' : "") +
      '</div></details>';
  }

  function offerResultHtml(record, index) {
    const title = record.title || record.organization || "Voorziening";
    const meta = offerMeta(record);
    const facts = [
      previewFact("Voor wie", record.audience),
      previewFact("Toegang", record.access),
      previewFact("Kosten", record.costs)
    ].filter(Boolean).join("");
    return '<button class="guide-result-card" type="button" data-offer-index="' + index + '">' +
      '<span class="guide-result-top"><span><strong class="guide-result-title">' + esc(title) + '</strong>' +
      (meta.length ? '<small class="guide-result-meta">' + esc(meta.join(" · ")) + '</small>' : "") +
      '</span><span class="guide-result-arrow" aria-hidden="true">›</span></span>' +
      (record.description ? '<span class="guide-result-description">' + esc(record.description) + '</span>' : "") +
      activityPreviewHtml(record) +
      (facts ? '<span class="guide-result-facts">' + facts + '</span>' : "") +
      '<span class="guide-result-cta">Bekijk deze voorziening</span></button>';
  }

  function offerDetailCard(record, mapIndex) {
    const title = record.title || record.organization || "Voorziening";
    const url = safeUrl(record.source);
    const rows = detailRows(record);
    const meta = [
      record.organization && norm(record.organization) !== norm(title) ? record.organization : "",
      record.referenceOnly ? "Specialistisch verwijspunt" : "Sociale kaart",
      record.checked ? "gecontroleerd " + record.checked : ""
    ].filter(Boolean).join(" · ");
    const content = '<div class="guide-offer-content"><h4>' + esc(title) + "</h4>" +
      (meta ? '<div class="guide-offer-meta">' + esc(meta) + "</div>" : "") +
      (record.description ? "<p>" + esc(record.description) + "</p>" : "") +
      activitiesHtml(record) +
      (rows ? "<dl>" + rows + "</dl>" : "") +
      relatedOffersHtml(record) +
      '<div class="guide-offer-actions">' +
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Website van de voorziening</a>' : "") +
      '<a class="secondary" href="voorzieningen.html">Alle voorzieningen</a></div></div>';
    return '<article class="guide-offer' + (hasLocationMap(record) ? " has-map" : "") + '">' +
      content + miniMapHtml(record, mapIndex) + "</article>";
  }

  function renderOfferDetail(record, contextNode, backToSearch, returnHref = "") {
    if (!record) return;
    const results = byId("guide-results");
    const selectedRecord = resolveLocation(record);
    const title = selectedRecord.title || selectedRecord.organization || "Voorziening";
    const meta = offerMeta(selectedRecord);
    byId("guide-grid").hidden = true;
    results.hidden = false;
    byId("guide-heading").textContent = title;
    byId("guide-subheading").textContent = meta.length ? meta.join(" · ") : "Informatie over deze voorziening.";
    byId("guide-status").textContent = "Concrete voorziening";

    clearDetailMaps();
    const backLabel = returnHref ? "← Terug naar sociale kaart" : "← Terug naar resultaten";
    results.innerHTML =
      '<div class="guide-detail-toolbar"><button class="guide-back guide-result-back" id="guide-offer-back" type="button">' + esc(backLabel) + '</button></div>' +
      '<div class="guide-detail-list">' + offerDetailCard(selectedRecord, 0) + "</div>";
    initMiniMaps([selectedRecord]);

    byId("guide-offer-back").addEventListener("click", () => {
      if (returnHref) {
        location.href = returnHref;
        return;
      }
      if (backToSearch) renderSearch(byId("guide-search").value.trim());
      else if (contextNode) renderOffers(forNode(contextNode), contextNode);
      else render();
    });
  }

  function renderOffers(items, node) {
    clearDetailMaps();
    const sortedItems = [...items].sort((a, b) => {
      const titleA = String(a.title || a.organization || "");
      const titleB = String(b.title || b.organization || "");
      return titleA.localeCompare(titleB, "nl-NL");
    });
    byId("guide-grid").hidden = true;
    const results = byId("guide-results");
    results.hidden = false;
    byId("guide-heading").textContent = node ? node.label : "Passende voorzieningen";
    byId("guide-subheading").textContent = sortedItems.length + " " +
      (sortedItems.length === 1 ? "voorziening die" : "voorzieningen die") +
      " bij deze vraag passen. Je ziet meteen wat het aanbod inhoudt.";
    byId("guide-status").textContent = municipality() ? "Gefilterd op " + municipality() + "." : "Heel Twente.";

    results.innerHTML = sortedItems.length
      ? '<div class="guide-offer-results">' + sortedItems.map((record, index) => offerResultHtml(record, index)).join("") + "</div>"
      : emptyState();

    results.querySelectorAll("[data-offer-index]").forEach(button => {
      button.addEventListener("click", () => {
        renderOfferDetail(sortedItems[Number(button.dataset.offerIndex)], node, false);
      });
    });
  }

  function renderSearch(query) {
    clearDetailMaps();
    const q = norm(query);
    const hits = records
      .filter(record => !record.guideExclude && !record.activityOnly && inMunicipality(record) && record._text.includes(q))
      .sort((a, b) => {
        const aTitle = norm(a.title || "");
        const bTitle = norm(b.title || "");
        const aOrg = norm(a.organization || "");
        const bOrg = norm(b.organization || "");
        const score = (title, org) => (title === q ? 4 : title.startsWith(q) ? 3 : title.includes(q) ? 2 : org.includes(q) ? 1 : 0);
        return score(bTitle, bOrg) - score(aTitle, aOrg) ||
          String(a.title || a.organization || "").localeCompare(String(b.title || b.organization || ""), "nl-NL");
      })
      .slice(0, 100);

    byId("guide-grid").hidden = true;
    const results = byId("guide-results");
    results.hidden = false;
    byId("guide-heading").textContent = 'Zoeken naar “' + query + '”';
    byId("guide-subheading").textContent = "Concrete voorzieningen uit de volledige catalogus en gecontroleerde specialistische verwijspunten.";
    byId("guide-status").textContent = hits.length + (hits.length === 100 ? "+" : "") + " " +
      (hits.length === 1 ? "voorziening" : "voorzieningen") +
      (municipality() ? " in " + municipality() : "") + ".";

    results.innerHTML = hits.length
      ? '<div class="guide-search-results">' + hits.map((record, index) => offerResultHtml(record, index)).join("") + "</div>"
      : emptyState();

    results.querySelectorAll("[data-offer-index]").forEach(button => {
      button.addEventListener("click", () => {
        renderOfferDetail(hits[Number(button.dataset.offerIndex)], null, true);
      });
    });
  }

  function render() {
    renderBreadcrumbs();
    const query = byId("guide-search").value.trim();
    const rootView = route.length === 0 && query.length < 2;
    document.body.classList.toggle("guide-root-view", rootView);
    byId("guide-search-clear").hidden = !query;
    byId("guide-back").hidden = route.length === 0;
    byId("guide-status").hidden = rootView;
    const stageTop = document.querySelector(".guide-stage-top");
    if (stageTop) stageTop.hidden = rootView;

    if (query.length >= 2) {
      renderSearch(query);
      return;
    }

    const node = route.length ? findNode(route) : null;
    if (!node) {
      byId("guide-heading").textContent = "Waar zoek je informatie over?";
      byId("guide-subheading").textContent = "";
      byId("guide-status").textContent = records.filter(record => !record.guideExclude && !record.activityOnly && inMunicipality(record)).length + " vormen van aanbod en verwijspunten beschikbaar" + (municipality() ? " in " + municipality() : " in Twente") + ".";
      renderCards(taxonomy, null);
      return;
    }

    byId("guide-heading").textContent = node.label;
    byId("guide-subheading").textContent = node.children && node.children.length ? "Kies de richting die het beste bij de vraag past." : "Hieronder staan passende voorzieningen. Je ziet direct wat het aanbod inhoudt en van welke organisatie het is.";
    const count = forNode(node).length;
    byId("guide-status").textContent = count + " " + (count === 1 ? "passend resultaat" : "passende resultaten") + (municipality() ? " in " + municipality() : " in Twente") + ".";
    if (node.children && node.children.length) renderCards(node.children, node);
    else renderOffers(forNode(node), node);
  }

  function normalizeData(catalog, facilities, curated) {
    const list = [];
    const catalogById = new Map((catalog || []).filter(group => group && group.id).map(group => [group.id, group]));
    const physicalAddressIndex = new Map();
    const addressKey = item => norm([item.address, item.town].filter(Boolean).join("|"));
    (facilities || []).forEach(facility => {
      if (
        facility.physicalLocation === true &&
        facility.mapLocationType !== "service-area" &&
        Number.isFinite(facility.lat) &&
        Number.isFinite(facility.lon) &&
        facility.address &&
        facility.town
      ) {
        physicalAddressIndex.set(addressKey(facility), facility);
      }
    });

    (catalog || []).forEach(group => {
      const organization = group.organization || group.name || "Onbekende organisatie";
      (group.offers || []).forEach((offer, index) => {
        const offerAreas = uniq([...(offer.municipalities || []), offer.municipality]);
        list.push({
          id: offer.id || (group.id || norm(organization)) + "-" + index,
          catalogOrganizationId: group.id || "",
          catalogOfferId: offer.id || "",
          organization,
          title: offer.title || offer.name || organization,
          municipalities: offerAreas.length ? offerAreas : uniq(group.municipalities || []),
          description: offer.description || "",
          audience: offer.audience || "",
          access: offer.access || "",
          costs: offer.costs || "",
          openingHours: offer.openingHours || "",
          phone: offer.phone || "",
          email: offer.email || "",
          address: offer.address || "",
          postcode: offer.postcode || "",
          town: offer.town || "",
          locationMunicipality: offer.locationMunicipality || "",
          locationType: offer.locationType || "",
          mapLocationType: offer.mapLocationType || "",
          physicalLocation: offer.physicalLocation === true,
          lat: Number.isFinite(offer.lat) ? offer.lat : null,
          lon: Number.isFinite(offer.lon) ? offer.lon : null,
          source: offer.source || group.primarySource || (group.sources || [])[0] || "",
          themes: offer.themes || [],
          subthemes: offer.subthemes || [],
          tags: offer.tags || [],
          guidePaths: offer.guidePaths || [],
          guideExclude: Boolean(offer.guideExclude),
          activityOnly: Boolean(offer.activityOnly),
          activities: offer.activities || [],
          activitiesNote: offer.activitiesNote || "",
          activitiesSource: offer.activitiesSource || "",
          activitiesUpdated: offer.activitiesUpdated || "",
          category: offer.category || "",
          checked: offer.checked || group.checked || ""
        });
      });
    });

    (facilities || []).forEach(facility => {
      const linkedGroup = facility.catalogOrganizationId ? catalogById.get(facility.catalogOrganizationId) : null;
      const linkedOffer = linkedGroup && facility.catalogOfferId
        ? (linkedGroup.offers || []).find(offer => offer.id === facility.catalogOfferId)
        : null;

      // De kaartlocatie verrijkt het catalogusaanbod; hij wordt niet nogmaals
      // als losse Wegwijzer-voorziening getoond.
      if (linkedGroup && !linkedOffer && String(facility.id || "").startsWith("catalog-")) return;

      const rawName = String(facility.name || "");
      const fallbackOrganization = rawName.split(" · ")[0] || facility.name;
      const fallbackTitle = rawName.includes(" · ")
        ? rawName.split(" · ").slice(1).join(" · ").trim()
        : facility.name;

      list.push({
        id: linkedOffer?.id || facility.id,
        catalogOrganizationId: linkedGroup?.id || facility.catalogOrganizationId || "",
        catalogOfferId: linkedOffer?.id || facility.catalogOfferId || "",
        organization: linkedGroup?.organization || fallbackOrganization,
        title: linkedOffer?.title || linkedOffer?.name || fallbackTitle,
        municipalities: uniq([facility.municipality, ...(facility.serviceMunicipalities || []), ...(facility.municipalities || [])]),
        description: facility.description || "",
        audience: facility.audience || "",
        access: facility.access || "",
        costs: facility.costs || "",
        openingHours: facility.openingHours || "",
        phone: facility.phone || "",
        email: facility.email || "",
        address: facility.address || "",
        postcode: facility.postcode || "",
        town: facility.town || "",
        locationMunicipality: facility.locationMunicipality || "",
        locationType: facility.locationType || "",
        mapLocationType: facility.mapLocationType || "",
        physicalLocation: facility.physicalLocation === true,
        lat: Number.isFinite(facility.lat) ? facility.lat : null,
        lon: Number.isFinite(facility.lon) ? facility.lon : null,
        source: facility.source || "",
        themes: facility.themes || [],
        subthemes: facility.subthemes || [],
        tags: uniq([...(facility.tags || []), facility.category]),
        guidePaths: facility.guidePaths || [],
        guideExclude: Boolean(facility.guideExclude),
        activityOnly: Boolean(facility.activityOnly),
        activities: facility.activities || [],
        activitiesNote: facility.activitiesNote || "",
        activitiesSource: facility.activitiesSource || "",
        activitiesUpdated: facility.activitiesUpdated || "",
        category: facility.category || "",
        checked: facility.checked || ""
      });
    });

    (curated || []).forEach(item => list.push({...item, referenceOnly: true}));

    const merged = new Map();
    list.forEach(record => {
      if (!record.title && !record.organization) return;
      const key = norm((record.organization || "") + "|" + (record.title || ""));
      if (!merged.has(key)) {
        merged.set(key, {
          ...record,
          municipalities: uniq(record.municipalities),
          themes: uniq(record.themes),
          subthemes: uniq(record.subthemes),
          tags: uniq(record.tags),
          routeTags: uniq(record.routeTags),
          guidePaths: uniq(record.guidePaths),
          guideExclude: Boolean(record.guideExclude),
          activityOnly: Boolean(record.activityOnly),
          activities: mergeActivities(record.activities || [])
        });
        return;
      }
      const current = merged.get(key);
      current.municipalities = uniq([...(current.municipalities || []), ...(record.municipalities || [])]);
      current.themes = uniq([...(current.themes || []), ...(record.themes || [])]);
      current.subthemes = uniq([...(current.subthemes || []), ...(record.subthemes || [])]);
      current.tags = uniq([...(current.tags || []), ...(record.tags || [])]);
      current.routeTags = uniq([...(current.routeTags || []), ...(record.routeTags || [])]);
      current.guidePaths = uniq([...(current.guidePaths || []), ...(record.guidePaths || [])]);
      current.guideExclude = Boolean(current.guideExclude || record.guideExclude);
      current.activityOnly = Boolean(current.activityOnly || record.activityOnly);
      current.activities = mergeActivities(current.activities || [], record.activities || []);
      ["description","audience","access","costs","openingHours","phone","email","address","postcode","town","source","checked","activitiesNote","activitiesSource","activitiesUpdated"].forEach(field => {
        if (record[field] && (!current[field] || String(record[field]).length > String(current[field]).length)) current[field] = record[field];
      });
      if (record.physicalLocation === true) {
        current.physicalLocation = true;
        if (Number.isFinite(record.lat) && Number.isFinite(record.lon)) {
          current.lat = record.lat;
          current.lon = record.lon;
        }
        if (record.locationMunicipality) current.locationMunicipality = record.locationMunicipality;
        if (record.address) current.address = record.address;
        if (record.postcode) current.postcode = record.postcode;
        if (record.town) current.town = record.town;
        if (record.locationType) current.locationType = record.locationType;
        if (record.mapLocationType) current.mapLocationType = record.mapLocationType;
      } else {
        current.physicalLocation = Boolean(current.physicalLocation);
        if (!current.locationMunicipality && record.locationMunicipality) current.locationMunicipality = record.locationMunicipality;
        if (!current.locationType && record.locationType) current.locationType = record.locationType;
        if (!current.mapLocationType && record.mapLocationType) current.mapLocationType = record.mapLocationType;
        if (!Number.isFinite(current.lat) && Number.isFinite(record.lat)) current.lat = record.lat;
        if (!Number.isFinite(current.lon) && Number.isFinite(record.lon)) current.lon = record.lon;
      }
      current.referenceOnly = Boolean(current.referenceOnly && record.referenceOnly);
    });

    return [...merged.values()].map(record => {
      const knownPlace = physicalAddressIndex.get(addressKey(record));
      const enriched = {...record};
      if (
        knownPlace &&
        (!Number.isFinite(enriched.lat) || !Number.isFinite(enriched.lon))
      ) {
        enriched.lat = knownPlace.lat;
        enriched.lon = knownPlace.lon;
        enriched.locationMunicipality = enriched.locationMunicipality || knownPlace.locationMunicipality || knownPlace.municipality || "";
      }
      if (
        enriched.physicalLocation === true &&
        Number.isFinite(enriched.lat) &&
        Number.isFinite(enriched.lon)
      ) {
        enriched.detailMapType = "physical";
      } else if (
        knownPlace &&
        Number.isFinite(enriched.lat) &&
        Number.isFinite(enriched.lon)
      ) {
        enriched.detailMapType = "contact";
      } else {
        enriched.detailMapType = "";
      }
      return {...enriched, _text: recordText(enriched)};
    });
  }

  async function loadJson(path) {
    try {
      const response = await fetch(path, {cache: "no-store"});
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } catch (error) {
      console.warn("Kon " + path + " niet laden", error);
      return [];
    }
  }

  function mapReturnHref() {
    const params = new URLSearchParams();
    const area = municipality();
    if (area) params.set("gemeente", area);
    const query = params.toString();
    return "index.html" + (query ? "?" + query : "");
  }

  function renderRequestedRecord(params) {
    const requestedOffer = params.get("voorziening") || "";
    const requestedOrganization = params.get("organisatie") || "";

    if (requestedOffer) {
      const record = records.find(item => item.id === requestedOffer || item.catalogOfferId === requestedOffer);
      if (record) {
        renderOfferDetail(record, null, false, mapReturnHref());
        return true;
      }
    }

    if (requestedOrganization) {
      const items = records.filter(item =>
        item.catalogOrganizationId === requestedOrganization &&
        !item.guideExclude &&
        !item.activityOnly &&
        inMunicipality(item)
      );
      if (items.length === 1) {
        renderOfferDetail(items[0], null, false, mapReturnHref());
        return true;
      }
      if (items.length) {
        renderOffers(items, null);
        const organization = items[0].organization || "Voorziening";
        byId("guide-heading").textContent = organization;
        byId("guide-subheading").textContent = items.length + " onderdelen en activiteiten van deze voorziening.";
        const results = byId("guide-results");
        results.insertAdjacentHTML("afterbegin",
          '<div class="guide-detail-toolbar"><button class="guide-back guide-result-back" id="guide-map-back" type="button">← Terug naar sociale kaart</button></div>'
        );
        byId("guide-map-back").addEventListener("click", () => { location.href = mapReturnHref(); });
        return true;
      }
    }
    return false;
  }

  async function init() {
    setupTheme();
    const loaded = await Promise.all([
      loadJson("data/catalog.json"),
      loadJson("data/facilities.json"),
      loadJson("data/wegwijzer-curated.json"),
      loadJson("data/wegwijzer-themas.json")
    ]);
    taxonomy = Array.isArray(loaded[3]) ? loaded[3] : [];
    records = normalizeData(loaded[0], loaded[1], loaded[2]);
    readHash();

    const areas = uniq(records.flatMap(record => record.municipalities || [])).filter(area => area && area !== "Twente").sort((a, b) => a.localeCompare(b, "nl-NL"));
    byId("guide-municipality").innerHTML = '<option value="">Heel Twente</option>' + areas.map(area => "<option>" + esc(area) + "</option>").join("");

    const initialParams = new URLSearchParams(location.search);
    const requestedArea = initialParams.get("gemeente") || "";
    const matchedArea = areas.find(area => norm(area) === norm(requestedArea));
    if (matchedArea) byId("guide-municipality").value = matchedArea;

    byId("guide-municipality").addEventListener("change", render);
    byId("guide-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 120);
    });
    byId("guide-search-clear").addEventListener("click", () => {
      byId("guide-search").value = "";
      render();
      byId("guide-search").focus();
    });
    byId("guide-back").addEventListener("click", () => {
      if (!route.length) return;
      route.pop();
      writeHash();
      render();
    });
    addEventListener("popstate", () => { readHash(); render(); });
    addEventListener("hashchange", () => { readHash(); render(); });

    byId("guide-status").textContent = records.length ? "" : "Er konden geen gegevens worden geladen.";
    if (!renderRequestedRecord(initialParams)) render();
  }

  init();
})();
