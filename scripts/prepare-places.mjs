import fs from "node:fs/promises";
const query =
  '[out:json][timeout:120];area["ISO3166-1"="ZA"]["boundary"="administrative"]->.za;nwr["place"~"^(city|town|village|suburb|neighbourhood|hamlet)$"]["name"](area.za);out center tags;';
await fs.mkdir("data/place-names", { recursive: true });
let raw;
try {
  raw = JSON.parse(
    await fs.readFile("data/place-names/osm-places.json", "utf8"),
  );
} catch {
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) throw Error(`Place source HTTP ${response.status}`);
  raw = await response.json();
  await fs.writeFile("data/place-names/osm-places.json", JSON.stringify(raw));
}
if (raw.remark || !raw.elements?.length) throw Error("Incomplete place source");
const seen = new Set(),
  places = [];
for (const p of raw.elements) {
  const c = p.center ?? p;
  if (!Number.isFinite(c.lon) || !Number.isFinite(c.lat)) continue;
  const key = p.tags.name + ":" + c.lon.toFixed(3) + ":" + c.lat.toFixed(3);
  if (seen.has(key)) continue;
  seen.add(key);
  places.push({
    id: `osm-${p.type}-${p.id}`,
    name: p.tags.name,
    kind: p.tags.place,
    center: [+c.lon.toFixed(6), +c.lat.toFixed(6)],
  });
}
await fs.writeFile(
  "public/gis/places.json",
  JSON.stringify({
    source: "OpenStreetMap contributors",
    license: "ODbL-1.0",
    licenseURL: "https://www.openstreetmap.org/copyright",
    sourceTimestamp: raw.osm3s?.timestamp_osm_base,
    places,
  }),
);
console.log(`Prepared ${places.length} real geographic place names`);
