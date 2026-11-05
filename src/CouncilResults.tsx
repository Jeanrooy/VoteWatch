import { useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
} from "lucide-react";
import { useJSON, readSelection, type Selection } from "./gis-types";
import { number } from "./data";
import { sourceTime } from "./useLiveResults";
import "./councils.css";
type Party = {
  partyId: string;
  partyName: string;
  label: string;
  color: string;
  logoUrl: string | null;
};
type SeatRow = Party & {
  wardSeats: number | null;
  prSeats: number | null;
  totalSeats: number | null;
  councilsLeading: number | null;
  councilsControl: number | null;
};
type Council = {
  id: string;
  name: string;
  provinceId: string;
  isMetro: boolean;
  status: string;
  seatsAllocated: number | null;
  seatsExpected: number | null;
  majorityThreshold: number | null;
  seatLeader: (Party & { seats: number }) | null;
  voteLeader: Party | null;
  gap: number | null;
  reportDate: string | null;
};
export type CouncilPacket = {
  level: string;
  label: string;
  summary: {
    seatsExpected: number | null;
    seatsAllocated: number | null;
    councilsExpected: number | null;
    councilsCalculated: number | null;
    notCalculated: number | null;
    hung: number | null;
    drawn: number | null;
    controlled: number | null;
  };
  rows: SeatRow[];
  councils: Council[];
  coverage: { expected: number; published: number };
  source: {
    url: string;
    reportDate: string;
    fetchedAt: string;
    stale: boolean;
    error?: string;
  };
  warnings: string[];
  definitions: { leading: string; control: string; allocation: string };
};
const n = (value: number | null | undefined) =>
  value == null ? "—" : number(value);
