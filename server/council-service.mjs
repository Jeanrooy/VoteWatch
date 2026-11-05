import { registry, resolveSelection, partyMeta } from "./gis-service.mjs";
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
export function seatRows(node, dictionary = []) {
  return (node.PartyBallotResults ?? [])
    .map((p) => ({
      ...partyMeta(p.ID, p.Name, dictionary),
      wardSeats: count(p.WardSeatsWon),
      prSeats: count(p.PRSeatsWon),
      totalSeats: count(p.TotalSeatsWon),
      councilsLeading: count(p.CouncilsWon),
      councilsControl: count(p.MajorityWon),
    }))
    .sort((a, b) => (b.totalSeats ?? -1) - (a.totalSeats ?? -1));
}
export function seatSummary(node) {
  const expected = count(node.MunicExpected),
    calculated = count(node.MuncipalitiesComplete);
  return {
    seatsExpected: count(node.SeatsExpected),
    seatsAllocated: count(node.SeatsComplete),
    councilsExpected: expected,
    councilsCalculated: calculated,
    notCalculated:
      expected !== null && calculated !== null && expected >= calculated
        ? expected - calculated
        : null,
    hung: count(node.HungCouncils),
    drawn: count(node.DeadLockDrawnCouncils),
    controlled: count(node.MajorityCouncils),
  };
}
export function councilState(node, meta, dictionary = []) {
  if (!node)
    return {
      id: meta.id,
      name: meta.name,
      provinceId: meta.provinceId,
      isMetro: meta.isMetro,
      status: "unavailable",
      seatsAllocated: null,
      seatsExpected: null,
      majorityThreshold: null,
      seatLeader: null,
      voteLeader: null,
      gap: null,
      reportDate: null,
    };
  const expected = count(node.SeatsExpected),
    allocated = count(node.SeatsComplete);
  const complete = expected > 0 && allocated !== null && allocated >= expected;
  const candidates = (node.PartyBallotResults ?? [])
    .filter((p) => p.ID !== -2 && count(p.TotalSeatsWon) > 0)
    .sort((a, b) => b.TotalSeatsWon - a.TotalSeatsWon);
  const first = candidates[0],
    tied = first && candidates[1]?.TotalSeatsWon === first.TotalSeatsWon;
  const leader =
    first && !tied
      ? {
          ...partyMeta(first.ID, first.Name, dictionary),
          seats: first.TotalSeatsWon,
          wardSeats: count(first.WardSeatsWon),
          prSeats: count(first.PRSeatsWon),
        }
      : null;
  const vote = (node.PartyBallotResults ?? [])
    .filter((p) => p.ID !== -2 && p.TotalValidVotes > 0)
    .sort((a, b) => b.TotalValidVotes - a.TotalValidVotes);
  const voteLeader =
    vote[0] && vote[0].TotalValidVotes !== vote[1]?.TotalValidVotes
      ? partyMeta(vote[0].ID, vote[0].Name, dictionary)
      : null;
  const threshold = expected > 0 ? Math.floor(expected / 2) + 1 : null;
  let status = complete ? "complete" : "developing";
  if (complete) {
    if (leader && threshold !== null && leader.seats >= threshold)
      status = "majority";
    else if (node.DeadLockDrawnCouncils > 0) status = "drawn";
    else if (node.HungCouncils > 0) status = "hung";
  }
  return {
    id: meta.id,
    name: meta.name,
    provinceId: meta.provinceId,
    isMetro: meta.isMetro,
    status,
    seatsAllocated: allocated,
    seatsExpected: expected,
    majorityThreshold: threshold,
    seatLeader: leader,
    voteLeader,
    gap:
      threshold !== null && leader
        ? Math.max(0, threshold - leader.seats)
        : null,
    reportDate: node.ReportDate ?? null,
  };
}
export class CouncilService {
  constructor(source) {
    this.source = source;
  }
  async get(query) {
    const s = resolveSelection({ ...query, ballot: "combined" });
    const municipality = s.municipality,
      province = s.province,
      district = s.district;
    const [packet, dictionaryPacket] = await Promise.all([
      this.source.get(
        "2026",
        municipality ? "municipality" : province ? "province" : "national",
        municipality?.id ?? province?.id,
      ),
      this.source.get("2026", "parties"),
    ]);
    const node = packet.data,
      dictionary = dictionaryPacket.data;
    const entries = municipality
      ? [node]
      : province
        ? (node.MunicipalityResults ?? [])
        : (node.ProvinceResults ?? []).flatMap(
            (p) => p.MunicipalityResults ?? [],
          );
    const byId = new Map(entries.map((m) => [String(m.MunicipalityID), m]));
    const members = registry.municipalities.filter((m) =>
      municipality
        ? m.id === municipality.id
        : district
          ? m.districtId === district.id
          : province
            ? m.provinceId === province.id
            : true,
    );
    const councils = members.map((m) =>
      councilState(byId.get(m.id), m, dictionary),
    );
    let summary = seatSummary(node);
    const warnings = [];
    if (district && !municipality) {
      const sum = (key) =>
        members.every((m) => count(byId.get(m.id)?.[key]) !== null)
          ? members.reduce((v, m) => v + byId.get(m.id)[key], 0)
          : null;
      summary = {
        seatsExpected: sum("SeatsExpected"),
        seatsAllocated: sum("SeatsComplete"),
        councilsExpected: members.length,
        councilsCalculated: sum("MuncipalitiesComplete"),
        notCalculated: null,
        hung: sum("HungCouncils"),
        drawn: sum("DeadLockDrawnCouncils"),
        controlled: sum("MajorityCouncils"),
      };
      summary.notCalculated =
        summary.councilsCalculated === null
          ? null
          : members.length - summary.councilsCalculated;
      warnings.push(
        "This district view shows its constituent local councils. It does not represent the district council’s own seat allocation or appointed members.",
      );
    }
    const rows = district && !municipality ? [] : seatRows(node, dictionary);
    const availableRows = rows
      .filter((r) => r.totalSeats !== null)
      .reduce((sum, r) => sum + r.totalSeats, 0);
    if (
      rows.length &&
      summary.seatsAllocated !== null &&
      availableRows !== summary.seatsAllocated
    )
      warnings.push(
        "The published party seat rows and allocation counter do not yet reconcile. Both are shown as supplied; no missing seats are estimated.",
      );
    return {
      level: municipality
        ? "municipality"
        : district
          ? "district-group"
          : province
            ? "province"
            : "national",
      label:
        municipality?.name ??
        district?.name ??
        province?.name ??
        "South Africa",
      summary,
      rows,
      councils,
      coverage: {
        expected: members.length,
        published: members.filter((m) => byId.has(m.id)).length,
      },
      source: {
        url: packet.url,
        reportDate: node.ReportDate,
        fetchedAt: packet.fetchedAt,
        stale: packet.stale,
        error: packet.error ?? null,
      },
      warnings,
      definitions: {
        leading:
          "IEC CouncilsWon: councils in which the party has the highest number of seats.",
        control:
          "IEC MajorityWon: councils in which a party has more than 50% of seats. This does not verify a coalition or elected mayor.",
        allocation:
          "Published ward and PR seat counts, independent of the vote-ballot selector. Not estimated from vote share.",
      },
    };
  }
}
