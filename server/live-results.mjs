const codes = {
  1: "EC",
  2: "FS",
  3: "GT",
  4: "KZ",
  5: "MP",
  6: "NC",
  7: "LI",
  8: "NW",
  9: "WC",
};
const known = {
  7: ["ANC", "#d5ad36"],
  52: ["DA", "#3287c9"],
  945: ["EFF", "#cf5d63"],
  3: ["IFP", "#8c72b0"],
  1748: ["MK", "#4ba786"],
  957: ["PA", "#e58a49"],
  1511: ["ActionSA", "#58ac84"],
  4: ["VF PLUS", "#be85db"],
};
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function repeated(rows, key) {
  // IEC includes an independents record (ID 0) whose repeated metadata
  // is zero even when the region has results. Its zero metadata is not a region denominator; its votes still count.
  const values = rows
    .filter((p) => !(p.ID === 0 && p[key] === 0))
    .map((p) => p[key])
    .filter((v) => v !== undefined && v !== null);
  if (!values.length)
    return rows.every((p) => p.TotalValidVotes === 0) ? 0 : null;
  if (!values.every((v) => integer(v) && v === values[0]))
    throw Error(`Inconsistent source ${key}.`);
  return values[0];
}
export function normalizeRegion(node, dictionary = []) {
  const raw = node.PartyBallotResults;
  if (!Array.isArray(raw)) throw Error("Missing party results.");
  const total = repeated(raw, "ValidVotesCast");
  if (total === null)
    throw Error("Published valid-vote denominator is missing.");
  const seen = new Set();
  const rows = raw
    .filter((p) => p.ID !== -2)
    .map((p) => {
      if (seen.has(p.ID) || !integer(p.TotalValidVotes))
        throw Error("Duplicate party or invalid vote count.");
      seen.add(p.ID);
      const meta = dictionary.find((m) => m.ID === p.ID);
      const k = known[p.ID];
      return {
        id: String(p.ID),
        label: k?.[0] ?? meta?.Name ?? p.Name ?? `Party ${p.ID}`,
        name: p.Name ?? meta?.PartyFullName ?? `Party ${p.ID}`,
        color:
          k?.[1] ??
          (/^#[0-9a-f]{6}$/i.test(meta?.sWebColour ?? "")
            ? meta.sWebColour
            : "#8198bd"),
        votes: p.TotalValidVotes,
        share: total ? (p.TotalValidVotes / total) * 100 : 0,
        seats: integer(p.TotalSeatsWon) ? p.TotalSeatsWon : null,
      };
    })
    .sort((a, b) => b.votes - a.votes);
  const sum = rows.reduce((s, r) => s + r.votes, 0);
  if (sum > total)
    throw Error("Listed party votes exceed published valid votes.");
  const other = total - sum;
  if (other)
    rows.push({
      id: "OTHER",
      label: "Others",
      name: "Remaining parties and independents (calculated remainder)",
      color: "#8c9dba",
      votes: other,
      share: (other / total) * 100,
      seats: null,
    });
  const all = integer(node.VDExpected) ? node.VDExpected : null;
  const counted = integer(node.VDsComplete) ? node.VDsComplete : null;
  if (all !== null && counted !== null && counted > all)
    throw Error("Reporting count exceeds expected districts.");
  return {
    votes: total,
    rows,
    counted,
    all,
    progress: all && counted !== null ? (counted / all) * 100 : null,
    reportDate: node.ReportDate,
    registered: integer(node.RegPop)
      ? node.RegPop
      : repeated(raw, "RegisteredVoters"),
    ballot: "IEC combined-ballot summary",
    sourcePartyCount: raw.filter((p) => p.ID !== -2).length,
  };
}
export function normalizeLive(packet, dictionary = []) {
  if (Number(packet.data.ElectoralEventID) !== 1887 || packet.year !== 2026)
    throw Error("Unexpected current election.");
  const regions = {};
  for (const p of packet.data.ProvinceResults ?? []) {
    const id = codes[p.ProvinceID];
    if (!id) throw Error("Unknown province identifier.");
    regions[id] = normalizeRegion(p, dictionary);
  }
  return {
    eventId: 1887,
    year: 2026,
    url: packet.url,
    fetchedAt: packet.fetchedAt,
    reportDate: packet.data.ReportDate,
    stale: packet.stale,
    error: packet.error ?? null,
    national: normalizeRegion(packet.data, dictionary),
    regions,
  };
}
