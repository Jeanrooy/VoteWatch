import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegion, normalizeLive } from "./live-results.mjs";
import { summarize } from "./public-source.mjs";
const node = (rows) => ({
  ReportDate: "2026-11-05T08:53:55+02:00",
  VDExpected: 100,
  VDsComplete: 21,
  RegPop: 200,
  PartyBallotResults: rows,
});
const party = (ID, votes, total = 100) => ({
  ID,
  Name: `Party ${ID}`,
  TotalValidVotes: votes,
  ValidVotesCast: total,
});
test("top-party summaries preserve the published denominator and account for omitted parties", () => {
  const n = node([party(7, 40), party(52, 30), party(945, 10)]);
  const r = normalizeRegion(n);
  assert.equal(r.votes, 100);
  assert.equal(r.rows.find((p) => p.id === "OTHER").votes, 20);
  assert.equal(
    r.rows.reduce((s, p) => s + p.votes, 0),
    100,
  );
  assert.equal(r.progress, 21);
  assert.equal(summarize(n).validVotes, 100);
});
test("an IEC OTHER aggregate is not double counted", () => {
  const r = normalizeRegion(node([party(7, 40), party(52, 30), party(-2, 30)]));
  assert.equal(r.votes, 100);
  assert.equal(
    r.rows.reduce((s, p) => s + p.votes, 0),
    100,
  );
  assert.equal(r.rows.find((p) => p.id === "OTHER").votes, 30);
});
test("zero results remain zero and shares never become NaN", () => {
  const r = normalizeRegion(node([party(7, 0, 0)]));
  assert.equal(r.votes, 0);
  assert.equal(r.rows[0].share, 0);
});
test("empty IEC independents metadata does not overwrite region totals", () => {
  const n = node([
    party(7, 70),
    party(-2, 20),
    { ...party(0, 10, 0), RegisteredVoters: 0 },
  ]);
  assert.equal(normalizeRegion(n).votes, 100);
  assert.equal(summarize(n).validVotes, 100);
});
test("inconsistent totals, duplicate parties and excess reporting are rejected", () => {
  assert.throws(
    () => normalizeRegion(node([party(7, 40), party(52, 30, 101)])),
    /Inconsistent/,
  );
  assert.throws(
    () => normalizeRegion(node([party(7, 40), party(7, 30)])),
    /Duplicate/,
  );
  assert.throws(
    () => normalizeRegion({ ...node([party(7, 40)]), VDsComplete: 101 }),
    /Reporting/,
  );
  assert.throws(() => normalizeRegion(node([party(7, 101)])), /exceed/);
});
test("unknown denominators and wrong election IDs are rejected", () => {
  assert.throws(
    () => normalizeRegion(node([{ ID: 7, TotalValidVotes: 20 }])),
    /denominator/,
  );
  assert.throws(
    () => normalizeLive({ year: 2026, data: { ElectoralEventID: 1091 } }),
    /Unexpected/,
  );
});