const statusLabels: Record<string, string> = {
  developing: "Developing",
  majority: "Seat majority",
  drawn: "Drawn / 50%",
  hung: "Hung council",
  complete: "Allocation complete",
  unavailable: "Not published",
};
function Logo({ party }: { party: Party }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="council-logo">
      {party.logoUrl && !failed ? (
        <img
          alt={`${party.label} logo`}
          src={party.logoUrl}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <i style={{ background: party.color }} />
      )}
    </span>
  );
}
export default function CouncilResults({
  selection = readSelection(),
  revision = 0,
  onSelect,
}: {
  selection?: Selection;
  revision?: number;
  onSelect?: (id: string, provinceId: string) => void;
}) {
  const q = new URLSearchParams();
  for (const key of ["province", "municipality", "district"] as const)
    if (selection[key]) q.set(key, selection[key]!);
  const [retry, setRetry] = useState(0);
  const state = useJSON<CouncilPacket>(
    "/api/councils?" + q,
    revision + retry,
    10000,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [metro, setMetro] = useState(false);
  const data = state.data,
    loading = state.loading,
    error = state.error;
  const summary = data?.summary;
  const expected = summary?.seatsExpected ?? 0;
  const allocated = summary?.seatsAllocated ?? 0;
  const rows = (data?.councils ?? []).filter(
    (c) =>
      (!metro || c.isMetro) &&
      (filter === "all" || c.status === filter) &&
      c.name.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (c: Council) =>
    onSelect
      ? onSelect(c.id, c.provinceId)
      : location.assign(
          `/?view=official&province=${c.provinceId}&municipality=${c.id}`,
        );
  const segments = data?.rows.filter((p) => (p.totalSeats ?? 0) > 0) ?? [];
  const segmentTotal = segments.reduce(
    (sum, r) => sum + (r.totalSeats ?? 0),
    0,
  );
  const canDraw =
    expected > 0 && segmentTotal <= expected && segmentTotal === allocated;
  return (
    <section className="council-results">
      <div className="council-results-heading">
        <div>
          <span className="council-eyebrow">SEAT ALLOCATION & COUNCILS</span>
          <h2>{data?.label ?? "Published council results"}</h2>
          <p>
            {selection.ward || selection.vd
              ? "Municipality-wide seat allocation for the selected location. "
              : "Published ward and PR seat counts. "}
            These figures are independent of the vote-ballot selector.
          </p>
        </div>
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => setRetry((v) => v + 1)}
          aria-label="Refresh seat allocations"
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} />
        </button>
      </div>
      {!data ? (
        <div className="empty" role="status">
          <Info size={25} />
          <h3>
            {loading ? "Loading seat allocations…" : "Seat data unavailable"}
          </h3>
          <p>{error || "Reading the IEC council and seat counters."}</p>
        </div>
      ) : (
        <>
          {(error || data.source.stale) && (
            <div className="council-alert" role="status">
              Retained seat snapshot:{" "}
              {error || data.source.error || "Source refresh unavailable."}
            </div>
          )}
          <div className="council-summary-grid">
            {[
              {
                name: "Seats allocated",
                value: `${n(summary!.seatsAllocated)} / ${n(summary!.seatsExpected)}`,
                note: "Published / available seats",
              },
              {
                name: "Councils calculated",
                value: `${n(summary!.councilsCalculated)} / ${n(summary!.councilsExpected)}`,
                note: "IEC calculation progress",
              },
              {
                name: "Control / majority",
                value: n(summary!.controlled),
                note: "More than 50% of seats",
              },
              {
                name: "Hung councils",
                value: n(summary!.hung),
                note: "No outright seat majority",
              },
              {
                name: "Drawn councils",
                value: n(summary!.drawn),
                note: "IEC 50% / deadlock counter",
              },
              {
                name: "Not yet calculated",
                value: n(summary!.notCalculated),
                note: "Allocation still pending",
              },
            ].map((s) => (
              <div key={s.name}>
                <span>{s.name}</span>
                <strong>{s.value}</strong>
                <small>{s.note}</small>
              </div>
            ))}
          </div>
          {canDraw && (
            <div className="council-seat-visual">
              <div>
                <strong>Published seat allocation</strong>
                <span>
                  {n(allocated)} allocated · {n(expected - allocated)} remaining
                </span>
              </div>
              <div className="council-seat-track">
                {segments.map((p) => (
                  <span
                    key={p.partyId}
                    style={{
                      width: `${((p.totalSeats ?? 0) / expected) * 100}%`,
                      background: p.color,
                    }}
                    title={`${p.label}: ${p.totalSeats} seats`}
                  />
                ))}
                {data.level === "municipality" && (
                  <i
                    className="council-majority-line"
                    style={{
                      left: `${((Math.floor(expected / 2) + 1) / expected) * 100}%`,
                    }}
                  />
                )}
              </div>
              <p>
                {data.level === "municipality"
                  ? `${Math.floor(expected / 2) + 1} seats needed for a majority. The line marks this threshold.`
                  : "Grey space represents seats not covered by the displayed party allocations."}
              </p>
            </div>
          )}
          <div className="council-tables">
            <section>
              <div className="council-subheading">
                <h3>Party seat allocation</h3>
                <span>IEC “Leading” and “Control” counters</span>
              </div>
              <div className="table-scroll">
                <table className="responsive-results-table" role="table">
                  <thead>
                    <tr>
                      <th>PARTY</th>
                      <th>WARD</th>
                      <th>PR</th>
                      <th>TOTAL</th>
                      <th title={data.definitions.leading}>COUNCILS LEADING</th>
                      <th title={data.definitions.control}>CONTROL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((p) => (
                      <tr role="row" key={p.partyId}>
                        <td data-label="Party" role="cell">
                          <div className="council-party-cell">
                            <Logo party={p} />
                            <span>
                              <strong>
                                {p.partyId === "-2"
                                  ? "Other (aggregate)"
                                  : p.label}
                              </strong>
                              <small>{p.partyName}</small>
                            </span>
                          </div>
                        </td>
                        <td data-label="Ward seats" role="cell">
                          {n(p.wardSeats)}
                        </td>
                        <td data-label="PR seats" role="cell">
                          {n(p.prSeats)}
                        </td>
                        <td data-label="Total seats" role="cell">
                          <strong>{n(p.totalSeats)}</strong>
                        </td>
                        <td data-label="Councils leading" role="cell">
                          {n(p.councilsLeading)}
                        </td>
                        <td data-label="Control" role="cell">
                          {n(p.councilsControl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.rows.length && (
                  <p className="council-empty-note">
                    Detailed party allocations are unavailable for this
                    grouping. Constituent local councils are listed below.
                  </p>
                )}
              </div>
            </section>
            <section>
              <div className="council-subheading">
                <h3>
                  {data.level === "municipality"
                    ? "Council majority position"
                    : "Council watch"}
                </h3>
                <span>
                  {data.coverage.published} / {data.coverage.expected} council
                  sources published
                </span>
              </div>
              <div className="council-list-tools">
                <label>
                  <Search size={14} />
                  <input
                    aria-label="Search councils"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a council…"
                  />
                </label>
                <select
                  aria-label="Council status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  {Object.entries(statusLabels).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <label className="council-metro-filter">
                  <input
                    type="checkbox"
                    checked={metro}
                    onChange={(e) => setMetro(e.target.checked)}
                  />{" "}
                  Metros only
                </label>
              </div>
              <div className="council-watch-scroll">
                <table
                  className="responsive-results-table council-watch-table"
                  role="table"
                >
                  <thead>
                    <tr>
                      <th>COUNCIL</th>
                      <th>SEAT LEADER</th>
                      <th>ALLOCATED</th>
                      <th>MAJORITY</th>
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr role="row" key={c.id}>
                        <td data-label="Council" role="cell">
                          <button
                            className="council-name"
                            onClick={() => navigate(c)}
                          >
                            {c.name.replace(/^[A-Z0-9]+ - /, "")}
                          </button>
                        </td>
                        <td data-label="Seat leader" role="cell">
                          {c.seatLeader ? (
                            <span className="council-leader">
                              <i style={{ background: c.seatLeader.color }} />
                              {c.seatLeader.label}{" "}
                              <small>{c.seatLeader.seats} seats</small>
                            </span>
                          ) : (
                            <span className="council-muted">
                              {c.voteLeader
                                ? `Vote lead: ${c.voteLeader.label}`
                                : "No seat leader"}
                            </span>
                          )}
                        </td>
                        <td data-label="Allocated" role="cell">
                          {n(c.seatsAllocated)} / {n(c.seatsExpected)}
                        </td>
                        <td data-label="Majority" role="cell">
                          {n(c.majorityThreshold)}
                          {c.gap !== null && c.gap > 0 && (
                            <small className="council-gap">
                              {c.gap} seats short
                            </small>
                          )}
                        </td>
                        <td data-label="Status" role="cell">
                          <span className={`council-status ${c.status}`}>
                            {statusLabels[c.status] ?? c.status}
                          </span>
                        </td>
                        <td data-label="Explore" role="cell">
                          <button
                            className="icon-button"
                            onClick={() => navigate(c)}
                            aria-label={`Explore ${c.name}`}
                          >
                            <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <p className="council-empty-note">
                    No councils match these filters.
                  </p>
                )}
              </div>
            </section>
          </div>
          <div className="council-definitions">
            <Info size={16} />
            <div>
              <p>
                <strong>Leading:</strong> highest seat count.{" "}
                <strong>Control:</strong> the IEC counter for more than 50% of
                seats. Governing coalitions and elected mayors are not confirmed
                by these counters.
              </p>
              <p>
                “Developing” means the published seat allocation is incomplete.
                A completed calculation is not presented as gazetted
                certification. Seat figures are read from the IEC, not projected
                from vote share.
              </p>
              {data.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </div>
          <div className="council-source">
            <span>
              Source generated {sourceTime(data.source.reportDate)} · Retrieved{" "}
              {sourceTime(data.source.fetchedAt)}
            </span>
            <a href={data.source.url} target="_blank" rel="noreferrer">
              Original IEC data <ExternalLink size={12} />
            </a>
          </div>
        </>
      )}
    </section>
  );
}
