import test from "node:test";
import assert from "node:assert/strict";
import { retainUnchangedFields } from "../src/lib/refresh-data.ts";

test("an identical poll preserves data references", () => {
  const previous = { rows: [{ votes: 10 }], features: { ward: { share: 50 } } };
  assert.equal(
    retainUnchangedFields(previous, structuredClone(previous)),
    previous,
  );
});
test("timestamp updates preserve map geometry and party rows", () => {
  const previous = {
    source: { fetchedAt: "before" },
    rows: [{ votes: 10 }],
    features: { ward: { share: 50 } },
  };
  const next = structuredClone(previous);
  next.source.fetchedAt = "after";
  const result = retainUnchangedFields(previous, next);
  assert.equal(result.rows, previous.rows);
  assert.equal(result.features, previous.features);
  assert.equal(result.source.fetchedAt, "after");
});
test("changed votes update without retaining stale party results", () => {
  const previous = { rows: [{ votes: 10 }], features: { ward: { share: 50 } } };
  const next = { rows: [{ votes: 20 }], features: { ward: { share: 50 } } };
  const result = retainUnchangedFields(previous, next);
  assert.equal(result.rows[0].votes, 20);
  assert.equal(result.features, previous.features);
});
