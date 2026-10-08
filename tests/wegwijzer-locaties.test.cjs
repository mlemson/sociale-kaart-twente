#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "..", "wegwijzer.js"), "utf8");
const exposed = js.replace(/\binit\(\);\s*\}\)\(\);\s*$/, "return {normalizeData,resolveLocation};\n})();");
assert.notEqual(exposed, js, "Kon Wegwijzer-functies niet vinden");
let area = "";
const doc = { getElementById: () => ({value:area}) };
const {normalizeData,resolveLocation} = new Function("document", "return " + exposed)(doc);
const offer = (id, town, lat, lon) => ({
  id, title:"Ondersteuning", municipalities:["Enschede","Hengelo","Borne"],
  address:"Hoofdstraat " + id, town, locationMunicipality:town,
  mapLocationType:"address", locationType:"visiting", mapPin:true, lat, lon
});
const catalog = [{
  id:"org-test", organization:"Voorbeeldorganisatie",
  municipalities:["Enschede","Hengelo","Borne"],
  offers:[offer("e","Enschede",52.22,6.89),offer("h","Hengelo",52.265,6.793)]
}];
const records = normalizeData(catalog,[],[]);
assert.equal(records.length,1,"Identiek aanbod wordt één record");
area = "Enschede";
assert.equal(resolveLocation(records[0]).town,"Enschede","Kies lokale Enschede-vestiging");
area = "Hengelo";
assert.equal(resolveLocation(records[0]).town,"Hengelo","Kies lokale Hengelo-vestiging");
area = "Borne";
assert.match(resolveLocation(records[0]).displayLocationNote,/Geen bevestigde locatie in Borne/);
area = "";
assert.equal(resolveLocation(records[0]).detailMapType,"physical");
const noAddress = normalizeData([{
  id:"org-n",organization:"Noodfonds",offers:[{
    id:"x",title:"Financiële hulp",municipalities:["Enschede"],
    lat:52.22,lon:6.89,mapLocationType:"service-area"
  }]
}],[],[]);
area = "Enschede";
assert.equal(resolveLocation(noAddress[0]).detailMapType,"","Geen fictieve kaartpin voor werkgebied");
const fallback = normalizeData([{
  id:"org-o",organization:"Organisatie",offers:[{
    id:"y",title:"Vrijwilligershulp",municipalities:["Enschede"]
  }]
}],[{
  id:"site",catalogOrganizationId:"org-o",physicalLocation:true,
  mapLocationType:"address",address:"Markt 1",town:"Enschede",
  locationMunicipality:"Enschede",lat:52.22,lon:6.893
}],[]);
assert.equal(resolveLocation(fallback[0]).detailMapType,"organization");
assert.match(resolveLocation(fallback[0]).displayLocationNote,/niet noodzakelijk/);
const contacts = normalizeData([{
  id:"org-c",organization:"Bureau",offers:[{
    id:"z",title:"Contact",municipalities:["Enschede"],
    address:"Kantoor 1",town:"Enschede",
    locationMunicipality:"Enschede",locationType:"contact",
    mapLocationType:"address",lat:52.22,lon:6.89
  }]
}],[],[]);
assert.equal(resolveLocation(contacts[0]).detailMapType,"contact");
console.log("Wegwijzer-locatietests geslaagd: lokaal, fallback, contact, deduplicatie en geen fictieve pins.");
