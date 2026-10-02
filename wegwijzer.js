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

  let taxonomy = [];
  let records = [];
  let route = [];
  let searchTimer = 0;

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

  function recordText(record) {
    return norm([
      record.organization, record.title, record.description, record.audience, record.access, record.costs,
      (record.themes || []).join(" "), (record.subthemes || []).join(" "),
      (record.tags || []).join(" "), (record.routeTags || []).join(" ")
    ].join(" "));
  }

  function matchesNode(node, record) {
    if (node.children && node.children.length) return node.children.some(child => matchesNode(child, record));
    const text = record._text || recordText(record);
    return (node.include || []).some(term => text.includes(norm(term)));
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
    return records.filter(record => inMunicipality(record) && matchesNode(node, record));
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
    const grid = byId("guide-grid");
    const results = byId("guide-results");
    grid.hidden = false;
    results.hidden = true;

    grid.innerHTML = nodes.map(node => {
      const count = forNode(node).length;
      const countLabel = count + " " + (count === 1 ? "resultaat" : "resultaten");
      return '<button class="guide-card" type="button" data-node="' + esc(node.id) + '"' + (count ? "" : " disabled") + ">" +
        '<span class="guide-card-heading"><strong>' + esc(node.label) + '</strong><span class="guide-card-count" title="' + esc(countLabel) + '" aria-label="' + esc(countLabel) + '">' + count + "</span></span>" +
        (node.description ? "<p>" + esc(node.description) + "</p>" : "") +
        "</button>";
    }).join("");

    grid.querySelectorAll("[data-node]").forEach(button => {
      button.addEventListener("click", () => {
        route.push(button.dataset.node);
        writeHash();
        render();
        window.scrollTo({top: 0, behavior: "smooth"});
      });
    });

    if (parent && parent.children && parent.children.length && forNode(parent).length) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "guide-show-all";
      all.textContent = "Toon alle organisaties binnen " + parent.label.toLowerCase();
      all.addEventListener("click", () => renderOrganizations(forNode(parent), parent));
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

  function detailRows(record) {
    const rows = [];
    if (record.audience) rows.push(["Voor wie", record.audience]);
    if (record.access) rows.push(["Toegang", record.access]);
    if (record.costs) rows.push(["Kosten", record.costs]);
    if ((record.municipalities || []).length) rows.push(["Gebied", uniq(record.municipalities).join(", ")]);
    return rows.map(row => "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>").join("");
  }

  function renderOrganizationDetail(items, contextNode, backToSearch) {
    const results = byId("guide-results");
    const organization = items[0] ? (items[0].organization || items[0].title) : "Organisatie";
    byId("guide-grid").hidden = true;
    results.hidden = false;
    byId("guide-heading").textContent = organization;
    byId("guide-subheading").textContent = items.length + " " + (items.length === 1 ? "onderdeel" : "onderdelen") + " binnen de gekozen route.";

    const cards = [...items].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "nl-NL")).map(record => {
      const url = safeUrl(record.source);
      const rows = detailRows(record);
      return '<article class="guide-offer"><h4>' + esc(record.title || organization) + "</h4>" +
        '<div class="guide-offer-meta">' + (record.referenceOnly ? "Specialistisch verwijspunt" : "Sociale kaart") + (record.checked ? " · gecontroleerd " + esc(record.checked) : "") + "</div>" +
        (record.description ? "<p>" + esc(record.description) + "</p>" : "") +
        (rows ? "<dl>" + rows + "</dl>" : "") +
        '<div class="guide-offer-actions">' +
        (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Website / bron</a>' : "") +
        '<a class="secondary" href="voorzieningen.html">Alle voorzieningen</a></div></article>';
    }).join("");

    results.innerHTML = '<div class="guide-detail-head"><div><h3>' + esc(organization) + '</h3><p>Bekijk hieronder de concrete vormen van aanbod.</p></div><button class="guide-back" id="guide-org-back" type="button">Andere organisatie</button></div><div class="guide-detail-list">' + cards + "</div>";

    byId("guide-org-back").addEventListener("click", () => {
      if (backToSearch) renderSearch(byId("guide-search").value.trim());
      else renderOrganizations(forNode(contextNode), contextNode);
    });
  }

  function renderOrganizations(items, node) {
    const groups = groupOrganizations(items);
    byId("guide-grid").hidden = true;
    const results = byId("guide-results");
    results.hidden = false;
    byId("guide-heading").textContent = node ? node.label : "Passende organisaties";
    byId("guide-subheading").textContent = groups.length + " " + (groups.length === 1 ? "organisatie" : "organisaties") + " met " + items.length + " " + (items.length === 1 ? "vorm" : "vormen") + " van aanbod.";
    byId("guide-status").textContent = municipality() ? "Gefilterd op " + municipality() + "." : "Heel Twente.";

    results.innerHTML = groups.length ? '<div class="guide-org-list">' + groups.map(group => {
      const areas = uniq(group.items.flatMap(item => item.municipalities || [])).filter(area => area !== "Twente").slice(0, 4);
      return '<button class="guide-org" type="button" data-org="' + esc(group.name) + '"><strong>' + esc(group.name) + "</strong><small>" + group.items.length + " " + (group.items.length === 1 ? "passend onderdeel" : "passende onderdelen") + (areas.length ? " · " + esc(areas.join(", ")) : "") + "</small></button>";
    }).join("") + "</div>" : emptyState();

    results.querySelectorAll("[data-org]").forEach(button => {
      button.addEventListener("click", () => {
        const group = groups.find(item => item.name === button.dataset.org);
        if (group) renderOrganizationDetail(group.items, node, false);
      });
    });
  }

  function renderSearch(query) {
    const q = norm(query);
    const hits = records.filter(record => inMunicipality(record) && record._text.includes(q)).slice(0, 100);
    byId("guide-grid").hidden = true;
    const results = byId("guide-results");
    results.hidden = false;
    byId("guide-heading").textContent = 'Zoeken naar “' + query + '”';
    byId("guide-subheading").textContent = "Resultaten uit de volledige catalogus en gecontroleerde specialistische verwijspunten.";
    byId("guide-status").textContent = hits.length + (hits.length === 100 ? "+" : "") + " " + (hits.length === 1 ? "resultaat" : "resultaten") + (municipality() ? " in " + municipality() : "") + ".";

    results.innerHTML = hits.length ? '<div class="guide-search-results">' + hits.map((record, index) => {
      const areas = (record.municipalities || []).join(", ");
      return '<button class="guide-search-hit" type="button" data-hit="' + index + '"><strong>' + esc(record.title || record.organization) + "</strong><small>" + esc(record.organization || "") + (areas ? " · " + esc(areas) : "") + "</small></button>";
    }).join("") + "</div>" : emptyState();

    results.querySelectorAll("[data-hit]").forEach(button => {
      button.addEventListener("click", () => {
        const selected = hits[Number(button.dataset.hit)];
        const sameOrg = hits.filter(item => (item.organization || item.title) === (selected.organization || selected.title));
        renderOrganizationDetail(sameOrg, null, true);
      });
    });
  }

  function render() {
    renderBreadcrumbs();
    const query = byId("guide-search").value.trim();
    byId("guide-search-clear").hidden = !query;
    byId("guide-back").hidden = route.length === 0;
    if (query.length >= 2) {
      renderSearch(query);
      return;
    }

    const node = route.length ? findNode(route) : null;
    if (!node) {
      byId("guide-heading").textContent = "Waar gaat de vraag over?";
      byId("guide-subheading").textContent = "Kies een hoofdthema. Je kunt daarna steeds specifieker kiezen.";
      byId("guide-status").textContent = records.filter(inMunicipality).length + " vormen van aanbod en verwijspunten beschikbaar" + (municipality() ? " in " + municipality() : " in Twente") + ".";
      renderCards(taxonomy, null);
      return;
    }

    byId("guide-heading").textContent = node.label;
    byId("guide-subheading").textContent = node.children && node.children.length ? "Kies de richting die het beste bij de vraag past." : "Hieronder staan organisaties met passend aanbod binnen deze route.";
    const count = forNode(node).length;
    byId("guide-status").textContent = count + " " + (count === 1 ? "passend resultaat" : "passende resultaten") + (municipality() ? " in " + municipality() : " in Twente") + ".";
    if (node.children && node.children.length) renderCards(node.children, node);
    else renderOrganizations(forNode(node), node);
  }

  function normalizeData(catalog, facilities, curated) {
    const list = [];

    (catalog || []).forEach(group => {
      const organization = group.organization || group.name || "Onbekende organisatie";
      (group.offers || []).forEach((offer, index) => list.push({
        id: offer.id || (group.id || norm(organization)) + "-" + index,
        organization,
        title: offer.title || offer.name || organization,
        municipalities: uniq([...(group.municipalities || []), ...(offer.municipalities || [])]),
        description: offer.description || "",
        audience: offer.audience || "",
        access: offer.access || "",
        costs: offer.costs || "",
        source: offer.source || group.primarySource || (group.sources || [])[0] || "",
        themes: offer.themes || [],
        subthemes: offer.subthemes || [],
        tags: offer.tags || [],
        category: offer.category || "",
        checked: offer.checked || group.checked || ""
      }));
    });

    (facilities || []).forEach(facility => list.push({
      id: facility.id,
      organization: String(facility.name || "").split(" · ")[0] || facility.name,
      title: facility.name,
      municipalities: uniq([facility.municipality, ...(facility.serviceMunicipalities || []), ...(facility.municipalities || [])]),
      description: facility.description || "",
      audience: facility.audience || "",
      access: facility.access || "",
      costs: facility.costs || "",
      source: facility.source || "",
      themes: facility.themes || [],
      subthemes: facility.subthemes || [],
      tags: uniq([...(facility.tags || []), facility.category]),
      category: facility.category || "",
      checked: facility.checked || ""
    }));

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
          routeTags: uniq(record.routeTags)
        });
        return;
      }
      const current = merged.get(key);
      current.municipalities = uniq([...(current.municipalities || []), ...(record.municipalities || [])]);
      current.themes = uniq([...(current.themes || []), ...(record.themes || [])]);
      current.subthemes = uniq([...(current.subthemes || []), ...(record.subthemes || [])]);
      current.tags = uniq([...(current.tags || []), ...(record.tags || [])]);
      current.routeTags = uniq([...(current.routeTags || []), ...(record.routeTags || [])]);
      ["description","audience","access","costs","source","checked"].forEach(field => {
        if (record[field] && (!current[field] || String(record[field]).length > String(current[field]).length)) current[field] = record[field];
      });
      current.referenceOnly = Boolean(current.referenceOnly && record.referenceOnly);
    });

    return [...merged.values()].map(record => ({...record, _text: recordText(record)}));
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
    render();
  }

  init();
})();
