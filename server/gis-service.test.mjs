import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registry,
  resolveSelection,
  parseBallotCSV,
  Documents,
  GISService,
} from "./gis-service.mjs";
const m = registry.municipalities.find((m) => m.id === "3003");
const dictionary = [
  { ID: 7, Name: "ANC", PartyFullName: "AFRICAN NATIONAL CONGRESS" },
  { ID: 52, Name: "DA", PartyFullName: "DEMOCRATIC ALLIANCE" },
];
const header =
  "Province,Municipality,Ward,VotingDistrict,VotingStationName,RegisteredVoters,BallotType,SpoiltVotes,PartyName,TotalValidVotes,DateGenerated\n";
const row = (party, votes, ballot = "Ward", spoilt = 2, vd = "32860728") =>
  `Gauteng,JHB - City of Johannesburg,Ward 79800001,${vd},Test School,100,${ballot},${spoilt},${party},${votes},11/5/2026 9:43:27 AM\n`;
test("national registry has full unique geography coverage and valid parents", () => {
  assert.equal(registry.wards.length, 4485);
  assert.equal(new Set(registry.wards.map((w) => w.id)).size, 4485);
  assert.equal(registry.municipalities.length, 213);
  assert.equal(registry.districts.length, 44);
  assert.equal(Object.keys(registry.votingDistricts).length, 23696);
  const wards = new Set(registry.wards.map((w) => w.id));
  for (const id of Object.values(registry.votingDistricts))
    assert.ok(wards.has(id));
});
test("selection derives parents and rejects cross-boundary joins", () => {
  const s = resolveSelection({ vd: "32860728", ballot: "ward" });
  assert.equal(s.ward.id, "79800001");
  assert.equal(s.municipality.id, "3003");
  assert.equal(s.province.id, "3");
  assert.throws(
    () => resolveSelection({ ward: "79800001", municipality: "1001" }),
    /Municipality/,
  );
  assert.throws(
    () => resolveSelection({ ward: "79800001", province: "1" }),
    /Province/,
  );
  assert.throws(() => resolveSelection({ ward: "1 OR 1=1" }), /Invalid/);
  assert.throws(
    () => resolveSelection({ url: "http://example.com" }),
    /Invalid/,
  );
});
test("CSV groups repeat metadata once per ballot and keeps ballot identity", () => {
  const d = parseBallotCSV(
    "\uFEFF" +
      header +
      row("AFRICAN NATIONAL CONGRESS", 40) +
      row("DEMOCRATIC ALLIANCE", 30) +
      row("AFRICAN NATIONAL CONGRESS", 25, "PR", 1),
    m,
    dictionary,
  );
  assert.equal(d.groups.length, 2);
  assert.equal(d.groups[0].spoilt, 2);
  assert.equal(d.groups[0].registered, 100);
  assert.equal(
    d.groups[0].rows.reduce((s, p) => s + p.votes, 0),
    70,
  );
  assert.equal(d.groups[1].ballot, "PR");
  assert.equal(d.groups[0].rows[0].id, "7");
});
test("CSV rejects invalid joins, duplicates, negative votes and repeated-metadata disagreement", () => {
  assert.throws(
    () =>
      parseBallotCSV(
        header + row("ANC", 40, "Ward", 2, "99999999"),
        m,
        dictionary,
      ),
    /geography/,
  );
  assert.throws(
    () =>
      parseBallotCSV(header + row("ANC", 40) + row("ANC", 20), m, dictionary),
    /Duplicate/,
  );
  assert.throws(
    () =>
      parseBallotCSV(
        header + row("ANC", 40) + row("DA", 30, "Ward", 3),
        m,
        dictionary,
      ),
    /metadata/,
  );
  assert.throws(
    () => parseBallotCSV(header + row("ANC", -1), m, dictionary),
    /integer/,
  );
  assert.throws(
    () => parseBallotCSV("<html>Service error</html>", m, dictionary),
    /schema/,
  );
});
test("metro district ballot is rejected; unknown names retain their votes", () => {
  assert.throws(
    () => parseBallotCSV(header + row("ANC", 3, "DC 40%"), m, dictionary),
    /metro/,
  );
  const d = parseBallotCSV(header + row("A NEW PARTY", 7), m, dictionary);
  assert.equal(d.unmatched[0], "A NEW PARTY");
  assert.equal(d.groups[0].rows[0].votes, 7);
});
test("ambiguous party names remain unmatched rather than receiving a wrong logo", () => {
  const d = parseBallotCSV(header + row("AMBIGUOUS PARTY", 9), m, [
    { ID: 1, PartyFullName: "AMBIGUOUS PARTY", Name: "ONE" },
    { ID: 2, PartyFullName: "AMBIGUOUS PARTY", Name: "TWO" },
  ]);
  assert.equal(d.unmatched.length, 1);
  assert.match(d.groups[0].rows[0].id, /^name:/);
});
test("empty BOM CSV is an unpublished dataset, not malformed data", () => {
  assert.equal(
    parseBallotCSV("\uFEFF" + header, m, dictionary).groups.length,
    0,
  );
});
test("missing spoilt metadata remains unavailable without dropping valid votes", async () => {
  const data = parseBallotCSV(
    header + row("AFRICAN NATIONAL CONGRESS", 40, "Ward", ""),
    m,
    dictionary,
  );
  const service = new GISService(
    { get: async () => ({ data: dictionary }) },
    {
      documents: {
        get: async () => ({
          data,
          url: "https://results.elections.org.za/test.csv",
          fetchedAt: new Date().toISOString(),
          stale: false,
        }),
      },
    },
  );
  const r = await service.results({ municipality: "3003", ballot: "ward" });
  assert.equal(r.validVotes, 40);
  assert.equal(r.spoilt, null);
  assert.equal(r.ballotsCast, null);
});
test("truncated child party lists use the published denominator", async () => {
  const p = {
    ID: 7,
    Name: "AFRICAN NATIONAL CONGRESS",
    TotalValidVotes: 40,
    WardVotes: 20,
    PRVotes: 20,
    ValidVotesCast: 100,
  };
  const source = {
    get: async (_year, kind) =>
      kind === "parties"
        ? { data: dictionary }
        : {
            url: "https://results.elections.org.za/test.js",
            fetchedAt: new Date().toISOString(),
            data: {
              RegPop: 200,
              VDExpected: 100,
              VDsComplete: 20,
              PartyBallotResults: [
                p,
                {
                  ...p,
                  ID: -2,
                  TotalValidVotes: 60,
                  WardVotes: 30,
                  PRVotes: 30,
                },
              ],
              ProvinceResults: [
                {
                  ProvinceID: 3,
                  VDExpected: 10,
                  VDsComplete: 2,
                  PartyBallotResults: [p],
                },
              ],
            },
          },
  };
  const r = await new GISService(source).results({ ballot: "combined" });
  assert.equal(r.validVotes, 100);
  assert.equal(r.features["3"].validVotes, 100);
  assert.equal(r.features["3"].leader.share, 40);
});
test("national map keeps different municipality leaders inside the same province", async () => {
  const party = (ID, votes) => ({
    ID,
    TotalValidVotes: votes,
    WardVotes: votes,
    PRVotes: 0,
    ValidVotesCast: 100,
  });
  const municipality = (MunicipalityID, anc, da) => ({
    MunicipalityID,
    VDExpected: 10,
    VDsComplete: 3,
    PartyBallotResults: [party(7, anc), party(52, da)],
  });
  const province = {
    ProvinceID: 3,
    VDExpected: 20,
    VDsComplete: 6,
    PartyBallotResults: [party(7, 60), party(52, 40)],
    MunicipalityResults: [
      municipality(3002, 20, 80),
      municipality(3003, 70, 30),
    ],
  };
  const source = {
    get: async (_year, kind) =>
      kind === "parties"
        ? { data: dictionary }
        : {
            url: "https://results.elections.org.za/test.js",
            fetchedAt: new Date().toISOString(),
            data: {
              RegPop: 200,
              VDExpected: 20,
              VDsComplete: 6,
              PartyBallotResults: province.PartyBallotResults,
              ProvinceResults: [province],
            },
          },
  };
  const r = await new GISService(source).results({ ballot: "combined" });
  assert.equal(r.features["3"].leader.id, "7");
  assert.equal(r.mapFeatures["3002"].leader.id, "52");
  assert.equal(r.mapFeatures["3003"].leader.id, "7");
  assert.equal(r.mapCoverage.expected, 213);
  assert.equal(r.mapCoverage.leading, 2);
  assert.equal(r.mapFeatures["9006"], undefined);
});
test("CSV totals do not multiply registered or spoilt ballots by party count", async () => {
  const data = parseBallotCSV(
    header +
      row("AFRICAN NATIONAL CONGRESS", 40) +
      row("DEMOCRATIC ALLIANCE", 30) +
      row("AFRICAN NATIONAL CONGRESS", 25, "PR", 1),
    m,
    dictionary,
  );
  const service = new GISService(
    { get: async () => ({ data: dictionary }) },
    {
      documents: {
        get: async () => ({
          data,
          url: "https://results.elections.org.za/test.csv",
          fetchedAt: new Date().toISOString(),
          stale: false,
        }),
      },
    },
  );
  const r = await service.results({
    municipality: "3003",
    ward: "79800001",
    ballot: "combined",
  });
  assert.equal(r.validVotes, 95);
  assert.equal(r.spoilt, 3);
  assert.equal(r.registered, 100);
  assert.equal(r.reporting.received, 1);
  assert.equal(
    r.rows.reduce((s, p) => s + p.share, 0),
    100,
  );
  assert.equal(r.features["32860728"].validVotes, 95);
});
test("documents coalesce requests and retain a stale snapshot after source failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "iec-documents-"));
  let now = 100,
    requests = 0,
    fail = false;
  const docs = new Documents({
    root,
    now: () => now,
    fetcher: async () => {
      requests++;
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw Error("Network offline");
      return { status: 200, text: '{"valid":true}' };
    },
  });
  try {
    const [a, b] = await Promise.all([
      docs.get("same", "https://example.com", 10),
      docs.get("same", "https://example.com", 10),
    ]);
    assert.equal(requests, 1);
    assert.deepEqual(a.data, b.data);
    now = 200;
    fail = true;
    const stale = await docs.get("same", "https://example.com", 10);
    assert.equal(stale.stale, true);
    assert.equal(stale.data.valid, true);
    assert.match(stale.error, /offline/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
