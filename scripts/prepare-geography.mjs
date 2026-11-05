import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import polygonClipping from "polygon-clipping";
import { pointOnFeature } from "@turf/point-on-feature";
const exec = promisify(execFile);
const root = "public/gis";
await fs.mkdir("research", { recursive: true });
await fs.mkdir(root, { recursive: true });
async function source(file, url) {
  try {
    return JSON.parse(await fs.readFile("research/" + file, "utf8"));
  } catch {
    await exec(
      process.platform === "win32" ? "curl.exe" : "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "55",
        "--max-filesize",
        "80000000",
        url,
        "-o",
        "research/" + file,
      ],
      { timeout: 60000 },
    );
    return JSON.parse(await fs.readFile("research/" + file, "utf8"));
  }
}
const base = "https://results.elections.org.za/ElectionMap/MapData/2026/";
const [wardGeo, muniGeo, provinceGeo] = await Promise.all([
  source("iec-national-wards.json", base + "nationalWard.js"),
  source("iec-national-munis.json", base + "nationalMunic.js"),
  source("iec-national-provinces.json", base + "nationalProvince.js"),
]);
function coords(c) {
  return typeof c[0] === "number"
    ? c.map((n) => Math.round(n * 1e6) / 1e6)
    : c.map(coords);
}
function bounds(geometry) {
  let west = 180,
    south = 90,
    east = -180,
    north = -90;
  function visit(c) {
    if (typeof c[0] === "number") {
      west = Math.min(west, c[0]);
      east = Math.max(east, c[0]);
      south = Math.min(south, c[1]);
      north = Math.max(north, c[1]);
    } else c.forEach(visit);
  }
  visit(geometry.coordinates);
  return [west, south, east, north];
}
const center = (geometry) =>
  pointOnFeature({ type: "Feature", properties: {}, geometry }).geometry
    .coordinates;
function feature(geometry, properties) {
  return {
    type: "Feature",
    id: properties.id,
    properties: { ...properties, center: center(geometry) },
    geometry: {
      type: geometry.type,
      coordinates: coords(geometry.coordinates),
    },
  };
}
const collection = (features) => ({ type: "FeatureCollection", features });
const municipalities = muniGeo.features.map((f) => {
  const p = f.properties;
  return {
    id: String(p.MunicId),
    name: p.Municipali,
    code: p.MunicCode,
    provinceId: String(p.ProvinceId ?? p.ProvincId),
    districtId: String(p.DCId),
    districtCode: p.DCCode,
    districtName: p.DCMunic,
    isMetro: !String(p.DCCode).startsWith("DC"),
    bounds: bounds(f.geometry),
    center: center(f.geometry),
  };
});
const municipalityIndex = new Map(municipalities.map((m) => [m.id, m]));
const wards = wardGeo.features.map((f) => {
  const p = f.properties;
  const municipalityId = String(p.fklMunicId ?? p.MunicId);
  if (!municipalityIndex.has(municipalityId))
    throw Error("Unknown municipality " + municipalityId);
  return {
    id: String(p.PklWardID),
    number: p.WardNo,
    municipalityId,
    provinceId: municipalityIndex.get(municipalityId).provinceId,
    bounds: bounds(f.geometry),
    center: center(f.geometry),
  };
});
const wardIndex = new Map(wards.map((w) => [w.id, w]));
if (
  wards.length !== 4485 ||
  wardIndex.size !== 4485 ||
  municipalities.length !== 213
)
  throw Error("Unexpected 2026 geography coverage.");
const votingDistricts = {};
for (let offset = 0; offset < 24000; offset += 2000) {
  const url = new URL(
    "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/VotingDistricts2026_Final/FeatureServer/0/query",
  );
  url.search = new URLSearchParams({
    where: "1=1",
    outFields: "FID,VDNumber,WardId,MunicCode,Province",
    returnGeometry: "false",
    orderByFields: "FID",
    resultOffset: String(offset),
    resultRecordCount: "2000",
    f: "json",
  });
  const page = await source(`mdb-vds-${offset}.json`, url.href);
  if (page.error) throw Error(JSON.stringify(page.error));
  for (const f of page.features) {
    const p = f.attributes;
    if (!wardIndex.has(String(p.WardId))) throw Error("Orphan voting district");
    if (votingDistricts[p.VDNumber]) throw Error("Duplicate voting district");
    votingDistricts[p.VDNumber] = String(p.WardId);
  }
}
if (Object.keys(votingDistricts).length !== 23696)
  throw Error("Incomplete voting-district registry.");
