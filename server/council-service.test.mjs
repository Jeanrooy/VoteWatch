import test from "node:test";
import assert from "node:assert/strict";
import {
  councilState,
  seatSummary,
  seatRows,
  CouncilService,
} from "./council-service.mjs";
const meta = {
  id: "3003",
  name: "JHB - City of Johannesburg",
  provinceId: "3",
  isMetro: true,
};
const party = (ID, seats, votes = 10) => ({
  ID,
  Name: `Party ${ID}`,
  TotalSeatsWon: seats,
  WardSeatsWon: seats,
  PRSeatsWon: 0,
  TotalValidVotes: votes,
  CouncilsWon: 0,
  MajorityWon: 0,
});
test("seat leader is selected by seats rather than vote share", () => {
  const c = councilState(
    {
      SeatsExpected: 13,
      SeatsComplete: 5,
      PartyBallotResults: [party(7, 2, 100), party(52, 3, 50)],
    },
    meta,
  );
  assert.equal(c.seatLeader.partyId, "52");
  assert.equal(c.voteLeader.partyId, "7");
  assert.equal(c.status, "developing");
  assert.equal(c.majorityThreshold, 7);
  assert.equal(c.gap, 4);
});
test("an incomplete allocation is not labelled hung or controlled", () => {
  const c = councilState(
    {
      SeatsExpected: 13,
      SeatsComplete: 9,
      HungCouncils: 1,
      MajorityCouncils: 1,
      PartyBallotResults: [party(7, 8), party(52, 1)],
    },
    meta,
  );
  assert.equal(c.status, "developing");
});
test("completed allocations distinguish majority, hung and exact 50-percent draw", () => {
  assert.equal(
    councilState(
      {
        SeatsExpected: 13,
        SeatsComplete: 13,
        PartyBallotResults: [party(7, 8), party(52, 5)],
      },
      meta,
    ).status,
    "majority",
  );
  assert.equal(
    councilState(
      {
        SeatsExpected: 13,
        SeatsComplete: 13,
        HungCouncils: 1,
        PartyBallotResults: [party(7, 6), party(52, 4), party(3, 3)],
      },
      meta,
    ).status,
    "hung",
  );
  const draw = councilState(
    {
      SeatsExpected: 12,
      SeatsComplete: 12,
      DeadLockDrawnCouncils: 1,
      PartyBallotResults: [party(7, 6), party(52, 6)],
    },
    meta,
  );
  assert.equal(draw.status, "drawn");
  assert.equal(draw.seatLeader, null);
  assert.equal(draw.majorityThreshold, 7);
});
test("missing allocation data remains unknown rather than becoming zero", () => {
  assert.equal(councilState(null, meta).status, "unavailable");
  assert.equal(seatSummary({}).seatsAllocated, null);
  assert.equal(seatRows({ PartyBallotResults: [{ ID: 7 }] })[0].prSeats, null);
});
test("leading/control counters and pending councils use IEC fields directly", () => {
  const summary = seatSummary({
    MunicExpected: 213,
    MuncipalitiesComplete: 35,
    HungCouncils: 27,
    MajorityCouncils: 8,
    DeadLockDrawnCouncils: 0,
    SeatsExpected: 8825,
    SeatsComplete: 822,
  });
  assert.equal(summary.notCalculated, 178);
  assert.equal(summary.controlled, 8);
  const rows = seatRows({
    PartyBallotResults: [{ ...party(7, 362), CouncilsWon: 19, MajorityWon: 7 }],
  });
  assert.equal(rows[0].councilsLeading, 19);
  assert.equal(rows[0].councilsControl, 7);
  assert.equal(rows[0].totalSeats, 362);
});
test("council list preserves unpublished municipalities and published source timestamps", async () => {
  const source = {
    get: async (_year, kind) =>
      kind === "parties"
        ? { data: [] }
        : {
            url: "https://results.elections.org.za/test.js",
            fetchedAt: "2026-11-05T08:00:00Z",
            data: {
              ReportDate: "2026-11-05T09:00:00+02:00",
              MunicExpected: 213,
              MuncipalitiesComplete: 0,
              PartyBallotResults: [],
              ProvinceResults: [],
            },
          },
  };
  const result = await new CouncilService(source).get({});
  assert.equal(result.councils.length, 213);
  assert.equal(result.coverage.published, 0);
  assert.ok(result.councils.every((c) => c.status === "unavailable"));
  assert.equal(result.source.reportDate, "2026-11-05T09:00:00+02:00");
});
