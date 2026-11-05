import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { download, SourceError } from "./public-source.mjs";

export const registry = JSON.parse(
  await readFile("public/gis/registry.json", "utf8"),
);
const municipalities = new Map(registry.municipalities.map((m) => [m.id, m]));
const wards = new Map(registry.wards.map((w) => [w.id, w]));
const districts = new Map(registry.districts.map((d) => [d.id, d]));
const provinces = new Map(registry.provinces.map((p) => [p.id, p]));
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const integer = (value) => {
  if (!/^\d+$/.test(String(value).trim()))
    throw new SourceError("Invalid integer in published CSV.");
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new SourceError("Unsafe vote count.");
  return n;
};
const optionalInteger = (value) =>
  String(value ?? "").trim() === "" ? null : integer(value);
const modes = { ward: "Ward", pr: "PR", district: "DC 40%" };
const palette = {
  7: "#d5ad36",
  52: "#3287c9",
  945: "#cf5d63",
  1748: "#4ba786",
  3: "#8c72b0",
  957: "#e58a49",
  1511: "#58ac84",
};
export function partyMeta(id, name, dictionary) {
  const p = dictionary.find((p) => String(p.ID) === String(id));
  return {
    partyId: String(id),
    partyName: name ?? p?.PartyFullName ?? `Party ${id}`,
    label: p?.Name ?? name ?? `Party ${id}`,
    color:
      palette[id] ??
      (/^#[\da-f]{6}$/i.test(p?.sWebColour ?? "") ? p.sWebColour : "#8198bd"),
    logoUrl: p ? `/api/party-logo/${p.ID}` : null,
  };
}
export function resolveSelection(query) {
  const allowed = new Set([
    "province",
    "municipality",
    "ward",
    "vd",
    "district",
    "ballot",
  ]);
  if (
    Object.keys(query).some((k) => !allowed.has(k)) ||
    Object.entries(query).some(
      ([k, v]) =>
        typeof v !== "string" || (k !== "ballot" && !/^\d{1,10}$/.test(v)),
    )
  )
    throw new SourceError("Invalid map selection.", 400);
  const ballot = query.ballot ?? "ward";
  if (!["ward", "pr", "district", "combined"].includes(ballot))
    throw new SourceError("Invalid ballot.", 400);
  let ward = query.ward ? wards.get(query.ward) : null;
  if (query.ward && !ward) throw new SourceError("Unknown 2026 ward.", 404);
  if (query.vd) {
    const wardId = registry.votingDistricts[query.vd];
    if (!wardId) throw new SourceError("Unknown voting district.", 404);
    if (ward && ward.id !== wardId)
      throw new SourceError(
        "Voting district does not belong to selected ward.",
        400,
      );
    ward = wards.get(wardId);
  }
  const municipality = ward
    ? municipalities.get(ward.municipalityId)
    : query.municipality
      ? municipalities.get(query.municipality)
      : null;
  if (
    query.municipality &&
    (!municipality || municipality.id !== query.municipality)
  )
    throw new SourceError("Municipality does not match this ward.", 400);
  const district = query.district ? districts.get(query.district) : null;
  if (query.district && !district)
    throw new SourceError("Unknown district council.", 404);
  if (
    district &&
    municipality &&
    (municipality.isMetro || municipality.districtId !== district.id)
  )
    throw new SourceError(
      "Municipality is outside the selected district.",
      400,
    );
  const provinceId =
    municipality?.provinceId ?? district?.provinceId ?? query.province;
  if (provinceId && !provinces.has(provinceId))
    throw new SourceError("Unknown province.", 404);
  if (query.province && provinceId !== query.province)
    throw new SourceError("Province does not match selected location.", 400);
  return {
    level: query.vd
      ? "station"
      : ward
        ? "ward"
        : municipality
          ? "municipality"
          : district
            ? "district"
            : provinceId
              ? "province"
              : "national",
    id:
      query.vd ??
      ward?.id ??
      municipality?.id ??
      district?.id ??
      provinceId ??
      "ZA",
    ballot,
    province: provinceId ? provinces.get(provinceId) : null,
    municipality,
    ward,
    district,
    vd: query.vd ?? null,
  };
}
export class Documents {
  constructor({
    root = "data/gis-service",
    fetcher = download,
    now = Date.now,
  } = {}) {
    this.root = root;
    this.fetcher = fetcher;
    this.now = now;
    this.memory = new Map();
    this.pending = new Map();
    this.retryAt = new Map();
  }
  async get(key, url, ttl, decode = JSON.parse) {
    const hash = createHash("sha256").update(key).digest("hex");
    let old = this.memory.get(key);
    if (!old) {
      try {
        old = JSON.parse(await readFile(`${this.root}/${hash}.json`, "utf8"));
        this.memory.set(key, old);
      } catch {}
    }
    if (old && this.now() - old.checkedAt < ttl)
      return { ...old, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.now() < (this.retryAt.get(key) ?? 0)) {
      if (old)
        return { ...old, stale: true, error: "Source retry backoff active." };
      throw new SourceError("Source retry backoff active.", 503);
    }
    const job = (async () => {
      try {
        const r = await this.fetcher(url, {}, 80000000);
        if (r.status !== 200)
          throw new SourceError(
            `Published source returned HTTP ${r.status}.`,
            r.status === 404 ? 404 : 502,
          );
        const data = decode(r.text);
        const checkedAt = this.now();
        const entry = {
          data,
          url,
          checkedAt,
          fetchedAt: new Date(checkedAt).toISOString(),
          stale: false,
          sha256: createHash("sha256").update(r.text).digest("hex"),
        };
        await mkdir(this.root, { recursive: true });
        await writeFile(`${this.root}/${hash}.tmp`, JSON.stringify(entry));
        await rename(`${this.root}/${hash}.tmp`, `${this.root}/${hash}.json`);
        if (this.memory.size > 36)
          this.memory.delete(this.memory.keys().next().value);
        this.memory.set(key, entry);
        this.retryAt.delete(key);
        return entry;
      } catch (e) {
        this.retryAt.set(key, this.now() + 60000);
        if (old) return { ...old, stale: true, error: e.message };
        throw e;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, job);
    return job;
  }
}

export function parseBallotCSV(text, municipality, dictionary) {
  const raw = parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    max_record_size: 100000,
  });
  if (!raw.length) {
    if (!text.replace(/^\uFEFF/, "").startsWith("Province,Municipality,"))
      throw new SourceError("CSV schema changed.");
    return { groups: [], unmatched: [], reportDates: [] };
  }
  const required = [
    "VotingDistrict",
    "Ward",
    "BallotType",
    "PartyName",
    "TotalValidVotes",
    "RegisteredVoters",
    "SpoiltVotes",
    "DateGenerated",
  ];
  if (required.some((k) => !(k in raw[0])))
    throw new SourceError("CSV schema changed.");
  const nameIndex = new Map(),
    shortIndex = new Map();
  const add = (index, key, p) => {
    if (!key) return;
    const old = index.get(key);
    index.set(key, index.has(key) && old?.ID !== p.ID ? null : p);
  };
  for (const p of dictionary) {
    add(nameIndex, norm(p.PartyFullName), p);
    add(shortIndex, norm(p.Name), p);
  }
  nameIndex.set(
    "INDEPENDENT",
    dictionary.find((p) => p.ID === 0),
  );
  const groups = new Map(),
    unmatched = new Set(),
    reportDates = new Set();
  for (const r of raw) {
    const vd = String(r.VotingDistrict).trim(),
      wardId = String(r.Ward)
        .replace(/^Ward\s+/i, "")
        .trim();
    const w = wards.get(wardId);
    if (
      !w ||
      w.municipalityId !== municipality.id ||
      registry.votingDistricts[vd] !== wardId
    )
      throw new SourceError(
        "CSV geography join failed. Publication retained for review.",
      );
    if (!Object.values(modes).includes(r.BallotType))
      throw new SourceError("Unknown published ballot type.");
    if (municipality.isMetro && r.BallotType === "DC 40%")
      throw new SourceError("District ballot published for a metro.");
    const key = `${vd}|${r.BallotType}`;
    const registered = optionalInteger(r.RegisteredVoters),
      spoilt = optionalInteger(r.SpoiltVotes),
      votes = integer(r.TotalValidVotes);
    let g = groups.get(key);
    if (!g) {
      g = {
        vd,
        wardId,
        ballot: r.BallotType,
        registered,
        spoilt,
        stationName: r.VotingStationName ?? "",
        rows: [],
      };
      groups.set(key, g);
    } else {
      if (
        (g.registered !== null &&
          registered !== null &&
          g.registered !== registered) ||
        (g.spoilt !== null && spoilt !== null && g.spoilt !== spoilt)
      )
        throw new SourceError("Inconsistent repeated ballot metadata.");
      g.registered ??= registered;
      g.spoilt ??= spoilt;
    }
    if (g.rows.some((p) => norm(p.name) === norm(r.PartyName)))
      throw new SourceError(
        "Duplicate party row for the same ballot and voting district.",
      );
    const keyName = norm(r.PartyName);
    const p = nameIndex.has(keyName)
      ? nameIndex.get(keyName)
      : shortIndex.get(keyName);
    if (!p) unmatched.add(r.PartyName);
    g.rows.push({
      id: p ? String(p.ID) : `name:${norm(r.PartyName)}`,
      name: r.PartyName,
      votes,
    });
    reportDates.add(r.DateGenerated);
  }
  return {
    groups: [...groups.values()],
    unmatched: [...unmatched],
    reportDates: [...reportDates],
  };
}
function tally(groups, dictionary, candidates = {}) {
  const totals = new Map(),
    voters = new Map();
  let votes = 0,
    spoilt = 0,
    missingSpoilt = false;
  for (const g of groups) {
    if (g.spoilt === null) missingSpoilt = true;
    else spoilt += g.spoilt;
    const prior = voters.get(g.vd);
    if (
      prior !== undefined &&
      prior !== null &&
      g.registered !== null &&
      prior !== g.registered
    )
      throw new SourceError("Registered voters disagree across ballots.");
    voters.set(g.vd, prior ?? g.registered);
    for (const r of g.rows) {
      votes += r.votes;
      const old = totals.get(r.id) ?? {
        ...partyMeta(r.id, r.name, dictionary),
        votes: 0,
        candidate: candidates[r.id] ?? null,
      };
      old.votes += r.votes;
      totals.set(r.id, old);
    }
  }
  const registered = [...voters.values()].some((v) => v === null)
    ? null
    : [...voters.values()].reduce((sum, v) => sum + v, 0);
  return {
    validVotes: votes,
    spoilt: missingSpoilt ? null : spoilt,
    registered,
    ballotsCast: missingSpoilt ? null : votes + spoilt,
    rows: [...totals.values()]
      .map((r) => ({ ...r, share: votes ? (r.votes / votes) * 100 : 0 }))
      .sort((a, b) => b.votes - a.votes),
  };
}
function featureSummary(result, expected, received, available = true) {
  const parties = result.rows.filter(
    (p) => p.partyId !== "-2" && p.partyId !== "OTHER",
  );
  const leader = parties[0];
  const tie = Boolean(leader?.votes > 0 && leader.votes === parties[1]?.votes);
  return {
    available,
    validVotes: result.validVotes,
    received,
    expected,
    progress: expected ? (received / expected) * 100 : null,
    leader:
      !tie && leader?.votes > 0
        ? {
            id: leader.partyId,
            label: leader.label,
            color: leader.color,
            share: leader.share,
          }
        : null,
    parties: parties
      .slice(0, 3)
      .map((p) => ({
        id: p.partyId,
        label: p.label,
        color: p.color,
        votes: p.votes,
        share: p.share,
        logoUrl: p.logoUrl,
      })),
    tie,
  };
}
export class GISService {
  constructor(source, { documents = new Documents() } = {}) {
    this.source = source;
    this.documents = documents;
  }
  async dictionary() {
    return (await this.source.get("2026", "parties")).data;
  }
  async csv(m, dictionary) {
    const url = `https://results.elections.org.za/home/LGEPublicReports/1887/Downloadable%20Party%20Results/${encodeURIComponent(m.provinceId === "3" ? "GP" : m.provinceId === "4" ? "KN" : m.provinceId === "5" ? "MP" : m.provinceId === "6" ? "NC" : m.provinceId === "7" ? "LP" : m.provinceId === "8" ? "NW" : m.provinceId === "9" ? "WC" : m.provinceId === "2" ? "FS" : "EC")}/${encodeURIComponent(m.code)}.csv`;
    return this.documents.get(`csv:1887:${m.id}`, url, 300000, (text) =>
      parseBallotCSV(text, m, dictionary),
    );
  }
  async jsonFallback(s, base, dictionary) {
    const packet = await this.source.get(
      "2026",
      "municipality",
      s.municipality.id,
    );
    let node = packet.data;
    if (s.ward)
      node = node.WardResults?.find((w) => String(w.WardID) === s.ward.id);
    if (s.vd)
      node = node?.VotingDistrictResults?.find(
        (v) => String(v.VotingDistrictID) === s.vd,
      );
    const field =
      s.ballot === "ward"
        ? "WardVotes"
        : s.ballot === "pr"
          ? "PRVotes"
          : "TotalValidVotes";
    function convert(n) {
      const rows = n?.PartyBallotResults;
      if (
        !rows?.length ||
        rows.some((p) => !Number.isSafeInteger(p[field]) || p[field] < 0)
      )
        return null;
      const total = rows.reduce((sum, r) => sum + r[field], 0);
      return {
        validVotes: total,
        rows: rows
          .map((p) => ({
            ...partyMeta(p.ID, p.Name, dictionary),
            votes: p[field],
            share: total ? (p[field] / total) * 100 : 0,
            candidate:
              p.ID !== 0 &&
              s.ballot === "ward" &&
              p.CandidateName &&
              p.CandidateName !== "-"
                ? p.CandidateName
                : null,
          }))
          .sort((a, b) => b.votes - a.votes),
      };
    }
    const data = convert(node);
    if (!data)
      return {
        ...base,
        available: false,
        rows: [],
        reason:
          "This ballot split is not present in the available JSON, and the ballot CSV has not been published.",
        features: {},
      };
    const features = {};
    for (const c of node.WardResults ?? node.VotingDistrictResults ?? []) {
      const r = convert(c);
      if (!r) continue;
      const id = String(c.WardID ?? c.VotingDistrictID);
      const f = featureSummary(r, null, null, r.validVotes > 0);
      features[id] = { ...f, progress: null };
    }
    if (s.vd)
      features[s.vd] = {
        ...featureSummary(data, 1, null, data.validVotes > 0),
        progress: null,
      };
    return {
      ...base,
      ...data,
      features,
      spoilt: null,
      registered: node.RegPop > 0 ? node.RegPop : null,
      ballotsCast: null,
      reporting: {
        received: null,
        expected: null,
        percent: null,
        definition:
          "Ballot-specific publication coverage is not available in this JSON source.",
      },
      source: {
        url: packet.url,
        reportDate: node.ReportDate ?? packet.data.ReportDate,
        fetchedAt: packet.fetchedAt,
        stale: packet.stale,
        error: packet.error ?? null,
      },
      warnings: [
        "The ballot CSV is unavailable. Published JSON ballot fields are shown; spoilt ballots and ballot-specific reporting coverage are unavailable.",
      ],
    };
  }
  async results(query) {
    const s = resolveSelection(query),
      dictionary = await this.dictionary();
    const label =
      s.level === "station"
        ? `Voting district ${s.id}`
        : s.ward
          ? `Ward ${s.ward.number}`
          : (s.municipality?.name ??
            s.district?.name ??
            s.province?.name ??
            "South Africa");
    const base = {
      selection: {
        province: s.province?.id,
        municipality: s.municipality?.id,
        ward: s.ward?.id,
        vd: s.vd,
        district: s.district?.id,
      },
      level: s.level,
      id: s.id,
      label,
      ballot: s.ballot,
      year: 2026,
      eventId: 1887,
      applicable: true,
      available: true,
      features: {},
      warnings: [],
    };
    if (s.ballot === "district" && s.municipality?.isMetro)
      return {
        ...base,
        applicable: false,
        available: false,
        reason: "District PR does not apply in metropolitan municipalities.",
        rows: [],
      };
    if (["national", "province"].includes(s.level)) {
      if (s.ballot === "district")
        return {
          ...base,
          available: false,
          reason:
            "Select a district council or a non-metro municipality to explore district PR results.",
          rows: [],
        };
      const packet = await this.source.get("2026", s.level, s.province?.id);
      const node = packet.data;
      const field =
        s.ballot === "ward"
          ? "WardVotes"
          : s.ballot === "pr"
            ? "PRVotes"
            : "TotalValidVotes";
      const aggregate = (n) => {
        const rr = n.PartyBallotResults ?? [];
        if (
          !rr.length ||
          rr.some((p) => !Number.isSafeInteger(p[field]) || p[field] < 0)
        )
          return null;
        const counts = rr.map((p) => ({
          ...partyMeta(p.ID, p.Name, dictionary),
          votes: p[field],
        }));
        const sum = counts.reduce((sum, r) => sum + r.votes, 0);
        const combined = rr.reduce((sum, p) => sum + p.TotalValidVotes, 0);
        const published = rr.find((p) => p.ValidVotesCast > 0)?.ValidVotesCast;
        const partial = published !== undefined && combined !== published;
        if (partial && field !== "TotalValidVotes") return null;
        const total =
          field === "TotalValidVotes" && published !== undefined
            ? published
            : sum;
        return {
          validVotes: total,
          rows: counts
            .map((p) => ({ ...p, share: total ? (p.votes / total) * 100 : 0 }))
            .sort((a, b) => b.votes - a.votes),
        };
      };
      const result = aggregate(node);
      if (!result)
        return {
          ...base,
          available: false,
          reason: "The published file does not provide this ballot split.",
          rows: [],
        };
      for (const c of node.ProvinceResults ?? node.MunicipalityResults ?? []) {
        const r = aggregate(c);
        if (r)
          base.features[String(c.MunicipalityID ?? c.ProvinceID)] =
            featureSummary(r, c.VDExpected, c.VDsComplete);
      }
      if (s.level === "national") {
        base.mapFeatures = {};
        for (const province of node.ProvinceResults ?? [])
          for (const municipality of province.MunicipalityResults ?? []) {
            const id = String(municipality.MunicipalityID);
            if (!municipalities.has(id)) continue;
            const r = aggregate(municipality);
            if (r)
              base.mapFeatures[id] = featureSummary(
                r,
                municipality.VDExpected,
                municipality.VDsComplete,
              );
          }
      }
      if (s.level === "national" && s.ballot !== "combined") {
        for (let i = 0; i < registry.provinces.length; i += 3)
          await Promise.all(
            registry.provinces.slice(i, i + 3).map(async (p) => {
              try {
                const child = await this.source.get("2026", "province", p.id);
                const r = aggregate(child.data);
                if (r)
                  base.features[p.id] = {
                    ...featureSummary(
                      r,
                      child.data.VDExpected,
                      child.data.VDsComplete,
                    ),
                    reportDate: child.data.ReportDate,
                  };
                for (const m of child.data.MunicipalityResults ?? []) {
                  const id = String(m.MunicipalityID);
                  if (!municipalities.has(id)) continue;
                  const summary = aggregate(m);
                  if (summary)
                    base.mapFeatures[id] = featureSummary(
                      summary,
                      m.VDExpected,
                      m.VDsComplete,
                    );
                }
              } catch {
                base.warnings.push(`Ballot split unavailable for ${p.name}.`);
              }
            }),
          );
        base.warnings.push(
          "Province map splits come from separate province files; generation times may differ from the national summary.",
        );
      }
      if (s.level === "national")
        base.mapCoverage = {
          expected: registry.municipalities.length,
          published: Object.keys(base.mapFeatures).length,
          leading: Object.values(base.mapFeatures).filter((f) => f.leader)
            .length,
        };
      return {
        ...base,
        ...result,
        spoilt: null,
        registered: node.RegPop ?? null,
        ballotsCast: null,
        reporting: {
          received: node.VDsComplete ?? null,
          expected: node.VDExpected ?? null,
          percent: node.VDExpected
            ? (node.VDsComplete / node.VDExpected) * 100
            : null,
          definition:
            "IEC voting districts reported; progress is not ballot-specific.",
        },
        source: {
          url: packet.url,
          reportDate: node.ReportDate,
          fetchedAt: packet.fetchedAt,
          stale: packet.stale,
          error: packet.error ?? null,
        },
        warnings: [
          ...base.warnings,
          "Source summary may show only leading parties for child areas. Party shares use the published combined denominator when a child list is truncated.",
        ],
      };
    }
    const members =
      s.level === "district"
        ? registry.municipalities.filter(
            (m) => m.districtId === s.district.id && !m.isMetro,
          )
        : [s.municipality];
    const packets = [],
      failures = [];
    for (let i = 0; i < members.length; i += 2) {
      await Promise.all(
        members.slice(i, i + 2).map(async (m) => {
          try {
            packets.push({ m, packet: await this.csv(m, dictionary) });
          } catch (e) {
            failures.push({ municipality: m.name, error: e.message });
          }
        }),
      );
    }
    if (!packets.length) {
      if (s.municipality && s.ballot !== "district")
        return this.jsonFallback(s, base, dictionary);
      return {
        ...base,
        available: false,
        reason:
          "District PR exports are not currently available for this location. No other ballot is substituted.",
        rows: [],
        coverage: {
          sourcesAvailable: 0,
          sourcesExpected: members.length,
          failures,
        },
      };
    }
    const filter = (g) =>
      (s.ballot === "combined"
        ? g.ballot === "Ward" || g.ballot === "PR"
        : g.ballot === modes[s.ballot]) &&
      (!s.ward || g.wardId === s.ward.id) &&
      (!s.vd || g.vd === s.vd);
    const groups = packets.flatMap((p) => p.packet.data.groups).filter(filter);
    let candidates = {};
    if (s.ward && s.ballot === "ward") {
      try {
        const p = await this.source.get(
          "2026",
          "municipality",
          s.municipality.id,
        );
        const w = p.data.WardResults.find(
          (w) => String(w.WardID) === s.ward.id,
        );
        for (const r of w?.PartyBallotResults ?? [])
          if (r.ID !== 0 && r.CandidateName && r.CandidateName !== "-")
            candidates[String(r.ID)] = r.CandidateName;
      } catch {
        base.warnings.push(
          "Candidate names unavailable; party-level ward votes are shown.",
        );
      }
    }
    const result = tally(groups, dictionary, candidates);
    const source = {
      url: packets[0].packet.url,
      urls: packets.map((p) => p.packet.url),
      reportDate: null,
      reportDates: packets.flatMap((p) => p.packet.data.reportDates),
      fetchedAt: packets.map((p) => p.packet.fetchedAt).sort()[0],
      stale: packets.some((p) => p.packet.stale) || Boolean(failures.length),
      error: failures.length
        ? `${failures.length} municipality sources unavailable. Complete district totals are not available.`
        : (packets.find((p) => p.packet.error)?.packet.error ?? null),
    };
    const expectedVD = Object.entries(registry.votingDistricts).filter(
      ([vd, wardId]) =>
        s.vd
          ? vd === s.vd
          : s.ward
            ? wardId === s.ward.id
            : members.some((m) => wards.get(wardId).municipalityId === m.id),
    );
    const received = new Set(groups.map((g) => g.vd));
    const features = {};
    if (s.level === "municipality")
      for (const w of registry.wards.filter(
        (w) => w.municipalityId === s.municipality.id,
      )) {
        const gg = groups.filter((g) => g.wardId === w.id);
        features[w.id] = featureSummary(
          tally(gg, dictionary),
          expectedVD.filter(([, wid]) => wid === w.id).length,
          new Set(gg.map((g) => g.vd)).size,
          gg.length > 0,
        );
      }
    else if (s.level === "ward" || s.level === "station")
      for (const [vd] of expectedVD) {
        const gg = groups.filter((g) => g.vd === vd);
        features[vd] = {
          ...featureSummary(
            tally(gg, dictionary),
            1,
            gg.length ? 1 : 0,
            gg.length > 0,
          ),
          stationName: gg[0]?.stationName ?? null,
        };
      }
    else
      for (const m of members) {
        const gg = groups.filter(
          (g) => wards.get(g.wardId).municipalityId === m.id,
        );
        features[m.id] = featureSummary(
          tally(gg, dictionary),
          expectedVD.filter(([, wid]) => wards.get(wid).municipalityId === m.id)
            .length,
          new Set(gg.map((g) => g.vd)).size,
          gg.length > 0,
        );
      }
    if (packets.some((p) => p.packet.data.unmatched.length))
      base.warnings.push(
        "Some party names could not be matched to a logo. Their votes remain included.",
      );
    if (s.ballot === "combined")
      base.warnings.push(
        "Combined ward + municipal PR votes are not unique voters.",
      );
    if (
      groups.some((g) => g.rows.some((r) => r.id === "0")) &&
      s.ballot === "ward"
    )
      base.warnings.push(
        "Independent votes may be aggregated by the published CSV; candidate names are shown only when available.",
      );
    return {
      ...base,
      ...result,
      available: groups.length > 0,
      reason: groups.length
        ? null
        : "No published records for this ballot and location yet.",
      source,
      features,
      station: s.vd ? { name: groups[0]?.stationName ?? null } : null,
      reporting: {
        received: received.size,
        expected: expectedVD.length,
        percent: expectedVD.length
          ? (received.size / expectedVD.length) * 100
          : null,
        definition:
          "Voting districts with rows published for the selected ballot. This is publication coverage, not a declared result.",
      },
      coverage: {
        sourcesAvailable: packets.length,
        sourcesExpected: members.length,
        failures,
      },
      warnings: base.warnings,
    };
  }
  async votingGeometry(wardId) {
    const w = wards.get(wardId);
    if (!w) throw new SourceError("Unknown ward.", 404);
    const decode = (text) => {
      const geo = JSON.parse(text);
      if (
        geo.type !== "FeatureCollection" ||
        geo.exceededTransferLimit ||
        geo.properties?.exceededTransferLimit
      )
        throw new SourceError(
          "Invalid or incomplete voting-district geometry.",
        );
      const found = new Set();
      for (const f of geo.features) {
        const p = f.properties,
          id = String(p.VDNumber);
        if (
          registry.votingDistricts[id] !== wardId ||
          found.has(id) ||
          !["Polygon", "MultiPolygon"].includes(f.geometry?.type)
        )
          throw new SourceError("Voting-district boundary join failed.");
        found.add(id);
        f.id = id;
        f.properties = {
          id,
          name: `Voting district ${id}`,
          kind: "station",
          wardId,
        };
      }
      const expected = Object.entries(registry.votingDistricts)
        .filter(([, wid]) => wid === wardId)
        .map(([id]) => id);
      return {
        type: "FeatureCollection",
        features: geo.features,
        coverage: {
          expected: expected.length,
          matched: found.size,
          missing: expected.filter((id) => !found.has(id)),
        },
      };
    };
    try {
      return await this.documents.get(
        `vd-geometry:${wardId}`,
        `https://results.elections.org.za/ElectionMap/MapData/2026/ward${wardId}.js`,
        86400000,
        decode,
      );
    } catch {
      const url = new URL(
        "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/VotingDistricts2026_Final/FeatureServer/0/query",
      );
      url.search = new URLSearchParams({
        where: `WardId=${wardId}`,
        outFields: "VDNumber,WardId",
        outSR: "4326",
        returnGeometry: "true",
        f: "geojson",
      });
      return this.documents.get(
        `mdb-vd-geometry:${wardId}`,
        url.href,
        86400000,
        decode,
      );
    }
  }
  async stations(wardId) {
    if (!wards.has(wardId)) throw new SourceError("Unknown ward.", 404);
    const url = new URL(
      "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/VotingStations_March2026/FeatureServer/0/query",
    );
    url.search = new URLSearchParams({
      where: `WARDID=${wardId}`,
      outFields: "VDNUMBER,VOTING_STA,ADDRESS,VENUE_DESC,SUBURB,TOWN",
      outSR: "4326",
      returnGeometry: "true",
      f: "geojson",
    });
    return this.documents.get(
      `station-points:${wardId}`,
      url.href,
      86400000,
      (text) => {
        const geo = JSON.parse(text);
        if (
          geo.error ||
          geo.type !== "FeatureCollection" ||
          geo.exceededTransferLimit
        )
          throw new SourceError("Station point source incomplete.");
        return {
          type: "FeatureCollection",
          features: geo.features
            .filter(
              (f) =>
                registry.votingDistricts[String(f.properties.VDNUMBER)] ===
                wardId,
            )
            .map((f) => ({
              ...f,
              id: String(f.properties.VDNUMBER),
              properties: {
                id: String(f.properties.VDNUMBER),
                name: f.properties.VOTING_STA,
                address: f.properties.ADDRESS,
                venue: f.properties.VENUE_DESC,
                kind: "station-point",
              },
            })),
        };
      },
    );
  }
}