const provinces = provinceGeo.features.map((f) => {
  const p = f.properties;
  const id = String(p.ProvinceId ?? p.ProvincId ?? p.ProvinceID);
  if (!/^[1-9]$/.test(id))
    throw Error("Unknown province schema: " + JSON.stringify(p));
  return {
    id,
    name: p.Province ?? p.ProvName ?? p.name,
    bounds: bounds(f.geometry),
    center: center(f.geometry),
  };
});
if (provinces.length !== 9) throw Error("Province coverage incomplete.");
await fs.mkdir(root + "/municipalities", { recursive: true });
await fs.mkdir(root + "/wards", { recursive: true });
await fs.mkdir(root + "/districts", { recursive: true });
await fs.writeFile(
  root + "/provinces.geojson",
  JSON.stringify(
    collection(
      provinceGeo.features.map((f, i) =>
        feature(f.geometry, {
          id: provinces[i].id,
          name: provinces[i].name,
          kind: "province",
        }),
      ),
    ),
  ),
);
await fs.writeFile(
  root + "/municipalities.geojson",
  JSON.stringify(
    collection(
      muniGeo.features.map((f) => {
        const m = municipalityIndex.get(String(f.properties.MunicId));
        return feature(f.geometry, {
          id: m.id,
          name: m.name,
          kind: "municipality",
          provinceId: m.provinceId,
          districtId: m.districtId,
          districtCode: m.districtCode,
        });
      }),
    ),
  ),
);
for (const province of provinces) {
  const ff = muniGeo.features.filter(
    (f) =>
      String(f.properties.ProvinceId ?? f.properties.ProvincId) === province.id,
  );
  await fs.writeFile(
    root + `/municipalities/${province.id}.geojson`,
    JSON.stringify(
      collection(
        ff.map((f) => {
          const m = municipalityIndex.get(String(f.properties.MunicId));
          return feature(f.geometry, {
            id: m.id,
            name: m.name,
            kind: "municipality",
            districtId: m.districtId,
            districtCode: m.districtCode,
          });
        }),
      ),
    ),
  );
}
const districts = [];
for (const id of new Set(
  municipalities.filter((m) => !m.isMetro).map((m) => m.districtId),
)) {
  const members = muniGeo.features.filter(
    (f) => String(f.properties.DCId) === id,
  );
  const m = municipalityIndex.get(String(members[0].properties.MunicId));
  const polygons = members.map((f) =>
    f.geometry.type === "Polygon"
      ? [coords(f.geometry.coordinates)]
      : coords(f.geometry.coordinates),
  );
  const geometry = {
    type: "MultiPolygon",
    coordinates: polygonClipping.union(...polygons),
  };
  districts.push({
    id,
    name: m.districtName,
    code: m.districtCode,
    provinceId: m.provinceId,
    bounds: bounds(geometry),
    center: center(geometry),
  });
  await fs.writeFile(
    root + `/districts/${id}.geojson`,
    JSON.stringify(
      collection([
        feature(geometry, { id, name: m.districtName, kind: "district" }),
      ]),
    ),
  );
}
for (const m of municipalities) {
  const ff = wardGeo.features.filter(
    (f) => String(f.properties.fklMunicId ?? f.properties.MunicId) === m.id,
  );
  await fs.writeFile(
    root + `/wards/${m.id}.geojson`,
    JSON.stringify(
      collection(
        ff.map((f) => {
          const w = wardIndex.get(String(f.properties.PklWardID));
          return feature(f.geometry, {
            id: w.id,
            name: `Ward ${w.number}`,
            number: w.number,
            kind: "ward",
            municipalityId: m.id,
          });
        }),
      ),
    ),
  );
}
const registry = {
  eventId: 1887,
  year: 2026,
  provinces,
  municipalities,
  wards,
  districts,
  votingDistricts,
};
await fs.writeFile(root + "/registry.json", JSON.stringify(registry));
const manifest = {
  eventId: 1887,
  preparedAt: new Date().toISOString(),
  source: base,
  wards: wards.length,
  votingDistricts: Object.keys(votingDistricts).length,
  municipalities: municipalities.length,
  districtCouncils: districts.length,
  sha256: createHash("sha256").update(JSON.stringify(registry)).digest("hex"),
  attribution:
    "Boundary source: Electoral Commission of South Africa; voting-district registry: Municipal Demarcation Board. 2026 event geometry.",
};
await fs.writeFile(root + "/manifest.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
