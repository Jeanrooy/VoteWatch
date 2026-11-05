import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ExternalLink,
  Globe2,
  MapPin,
  RefreshCw,
} from "lucide-react";
import GISMap from "./GISMap";
import type { CouncilPacket } from "./CouncilResults";
import "./councils.css";
import { number } from "./data";
import {
  type Registry,
  type Selection,
  type BallotMode,
  type Results,
  type ResultRow,
  useJSON,
  queryFor,
  readSelection,
} from "./gis-types";
import "./gis.css";
const ballotNames = {
  combined: "Combined summary",
  ward: "Ward ballot",
  pr: "Municipal PR",
  district: "District PR",
};
function PartyLogo({ row }: { row: ResultRow }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="gis-party-logo">
      {row.logoUrl && !failed ? (
        <img
          src={row.logoUrl}
          loading="lazy"
          alt={`${row.label} logo`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span style={{ color: row.color }}>{row.label.slice(0, 3)}</span>
      )}
    </span>
  );
}
export default function GISExplorer() {
  const registry = useJSON<Registry>("/gis/registry.json");
  const [selection, setSelection] = useState<Selection>(readSelection);
  const [ballot, setBallot] = useState<BallotMode>(() => {
    const b = new URLSearchParams(location.search).get("ballot");
    return b && b in ballotNames ? (b as BallotMode) : "combined";
  });
  const [revision, setRevision] = useState(0);
  const result = useJSON<Results>(
    "/api/results?" + queryFor(selection, ballot),
    revision,
    10000,
  );
  const data = result.data;
  const [focusParty, setFocusParty] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("party"),
  );
  const partyDictionary = useJSON<{
    data: { ID: number; Name: string; PartyFullName: string }[];
  }>(focusParty ? "/api/public?year=2026&kind=parties" : null, revision);
  const partyIdentity =
    data?.rows.find((r) => r.partyId === focusParty) ??
    (() => {
      const p = partyDictionary.data?.data.find(
        (p) => String(p.ID) === focusParty,
      );
      return p ? { label: p.Name } : undefined;
    })();
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = breadcrumbRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [selection]);
  const partyList = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  function checkScroll() {
    const el = partyList.current;
    setMoreBelow(
      Boolean(el && el.scrollHeight - el.clientHeight - el.scrollTop > 5),
    );
  }
  function chooseParty(id: string | null) {
    setFocusParty(id);
    setAllParties(false);
    const u = new URL(location.href);
    u.searchParams.delete("detail");
    id ? u.searchParams.set("party", id) : u.searchParams.delete("party");
    history.pushState(null, "", u);
  }

  const councilQuery = new URLSearchParams();
  for (const key of ["province", "municipality", "district"] as const)
    if (selection[key]) councilQuery.set(key, selection[key]!);
  const council = useJSON<CouncilPacket>(
    "/api/councils?" + councilQuery,
    revision,
    10000,
  );
  const [allParties, setAllParties] = useState(
    () => new URLSearchParams(location.search).get("detail") === "parties",
  );
  const nationalView =
    !selection.province &&
    !selection.district &&
    !selection.municipality &&
    !selection.ward &&
    !selection.vd;
  const sidebarParties = (data?.rows ?? [])
    .filter(
      (r) =>
        (!focusParty || r.partyId === focusParty) &&
        (nationalView || r.votes > 0),
    )
    .sort((a, b) => b.votes - a.votes);
  const seatRows = new Map(
    (council.data?.rows ?? []).map((r) => [r.partyId, r]),
  );
  const metric = (n: number | null | undefined) =>
    n == null ? "\u2014" : number(n);
  function detailLink(kind: "parties" | "councils") {
    const u = new URL(location.href);
    if (kind === "councils") {
      u.searchParams.set("view", "councils");
      u.searchParams.delete("detail");
    } else {
      u.searchParams.set("detail", "parties");
    }
    return u.pathname + u.search;
  }

  useEffect(() => {
    const fn = () => {
      setFocusParty(new URLSearchParams(location.search).get("party"));
      setSelection(readSelection());
      setAllParties(
        new URLSearchParams(location.search).get("detail") === "parties",
      );
      const b = new URLSearchParams(location.search).get("ballot");
      setBallot(b && b in ballotNames ? (b as BallotMode) : "combined");
    };
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  function update(next: Selection, nextBallot: BallotMode = ballot) {
    setAllParties(false);
    setSelection(next);
    setBallot(nextBallot);
    const u = new URL(location.href);
    for (const k of [
      "province",
      "district",
      "municipality",
      "ward",
      "vd",
      "region",
    ])
      u.searchParams.delete(k);
    u.searchParams.set("view", "official");
    u.searchParams.delete("detail");
    for (const [k, v] of Object.entries(next)) if (v) u.searchParams.set(k, v);
    u.searchParams.set("ballot", nextBallot);
    history.pushState(null, "", u);
  }
  const reg = registry.data;
  const leadingPlaces = Object.entries(
    (nationalView ? data?.mapFeatures : data?.features) ?? {},
  )
    .filter(([, r]) => r.available && r.leader?.id === focusParty)
    .map(([id, r]) => {
      const m = reg?.municipalities.find((m) => m.id === id);
      const w = reg?.wards.find((w) => w.id === id);
      return {
        id,
        name:
          m?.name ??
          (w ? `Ward ${w.number}` : (r.stationName ?? `Voting district ${id}`)),
        kind: m ? "municipality" : w ? "ward" : "station",
        share: r.leader!.share,
        progress: r.progress,
      };
    })
    .sort((a, b) => b.share - a.share);
  useEffect(() => {
    const el = partyList.current;
    if (!el) return;
    checkScroll();
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [data, focusParty]);
  useEffect(() => {
    if (partyList.current) partyList.current.scrollTop = 0;
  }, [
    focusParty,
    selection.province,
    selection.municipality,
    selection.district,
    selection.ward,
    selection.vd,
  ]);
  const province = reg?.provinces.find((p) => p.id === selection.province),
    municipality = reg?.municipalities.find(
      (m) => m.id === selection.municipality,
    ),
    ward = reg?.wards.find((w) => w.id === selection.ward),
    district = reg?.districts.find((d) => d.id === selection.district);
  function navigate(kind: string, id: string) {
    if (!reg) return;
    if (kind === "national") return update({});
    if (kind === "province") return update({ province: id });
    if (kind === "district") {
      const d = reg.districts.find((d) => d.id === id);
      if (d)
        return update({ province: d.provinceId, district: id }, "district");
    }
    if (kind === "municipality") {
      const m = reg.municipalities.find((m) => m.id === id);
      if (m)
        return update({
          province: m.provinceId,
          municipality: id,
          ...(selection.district === m.districtId
            ? { district: m.districtId }
            : {}),
        });
    }
    if (kind === "ward" || kind === "station") {
      const w = reg.wards.find(
        (w) => w.id === (kind === "ward" ? id : reg.votingDistricts[id]),
      );
      if (w)
        return update({
          province: w.provinceId,
          municipality: w.municipalityId,
          ward: w.id,
          ...(kind === "station" ? { vd: id } : {}),
        });
    }
  }
  const breadcrumbs = [
    { kind: "national", id: "ZA", name: "National" },
    ...(province
      ? [{ kind: "province", id: province.id, name: province.name }]
      : []),
    ...(district
      ? [{ kind: "district", id: district.id, name: district.name }]
      : []),
    ...(municipality
      ? [{ kind: "municipality", id: municipality.id, name: municipality.name }]
      : []),
    ...(ward
      ? [{ kind: "ward", id: ward.id, name: `Ward ${ward.number}` }]
      : []),
    ...(selection.vd
      ? [{ kind: "station", id: selection.vd, name: selection.vd }]
      : []),
  ];
  function exportResults() {
    if (!data) return;
    const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const csv = [
      "event,location,ward_id,voting_district,ballot,party_id,party,candidate,votes,share,source_fetched_at",
      ...data.rows.map((r) =>
        [
          1887,
          q(data.label),
          selection.ward ?? "",
          selection.vd ?? "",
          ballot,
          q(r.partyId),
          q(r.partyName),
          q(r.candidate ?? ""),
          r.votes,
          r.share.toFixed(4),
          data.source?.fetchedAt ?? "",
        ].join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `IEC-2026-${data.id}-${ballot}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const available = data?.available && data.applicable;
  return (
    <section
      className={`panel official-explorer gis-explorer ${allParties ? "" : "gis-screen-view"}`}
    >
      <div className="panel-heading">
        <div>
          <h2>
            <span className="public-dot" /> Vote Watch
          </h2>
        </div>
        <div
          className="gis-breadcrumbs"
          ref={breadcrumbRef}
          aria-label="Map location"
        >
          {breadcrumbs.map((p, i) => (
            <span key={p.kind}>
              {i === 0 ? <Globe2 size={14} /> : <ChevronRight size={13} />}
              <button
                onClick={() => navigate(p.kind, p.id)}
                aria-current={
                  i === breadcrumbs.length - 1 ? "location" : undefined
                }
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>
        <div className="public-actions">
          <a
            className="gis-official-link"
            href="https://results.elections.org.za/dashboards/lge/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Official IEC results (opens in a new tab)"
          >
            <span>Official IEC results</span>
            <ExternalLink size={14} />
          </a>
          <button
            className="icon-button"
            aria-label="Refresh official results"
            disabled={result.loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={17} className={result.loading ? "spin" : ""} />
          </button>
        </div>
      </div>
      {!reg ? (
        <div className="empty" role="status">
          <MapPin size={27} />
          <h3>
            {registry.error
              ? "Boundary registry unavailable"
              : "Loading the national ward registry…"}
          </h3>
          <p>
            {registry.error ||
              "4,485 wards · 23,696 voting districts · all nine provinces"}
          </p>
        </div>
      ) : (
        <>
          {!allParties && (
            <div className="gis-main-grid">
              <GISMap
                registry={reg}
                selection={selection}
                results={data}
                layer="leader"
                labels={true}
                showDistricts={false}
                onNavigate={navigate}
                revision={revision}
                focusParty={focusParty}
              />
              <aside className="gis-result-panel gis-unified-panel">
                <div className="gis-overview-heading">
                  <div>
                    <span className="gis-kicker">
                      {focusParty
                        ? (partyIdentity?.label ?? "Party view")
                        : "Party results"}{" "}
                      ·{" "}
                      {ballot === "combined"
                        ? "Ward + municipal PR"
                        : ballotNames[ballot]}
                    </span>
                    <h3>
                      {data?.station?.name ??
                        data?.label ??
                        breadcrumbs.at(-1)?.name}
                    </h3>
                  </div>
                  <span
                    className="gis-overview-report"
                    title="Voting districts reporting"
                  >
                    {data?.reporting?.percent != null
                      ? `${data.reporting.percent.toFixed(1)}%`
                      : "\u2014"}
                    <small>reporting</small>
                  </span>
                </div>
                {focusParty && !available && (
                  <button
                    className="gis-all-parties-back"
                    onClick={() => chooseParty(null)}
                  >
                    <ArrowLeft size={12} /> All parties
                  </button>
                )}
                {result.loading && !data ? (
                  <p className="gis-reading" role="status">
                    Loading results...
                  </p>
                ) : !available ? (
                  <div className="gis-reading" role="status">
                    <strong>
                      {data?.applicable === false
                        ? "Ballot not applicable"
                        : "Results unavailable"}
                    </strong>
                    <p>
                      {data?.reason ??
                        result.error ??
                        "No published results yet."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="gis-overview-totals">
                      <span>
                        <strong>{number(data!.validVotes)}</strong> valid votes
                      </span>
                      <span>
                        <strong>
                          {metric(council.data?.summary.seatsAllocated)} /{" "}
                          {metric(council.data?.summary.seatsExpected)}
                        </strong>{" "}
                        seats allocated
                      </span>
                    </div>
                    <div
                      className="gis-unified-parties"
                      ref={partyList}
                      onScroll={checkScroll}
                      tabIndex={0}
                      role="region"
                      aria-label="All published party results"
                    >
                      {focusParty && (
                        <button
                          className="gis-all-parties-back"
                          onClick={() => chooseParty(null)}
                        >
                          <ArrowLeft size={12} /> All parties
                        </button>
                      )}
                      <span className="gis-party-list-count">
                        {focusParty
                          ? sidebarParties.length
                            ? "Party performance in this location"
                            : "No published party votes in this location"
                          : `${sidebarParties.length} published entries`}
                      </span>
                      {sidebarParties.map((r) => {
                        const seat = seatRows.get(r.partyId);
                        return (
                          <article key={r.partyId}>
                            <button
                              className="gis-unified-party-heading"
                              disabled={
                                Boolean(focusParty) ||
                                r.partyId === "OTHER" ||
                                r.partyId === "-2"
                              }
                              onClick={() => chooseParty(r.partyId)}
                              aria-label={`Explore ${r.label} results`}
                            >
                              <PartyLogo row={r} />
                              <strong title={r.partyName}>
                                {r.partyId === "OTHER" || r.partyId === "-2"
                                  ? "Other (aggregate)"
                                  : r.label}
                              </strong>
                              <b>
                                {r.share.toFixed(1)}
                                <small>%</small>
                              </b>
                            </button>
                            <div className="gis-party-share-track">
                              <i
                                style={{
                                  width: `${Math.min(100, Math.max(0, r.share))}%`,
                                  background: r.color,
                                }}
                              />
                            </div>
                            <dl>
                              <div>
                                <dt>Votes</dt>
                                <dd>{number(r.votes)}</dd>
                              </div>
                              <div
                                title={`Ward seats: ${metric(seat?.wardSeats)} · PR seats: ${metric(seat?.prSeats)}`}
                              >
                                <dt>Seats</dt>
                                <dd>{metric(seat?.totalSeats)}</dd>
                              </div>
                              <div>
                                <dt>Councils leading</dt>
                                <dd>{metric(seat?.councilsLeading)}</dd>
                              </div>
                              <div>
                                <dt>Control</dt>
                                <dd>{metric(seat?.councilsControl)}</dd>
                              </div>
                            </dl>
                          </article>
                        );
                      })}
                      {focusParty && (
                        <section className="gis-party-leading-places">
                          <h4>
                            Leading in {leadingPlaces.length}{" "}
                            {nationalView ||
                            (!selection.municipality && !selection.ward)
                              ? "municipalities"
                              : selection.ward
                                ? "voting districts"
                                : "wards"}
                          </h4>
                          <p>
                            Published vote leads in this view, not declared
                            wins.
                          </p>
                          {leadingPlaces.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => navigate(p.kind, p.id)}
                            >
                              <span>{p.name.replace(/^[A-Z0-9]+ - /, "")}</span>
                              <strong>{p.share.toFixed(1)}%</strong>
                              <ChevronRight size={13} />
                            </button>
                          ))}
                          {!leadingPlaces.length && (
                            <p>
                              No published leads in this view. Use the map or
                              breadcrumb to explore other locations.
                            </p>
                          )}
                        </section>
                      )}
                    </div>
                    {moreBelow && (
                      <button
                        className="gis-party-scroll-more"
                        aria-label="Scroll to more results"
                        onClick={() =>
                          partyList.current?.scrollBy({
                            top: 220,
                            behavior: window.matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "auto"
                              : "smooth",
                          })
                        }
                      >
                        <ChevronDown size={15} />
                      </button>
                    )}
                  </>
                )}
                {council.data &&
                  council.data.summary.seatsExpected != null &&
                  council.data.summary.seatsAllocated != null &&
                  council.data.summary.seatsAllocated <
                    council.data.summary.seatsExpected && (
                    <p className="gis-seat-status">
                      {number(
                        council.data.summary.seatsExpected -
                          council.data.summary.seatsAllocated,
                      )}{" "}
                      seats pending IEC allocation. Party seats are provisional.
                    </p>
                  )}

                <div className="gis-overview-links">
                  <a href={detailLink("parties")}>
                    All party results <ArrowRight size={13} />
                  </a>
                  <a href={detailLink("councils")}>
                    Seats & councils <ArrowRight size={13} />
                  </a>
                </div>
              </aside>
            </div>
          )}
          {allParties && (
            <>
              <a
                className="gis-back-to-map"
                href={detailLink("parties").replace(/[?&]detail=parties/, "")}
              >
                <ArrowLeft size={14} /> Back to map
              </a>
              <section className="gis-results-table">
                <div className="gis-section-title">
                  <div>
                    <h3>
                      {ballot === "ward"
                        ? "Ward party / candidate results"
                        : "Party results"}
                    </h3>
                    <p>
                      {ballotNames[ballot]} ·{" "}
                      {data?.label ?? "Selected location"}
                    </p>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={exportResults}
                    disabled={!available}
                  >
                    <ArrowDownToLine size={14} /> Export CSV
                  </button>
                </div>
                <div className="gis-ballot-explainer">
                  <i className={`ballot-${ballot}`} />
                  {ballot === "ward"
                    ? "Grey ballot: vote for a ward candidate. Independent votes may be grouped in the source."
                    : ballot === "pr"
                      ? "Green ballot: vote for a party in the local or metropolitan council."
                      : ballot === "district"
                        ? "Yellow ballot: district PR, labelled DC 40% in the IEC export. Applies outside metros."
                        : "Published ward + municipal PR summary. Select an individual ballot to compare the same contest."}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>PARTY / CANDIDATE</th>
                        <th>VALID VOTES</th>
                        <th>SHARE</th>
                        <th>SEATS</th>
                        <th>COUNCILS LEADING</th>
                        <th>CONTROL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {available &&
                        data!.rows.map((r) => (
                          <tr key={r.partyId}>
                            <td>
                              <div className="gis-table-party">
                                <PartyLogo row={r} />
                                <span>
                                  <strong>{r.label}</strong>
                                  <small>
                                    {ballot === "ward" && r.candidate
                                      ? r.candidate
                                      : r.partyName}
                                  </small>
                                </span>
                              </div>
                            </td>
                            <td>{number(r.votes)}</td>
                            <td>{r.share.toFixed(2)}%</td>
                            <td>
                              {metric(seatRows.get(r.partyId)?.totalSeats)}
                            </td>
                            <td>
                              {metric(seatRows.get(r.partyId)?.councilsLeading)}
                            </td>
                            <td>
                              {metric(seatRows.get(r.partyId)?.councilsControl)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!available && (
                    <p className="gis-no-matches">
                      {data?.reason ?? result.error ?? "Loading results…"}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
