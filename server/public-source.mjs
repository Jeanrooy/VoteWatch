import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
const exec = promisify(execFile);
export const BASE = "https://results.elections.org.za/dashboards/lge/";
export class SourceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export async function download(url, headers = {}, maxBytes = 30000000) {
  // Use OS curl: Python urllib was denied by the upstream in this environment.
  // No shell expansion; URL is constructed exclusively from validated source identifiers.
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--proto",
    "=https",
    "--max-time",
    "35",
    "--max-redirs",
    "2",
    "--max-filesize",
    String(maxBytes),
    "--write-out",
    "\n%{http_code}",
  ];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);
  try {
    const { stdout } = await exec(
      process.platform === "win32" ? "curl.exe" : "curl",
      args,
      { maxBuffer: maxBytes + 1024, timeout: 40000 },
    );
    const at = stdout.lastIndexOf("\n");
    const status = Number(stdout.slice(at + 1));
    return { status, text: stdout.slice(0, at) };
  } catch {
    throw new SourceError(
      "Public source could not be reached. Last successful snapshot remains available.",
    );
  }
}
export function discoverEvents(html) {
  const events = {};
  for (const match of html.matchAll(
    /var\s+EEID(\d{4})\s*=\s*["']EEID(\d+)["']/g,
  ))
    events[match[1]] = match[2];
  if (!events["2026"])
    throw new SourceError(
      "Dashboard event configuration changed; manual review required.",
    );
  return events;
}
export function sourcePath(year, event, kind, id) {
  if (!/^20\d{2}$/.test(String(year)) || !/^\d{1,8}$/.test(String(event)))
    throw new SourceError("Invalid event.", 400);
  if (kind === "national")
    return `MapsJason/${year}/EEID${event}LiteMapsNational.js`;
  if (kind === "parties") return "MapsJason/2016/PartyList.js"; // Exact dictionary used by current IEC dashboard.
  if (
    !["province", "municipality"].includes(kind) ||
    !/^\d{1,10}$/.test(String(id))
  )
    throw new SourceError("Invalid region.", 400);
  return `MapsJason/${year}/EEID${event}${kind === "province" ? "Province" : "Munic"}${id}.js`;
}
export function parseResults(text, event, kind, id) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new SourceError("Source is not JSON. Response quarantined.");
  }
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== "object" ||
    Number(data.ElectoralEventID) !== Number(event) ||
    !Array.isArray(data.PartyBallotResults) ||
    !Number.isFinite(Date.parse(data.ReportDate))
  )
    throw new SourceError(
      "Unexpected results schema or event. Response quarantined.",
    );
  if (
    kind === "national" &&
    (!Array.isArray(data.ProvinceResults) || data.ProvinceID !== 0)
  )
    throw new SourceError("Unexpected national response.");
  if (kind === "province" && Number(data.ProvinceID) !== Number(id))
    throw new SourceError("Province identifier mismatch.");
  if (
    kind === "municipality" &&
    (Number(data.MunicipalityID) !== Number(id) ||
      !Array.isArray(data.WardResults))
  )
    throw new SourceError("Municipality identifier mismatch.");
  for (const p of data.PartyBallotResults) {
    if (
      !Number.isFinite(p.ID) ||
      !Number.isSafeInteger(p.TotalValidVotes) ||
      p.TotalValidVotes < 0
    )
      throw new SourceError("Invalid party vote count.");
  }
  return data;
}
export function summarize(data) {
  // Do not sum registered voters, cast ballots or spoilt counts repeated per party.
  const rows = data.PartyBallotResults.filter((p) => p.ID !== -2);
  const distinct = rows
    .filter((p) => !(p.ID === 0 && p.RegisteredVoters === 0))
    .map((p) => p.RegisteredVoters)
    .filter(Number.isSafeInteger);
  const registered =
    distinct.length && distinct.every((v) => v === distinct[0])
      ? distinct[0]
      : null;
  const published = data.PartyBallotResults.filter(
    (p) => !(p.ID === 0 && p.ValidVotesCast === 0),
  )
    .map((p) => p.ValidVotesCast)
    .filter(Number.isSafeInteger);
  const validVotes =
    published.length && published.every((v) => v === published[0])
      ? published[0]
      : null;
  return {
    eventId: data.ElectoralEventID,
    reportDate: data.ReportDate,
    registeredVoters: registered ?? data.RegPop ?? null,
    validVotes,
    listedPartyVotes: rows.reduce((s, p) => s + p.TotalValidVotes, 0),
    votingDistrictsExpected: data.VDExpected ?? null,
    votingDistrictsReported: data.VDsComplete ?? null,
    municipalitiesExpected: data.MunicExpected ?? null,
    wardsExpected: data.WardExpected ?? null,
    partyRows: rows.length,
    ballot: "IEC dashboard summary; combined ballots, not unique voters",
  };
}
export class PublicSource {
  constructor({
    fetcher = download,
    root = "data/public",
    ttl = 300000,
    now = Date.now,
  } = {}) {
    this.fetcher = fetcher;
    this.root = root;
    this.ttl = ttl;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
    this.events = null;
    this.eventsAt = 0;
    this.lastError = null;
    this.lastSuccess = null;
    this.cooldown = 0;
    this.failures = 0;
  }
  async eventList() {
    if (this.events && this.now() - this.eventsAt < 3600000) return this.events;
    const r = await this.fetcher(BASE);
    if (r.status !== 200)
      throw new SourceError(`Dashboard returned HTTP ${r.status}.`);
    this.events = discoverEvents(r.text);
    this.eventsAt = this.now();
    return this.events;
  }
  async get(year = "2026", kind = "national", id) {
    if (!/^20\d{2}$/.test(String(year)))
      throw new SourceError("Invalid year.", 400);
    const events = await this.eventList();
    const event = events[year];
    if (!event)
      throw new SourceError("Year is not advertised by the dashboard.", 400);
    const path = sourcePath(year, event, kind, id),
      key = path.replaceAll("/", "_"),
      url = BASE + path;
    let prior = this.cache.get(key);
    if (!prior) {
      try {
        prior = JSON.parse(await readFile(`${this.root}/${key}.json`, "utf8"));
        this.cache.set(key, prior);
      } catch {}
    }
    if (prior && kind !== "parties")
      prior = { ...prior, summary: summarize(prior.data) };
    if (prior && this.now() - prior.checkedAt < this.ttl)
      return { ...prior, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.now() < this.cooldown) {
      if (prior) return { ...prior, stale: true, error: this.lastError };
      throw new SourceError(
        "Source backoff active. Try again after the next polling window.",
        503,
      );
    }
    const job = (async () => {
      try {
        const r = await this.fetcher(url);
        if (r.status === 404)
          throw new SourceError(
            "This public results file has not been published. No historical data has been substituted.",
            404,
          );
        if (r.status !== 200)
          throw new SourceError(
            `Public source returned HTTP ${r.status}.`,
            r.status === 429 ? 503 : 502,
          );
        let data;
        if (kind === "parties") {
          try {
            data = JSON.parse(r.text);
            if (
              !Array.isArray(data) ||
              !data.every(
                (p) => Number.isFinite(p.ID) && typeof p.Name === "string",
              )
            )
              throw Error();
          } catch {
            throw new SourceError("Party dictionary schema changed.");
          }
        } else data = parseResults(r.text, event, kind, id);
        const hash = createHash("sha256").update(r.text).digest("hex");
        const checkedAt = this.now();
        const result = {
          url,
          year: Number(year),
          eventId: Number(event),
          checkedAt,
          fetchedAt: new Date(checkedAt).toISOString(),
          sha256: hash,
          stale: false,
          ...(kind === "parties" ? {} : { summary: summarize(data) }),
          data,
        };
        await mkdir(this.root, { recursive: true });
        if (prior?.sha256 !== hash) {
          await mkdir(`${this.root}/snapshots`, { recursive: true });
          await writeFile(
            `${this.root}/snapshots/${key}-${hash}.json`,
            JSON.stringify(result),
          );
        }
        await writeFile(`${this.root}/${key}.tmp`, JSON.stringify(result));
        await rename(`${this.root}/${key}.tmp`, `${this.root}/${key}.json`);
        if (this.cache.size >= 80)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, result);
        this.lastSuccess = result.fetchedAt;
        this.lastError = null;
        this.failures = 0;
        return result;
      } catch (e) {
        this.lastError = e.message;
        if (e.status !== 404) {
          this.failures++;
          this.cooldown =
            this.now() +
            Math.min(1800000, 30000 * 2 ** Math.min(this.failures - 1, 6));
        }
        if (prior) return { ...prior, stale: true, error: e.message };
        throw e;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, job);
    return job;
  }
}
