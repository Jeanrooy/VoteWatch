import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { pointOnFeature } from "@turf/point-on-feature";
import {
  Map,
  MapControls,
  MapGeoJSON,
  MapPopup,
  MapMarker,
  MarkerContent,
  useMap,
} from "./components/ui/map";
import { Crosshair, MapPin, RefreshCw, X, ArrowRight } from "lucide-react";
import {
  type Registry,
  type Selection,
  type Results,
  type Bounds,
  type FeatureResult,
  useJSON,
} from "./gis-types";
type GeometryPacket = {
  data: FeatureCollection & {
    coverage?: { expected: number; matched: number; missing: string[] };
  };
  stale: boolean;
  error?: string;
  url: string;
};
function Camera({ bounds, reset }: { bounds: Bounds; reset: number }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 55,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 650,
        maxZoom: 14,
      },
    );
  }, [map, isLoaded, ...bounds, reset]);
  return null;
}
type PlaceLabel = {
  id: string;
  name: string;
  kind: string;
  center: [number, number];
  priority: number;
};
function PlaceNames({
  places,
  onSelect,
}: {
  places: PlaceLabel[];
  onSelect: (place: PlaceLabel) => void;
}) {
  const { map, isLoaded } = useMap();
  const [visible, setVisible] = useState<PlaceLabel[]>([]);
  useEffect(() => {
    if (!map || !isLoaded) return;
    const update = () => {
      const zoom = map.getZoom(),
        bounds = map.getBounds(),
        canvas = map.getCanvas();
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      const occupied: { x: number; y: number; w: number }[] = [];
      const next: PlaceLabel[] = [];
      for (const place of [...places].sort(
        (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
      )) {
        if (place.priority === 2 && zoom < 6.2) continue;
        if (place.kind === "ward" && zoom < 7) continue;
        if (!bounds.contains(place.center)) continue;
        const point = map.project(place.center),
          w = Math.min(150, place.name.length * 5.5 + 12);
        if (
          point.x < w / 2 + 5 ||
          point.x > width - w / 2 - 5 ||
          point.y < 55 ||
          point.y > height - 25
        )
          continue;
        if (
          occupied.some(
            (o) =>
              Math.abs(o.x - point.x) < (o.w + w) / 2 + 12 &&
              Math.abs(o.y - point.y) < 30,
          )
        )
          continue;
        occupied.push({ x: point.x, y: point.y, w });
        next.push(place);
        if (next.length >= (width < 600 ? 18 : 45)) break;
      }
      setVisible(next);
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
    };
  }, [map, isLoaded, places]);
  return (
    <>
      {visible.map((place) => (
        <MapMarker
          key={place.kind + place.id}
          longitude={place.center[0]}
          latitude={place.center[1]}
        >
          <MarkerContent>
            <button
              className={`gis-place-name ${place.kind === "ward" ? "gis-place-name-ward" : ""}`}
              onClick={() => onSelect(place)}
              aria-label={`Explore ${place.name}`}
            >
              {place.name}
            </button>
          </MarkerContent>
        </MapMarker>
      ))}
    </>
  );
}

export default function GISMap({
  registry,
  selection,
  results,
  layer,
  labels,
  showDistricts,
  onNavigate,
  revision,
  focusParty,
}: {
  registry: Registry;
  selection: Selection;
  results: Results | null;
  layer: "leader" | "reporting";
  labels: boolean;
  showDistricts: boolean;
  onNavigate: (kind: string, id: string) => void;
  revision: number;
  focusParty?: string | null;
}) {
  const [reset, setReset] = useState(0),
    [hover, setHover] = useState("");
  const [touchCard, setTouchCard] = useState(
    () => window.matchMedia("(max-width: 760px), (hover: none)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px), (hover: none)");
    const change = () => {
      setTouchCard(media.matches);
      setHoverCard(null);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  function openLocation(
    kind: string,
    id: string,
    name: string,
    longitude: number,
    latitude: number,
  ) {
    if (touchCard) {
      setHover(name);
      setHoverCard({ id, kind, name, longitude, latitude });
    } else exploreLocation(kind, id);
  }

  function exploreLocation(kind: string, id: string) {
    const parent = registry.municipalities.find((m) => m.id === id)?.provinceId;
    if (national && kind === "municipality" && parent)
      onNavigate("province", parent);
    else onNavigate(kind, id);
  }

  const [hoverCard, setHoverCard] = useState<{
    id: string;
    kind: string;
    name: string;
    longitude: number;
    latitude: number;
  } | null>(null);
  const province = registry.provinces.find((p) => p.id === selection.province),
    municipality = registry.municipalities.find(
      (m) => m.id === selection.municipality,
    ),
    ward = registry.wards.find((w) => w.id === selection.ward),
    district = registry.districts.find((d) => d.id === selection.district);
  const national = !province && !municipality && !ward && !district;
  useEffect(
    () => setHoverCard(null),
    [
      selection.province,
      selection.district,
      selection.municipality,
      selection.ward,
      selection.vd,
    ],
  );
  const mapResults = national ? results?.mapFeatures : results?.features;
  const rawURL = ward
    ? null
    : municipality
      ? `/gis/wards/${municipality.id}.geojson`
      : province
        ? `/gis/municipalities/${province.id}.geojson`
        : "/gis/municipalities.geojson";
  const provinceContext = useJSON<FeatureCollection>(
    national ? "/gis/provinces.geojson" : null,
  );
  const raw = useJSON<FeatureCollection>(rawURL);
  const vd = useJSON<GeometryPacket>(
    ward ? `/api/gis/voting-districts?ward=${ward.id}` : null,
    revision,
  );
  const station = useJSON<GeometryPacket>(
    ward ? `/api/gis/stations?ward=${ward.id}` : null,
    revision,
  );
  const wardContext = useJSON<FeatureCollection>(
    ward && municipality ? `/gis/wards/${municipality.id}.geojson` : null,
  );
  const [outlines, setOutlines] = useState<FeatureCollection | null>(null);
  const [outlineError, setOutlineError] = useState("");
  useEffect(() => {
    setOutlines(null);
    setOutlineError("");
    if (!showDistricts || municipality) return;
    const ac = new AbortController();
    const list = registry.districts.filter(
      (d) => !province || d.provinceId === province.id,
    );
    Promise.all(
      list.map((d) =>
        fetch(`/gis/districts/${d.id}.geojson`, { signal: ac.signal }).then(
          (r) => {
            if (!r.ok) throw Error();
            return r.json();
          },
        ),
      ),
    )
      .then((all) =>
        setOutlines({
          type: "FeatureCollection",
          features: all.flatMap((g) => g.features),
        }),
      )
      .catch((e) => {
        if (e.name !== "AbortError")
          setOutlineError("District outlines could not be loaded.");
      });
    return () => ac.abort();
  }, [showDistricts, province?.id, municipality?.id]);
  const source = ward ? vd.data?.data : raw.data;
  const loading = ward ? vd.loading : raw.loading;
  const error = ward ? vd.error : raw.error;
  const geometry = useMemo<FeatureCollection | null>(() => {
    if (!source) return null;
    return {
      ...source,
      features: source.features
        .filter(
          (f) =>
            !district ||
            municipality ||
            f.properties?.districtId === district.id,
        )
        .map((f) => {
          const r = mapResults?.[String(f.properties?.id)];
          const selectedParty = r?.parties?.find((p) => p.id === focusParty);
          const color = focusParty
            ? r?.available && selectedParty
              ? selectedParty.color
              : "#e1e7ef"
            : !r?.available
              ? "#c6d0de"
              : layer === "reporting"
                ? r.progress === null
                  ? "#c6d0de"
                  : `hsl(216 74% ${88 - r.progress * 0.45}%)`
                : (r.leader?.color ?? "#bbc6d8");
          return {
            ...f,
            properties: {
              ...f.properties,
              color,
              partyOpacity:
                selectedParty && r?.available
                  ? 0.18 +
                    (0.82 * Math.min(100, Math.max(0, selectedParty.share))) /
                      100
                  : 0.55,
              partyLeading: Boolean(focusParty && r?.leader?.id === focusParty),
              available: r?.available ?? false,
              leader:
                r?.leader?.label ?? (r?.tie ? "Tied" : "No published result"),
              progress: r?.progress ?? null,
            },
          };
        }),
    };
  }, [source, mapResults, layer, district?.id, municipality?.id, focusParty]);
  const selectedGeometry = geometry?.features.find(
    (f) => String(f.properties?.id) === selection.vd,
  )?.geometry;
  let stationBounds: Bounds | null = null;
  if (selectedGeometry && "coordinates" in selectedGeometry) {
    const points: number[][] = [];
    const visit = (c: unknown) => {
      if (Array.isArray(c)) {
        if (typeof c[0] === "number") points.push(c as number[]);
        else c.forEach(visit);
      }
    };
    visit(selectedGeometry.coordinates);
    if (points.length)
      stationBounds = [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ];
  }
  const bounds =
    stationBounds ??
    ward?.bounds ??
    municipality?.bounds ??
    district?.bounds ??
    province?.bounds ??
    ([16, -35, 33, -22] as Bounds);
  const labelFeatures = useMemo(
    () =>
      geometry?.features.map((f) => {
        const properties = f.properties ?? {};
        return {
          id: String(properties.id),
          kind: String(properties.kind),
          name: String(properties.name),
          center: (properties.center ??
            pointOnFeature(f).geometry.coordinates) as [number, number],
        };
      }) ?? [],
    [geometry],
  );
  const placeNames = useMemo<PlaceLabel[]>(() => {
    const municipalities = registry.municipalities
      .filter((m) => !province || m.provinceId === province.id)
      .filter((m) => !municipality || m.id === municipality.id)
      .map((m) => ({
        id: m.id,
        name: m.name.replace(/^[A-Z0-9]+ - /, ""),
        kind: "municipality",
        center: m.center,
        priority: m.isMetro ? 0 : national ? 2 : 1,
      }));
    const local = municipality
      ? labelFeatures
          .filter((f) => f.kind === "ward")
          .map((f) => ({ ...f, priority: 3 }))
      : [];
    return [...municipalities, ...local];
  }, [registry, province?.id, municipality?.id, labelFeatures, national]);
  const legend = [
    ...new globalThis.Map(
      Object.values(mapResults ?? {})
        .filter(
          (f) =>
            f.available &&
            f.leader &&
            (!focusParty || f.leader.id === focusParty),
        )
        .map((f) => [f.leader!.id, f.leader!]),
    ).values(),
  ];
  const hoverResult = hoverCard ? mapResults?.[hoverCard.id] : null;
  const hoverProvinceId =
    province?.id ??
    registry.municipalities.find((m) => m.id === hoverCard?.id)?.provinceId;
  const hoverProvince = registry.provinces.find(
    (p) => p.id === hoverProvinceId,
  );
  const provinceData = useJSON<Results>(
    !national && hoverProvinceId
      ? `/api/results?province=${hoverProvinceId}&ballot=${results?.ballot ?? "combined"}`
      : null,
    revision,
    10000,
  );
  const provinceSummary: FeatureResult | null = national
    ? hoverProvinceId
      ? (results?.features[hoverProvinceId] ?? null)
      : null
    : provinceData.data
      ? {
          available: provinceData.data.available,
          validVotes: provinceData.data.validVotes,
          received: 0,
          expected: 0,
          progress: provinceData.data.reporting?.percent ?? null,
          leader: null,
          tie: false,
          parties: provinceData.data.rows.map((p) => ({
            id: p.partyId,
            label: p.label,
            color: p.color,
            votes: p.votes,
            share: p.share,
            logoUrl: p.logoUrl,
          })),
        }
      : null;

  return (
    <div className="gis-map-block">
      <div className="gis-map-canvas">
        <div className="gis-map-caption">
          <span>
            <MapPin size={13} />
            {hover || ward
              ? hover || `Ward ${ward?.number}`
              : (municipality?.name ?? province?.name ?? "South Africa")}
          </span>
          <button onClick={() => setReset((v) => v + 1)}>
            <Crosshair size={14} /> Fit selection
          </button>
        </div>
        {geometry ? (
          <Map
            blank
            theme="light"
            center={[25, -29]}
            zoom={4.6}
            minZoom={3}
            maxZoom={17}
            attributionControl={false}
          >
            <Camera bounds={bounds} reset={reset} />
            <MapControls position="bottom-right" showZoom />
            <MapGeoJSON
              id="official-gis"
              data={geometry}
              promoteId="id"
              interactive
              onClick={(e) =>
                openLocation(
                  String(e.feature.properties?.kind),
                  String(e.feature.properties?.id),
                  String(e.feature.properties?.name),
                  e.longitude,
                  e.latitude,
                )
              }
              onHover={(e) => {
                if (touchCard) return;
                if (!e) {
                  setHover("");
                  setHoverCard(null);
                  return;
                }
                const p = e.feature.properties;
                setHover(String(p?.name ?? ""));
                setHoverCard({
                  id: String(p?.id),
                  kind: String(p?.kind),
                  name: String(p?.name),
                  longitude: e.longitude,
                  latitude: e.latitude,
                });
              }}
              fillPaint={{
                "fill-color": ["get", "color"],
                "fill-opacity": focusParty
                  ? ["get", "partyOpacity"]
                  : national
                    ? 0.88
                    : 0.74,
              }}
              linePaint={{
                "line-color": focusParty
                  ? ["case", ["get", "partyLeading"], "#294c3b", "#fff"]
                  : "#fff",
                "line-width": focusParty
                  ? ["case", ["get", "partyLeading"], 2, 0.6]
                  : national
                    ? [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        3,
                        0.4,
                        6,
                        0.8,
                        10,
                        1.4,
                      ]
                    : 1.4,
              }}
              fillHoverPaint={focusParty ? undefined : { "fill-opacity": 1 }}
            />
            {selection.vd && (
              <MapGeoJSON
                id="selected-vd"
                data={{
                  type: "FeatureCollection",
                  features: geometry.features.filter(
                    (f) => String(f.properties?.id) === selection.vd,
                  ),
                }}
                fillPaint={{ "fill-color": "#2563eb", "fill-opacity": 0.2 }}
                linePaint={{ "line-color": "#163e8c", "line-width": 3 }}
              />
            )}
            {outlines && (
              <MapGeoJSON
                id="district-outlines"
                data={outlines}
                fillPaint={false}
                linePaint={{
                  "line-color": "#263b64",
                  "line-width": 2,
                  "line-dasharray": [3, 2],
                }}
              />
            )}
            {provinceContext.data && (
              <MapGeoJSON
                id="national-province-context"
                data={provinceContext.data}
                fillPaint={false}
                linePaint={{
                  "line-color": "#264168",
                  "line-width": 1.5,
                  "line-opacity": 0.7,
                }}
              />
            )}
            {wardContext.data && ward && (
              <MapGeoJSON
                id="selected-ward-border"
                data={{
                  type: "FeatureCollection",
                  features: wardContext.data.features.filter(
                    (f) => String(f.properties?.id) === ward.id,
                  ),
                }}
                fillPaint={false}
                linePaint={{ "line-color": "#173d78", "line-width": 3 }}
              />
            )}
            {labels && (
              <PlaceNames
                places={placeNames}
                onSelect={(p) =>
                  openLocation(p.kind, p.id, p.name, p.center[0], p.center[1])
                }
              />
            )}
            {hoverCard && !touchCard && (
              <MapPopup
                longitude={hoverCard.longitude}
                latitude={hoverCard.latitude}
                closeButton={false}
                closeOnClick={false}
                focusAfterOpen={false}
                offset={18}
                maxWidth="264px"
                className="gis-hover-popup"
              >
                <div className="gis-hover-card">
                  {hoverProvince && (
                    <HoverResults
                      name={hoverProvince.name}
                      result={provinceSummary}
                      focusParty={focusParty}
                      loading={!national && provinceData.loading}
                    />
                  )}
                  <HoverResults
                    name={hoverCard.name.replace(/^[A-Z0-9]+ - /, "")}
                    result={hoverResult}
                    focusParty={focusParty}
                  />
                </div>
              </MapPopup>
            )}
            {station.data?.data.features.map((f) => {
              const c = (
                f.geometry as { type: "Point"; coordinates: [number, number] }
              ).coordinates;
              return (
                <MapMarker
                  key={String(f.properties?.id)}
                  longitude={c[0]}
                  latitude={c[1]}
                >
                  <MarkerContent>
                    <button
                      className="gis-station-pin"
                      onClick={() =>
                        openLocation(
                          "station",
                          String(f.properties?.id),
                          String(f.properties?.name),
                          c[0],
                          c[1],
                        )
                      }
                      title={String(f.properties?.name)}
                      aria-label={`Station ${f.properties?.name}`}
                    >
                      <MapPin size={18} />
                    </button>
                  </MarkerContent>
                </MapMarker>
              );
            })}
          </Map>
        ) : (
          <div className="gis-map-loading" role="status">
            {loading ? (
              <RefreshCw size={24} className="spin" />
            ) : (
              <MapPin size={24} />
            )}
            <span>{error || "Loading electoral boundaries…"}</span>
            {error && (
              <button
                className="button secondary"
                onClick={() =>
                  document
                    .querySelector(".gis-place-list")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Use the list below
              </button>
            )}
          </div>
        )}
        {touchCard && hoverCard && (
          <div
            className="gis-touch-card"
            role="region"
            aria-label={`${hoverCard.name} results`}
          >
            <button
              className="gis-touch-close"
              aria-label="Close location results"
              onClick={() => {
                setHoverCard(null);
                setHover("");
              }}
            >
              <X size={16} />
            </button>
            <div className="gis-touch-card-body">
              {hoverProvince && (
                <HoverResults
                  name={hoverProvince.name}
                  result={provinceSummary}
                  focusParty={focusParty}
                  loading={!national && provinceData.loading}
                />
              )}
              <HoverResults
                name={hoverCard.name.replace(/^[A-Z0-9]+ - /, "")}
                result={hoverResult}
                focusParty={focusParty}
              />
            </div>
            <div className="gis-touch-card-actions">
              <button
                className="gis-touch-explore"
                onClick={() => exploreLocation(hoverCard.kind, hoverCard.id)}
              >
                View{" "}
                {national
                  ? "province"
                  : hoverCard.kind === "municipality"
                    ? "municipality"
                    : hoverCard.kind === "station"
                      ? "voting district"
                      : hoverCard.kind}{" "}
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}
        {geometry && loading && (
          <span className="gis-map-refresh">Refreshing boundaries…</span>
        )}
      </div>
      <div className="gis-map-key">
        <strong>
          {layer === "leader"
            ? "Leading published party"
            : "Publication / reporting coverage"}
        </strong>
        {layer === "leader" ? (
          legend.map((p) => (
            <span key={p.id}>
              <i style={{ background: p.color }} />
              {p.label}
            </span>
          ))
        ) : (
          <span className="gis-scale-key">
            0% <i /> 100%
          </span>
        )}
        {focusParty && (
          <span className="gis-party-strength-key">
            Light to dark: 0-100% vote share; outlined: leading
          </span>
        )}
        <span>
          <i style={{ background: "#c6d0de" }} />{" "}
          {focusParty
            ? "Party result unavailable"
            : "No result / unavailable / tie"}
        </span>
      </div>
      {national && (
        <p className="gis-national-note">
          National view: all 213 cities and municipalities. Each area uses its
          own published result; darker outlines show provinces. Click an area to
          explore its wards.
          {results?.mapCoverage &&
            ` ${results.mapCoverage.leading} municipalities have a published leader for this ballot.`}
        </p>
      )}
      {vd.data?.data.coverage?.missing.length ? (
        <p className="gis-inline-notice" role="status">
          Voting-district boundaries available: {vd.data.data.coverage.matched}{" "}
          / {vd.data.data.coverage.expected}. Missing boundaries remain
          accessible in the location list.
        </p>
      ) : null}
      {(error || vd.data?.stale || station.error || outlineError) && (
        <p className="gis-inline-notice" role="status">
          {error || vd.data?.error || station.error || outlineError} Boundary
          and result timestamps may differ. The results list remains available.
        </p>
      )}
    </div>
  );
}

function HoverResults({
  name,
  result,
  loading = false,
  focusParty,
}: {
  name: string;
  result: FeatureResult | null | undefined;
  loading?: boolean;
  focusParty?: string | null;
}) {
  const progress = result?.progress;
  const party = result?.parties?.find((p) => p.id === focusParty);
  const displayed = focusParty
    ? party
      ? [party]
      : []
    : [...(result?.parties ?? [])]
        .sort((a, b) => b.share - a.share)
        .slice(0, 3);
  return (
    <section className="gis-hover-section">
      <div className="gis-hover-heading">
        <h4>{name}</h4>
        <div
          className="gis-hover-ring"
          role={progress != null ? "progressbar" : undefined}
          aria-label={`${name} reporting${progress == null ? " unavailable" : ""}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            progress != null ? Math.min(100, Math.max(0, progress)) : undefined
          }
          title={
            progress != null
              ? `${progress.toFixed(0)}% reporting`
              : "Reporting unavailable"
          }
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle className="gis-hover-ring-track" cx="20" cy="20" r="17" />
            <circle
              className="gis-hover-ring-fill"
              cx="20"
              cy="20"
              r="17"
              pathLength="100"
              strokeDasharray={`${Math.min(100, Math.max(0, progress ?? 0))} 100`}
            />
          </svg>
          <span>{progress != null ? `${Math.round(progress)}%` : "?"}</span>
        </div>
      </div>
      {focusParty && party && result?.available && (
        <div className="gis-party-hover-stats">
          <strong>{party.votes.toLocaleString("en-ZA")} votes</strong>
          <span>
            {party.votes === 0
              ? "No votes published"
              : result.leader?.id === focusParty
                ? "Leading"
                : result.tie
                  ? "Tied lead / partial result"
                  : "Not leading"}
          </span>
        </div>
      )}
      {result?.available && displayed.length ? (
        <div className="gis-hover-parties">
          {displayed.map((p) => (
            <div key={p.id}>
              <i style={{ background: p.color }} />
              {p.logoUrl && (
                <img
                  src={p.logoUrl}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <span title={p.label}>{p.label}</span>
              <strong>{p.share.toFixed(2)}%</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>
          {focusParty && !loading
            ? "Party result unavailable in published summary."
            : loading
              ? "Loading results?"
              : "No published party results."}
        </p>
      )}
    </section>
  );
}
