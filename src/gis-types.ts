import { retainUnchangedFields } from "./lib/refresh-data";
import { useEffect, useState } from "react";
export type Bounds = [number, number, number, number];
export type Province = {
  id: string;
  name: string;
  bounds: Bounds;
  center: [number, number];
};
export type Municipality = Province & {
  code: string;
  provinceId: string;
  districtId: string;
  districtCode: string;
  districtName: string;
  isMetro: boolean;
};
export type Ward = {
  id: string;
  number: number;
  municipalityId: string;
  provinceId: string;
  bounds: Bounds;
  center: [number, number];
};
export type District = Province & { provinceId: string; code: string };
export type Registry = {
  year: number;
  eventId: number;
  provinces: Province[];
  municipalities: Municipality[];
  wards: Ward[];
  districts: District[];
  votingDistricts: Record<string, string>;
};
export type Selection = {
  province?: string;
  district?: string;
  municipality?: string;
  ward?: string;
  vd?: string;
};
export type BallotMode = "combined" | "ward" | "pr" | "district";
export type FeatureResult = {
  available: boolean;
  validVotes: number;
  received: number;
  expected: number;
  progress: number | null;
  leader: { id: string; label: string; color: string; share: number } | null;
  tie: boolean;
  parties?: {
    id: string;
    label: string;
    color: string;
    votes: number;
    share: number;
    logoUrl: string | null;
  }[];
  stationName?: string | null;
};
export type ResultRow = {
  partyId: string;
  partyName: string;
  label: string;
  color: string;
  logoUrl: string | null;
  votes: number;
  share: number;
  candidate?: string | null;
};
export type Results = {
  level: string;
  id: string;
  label: string;
  ballot: BallotMode;
  applicable: boolean;
  available: boolean;
  reason?: string;
  validVotes: number;
  spoilt: number | null;
  registered: number | null;
  ballotsCast: number | null;
  rows: ResultRow[];
  features: Record<string, FeatureResult>;
  mapFeatures?: Record<string, FeatureResult>;
  mapCoverage?: { expected: number; published: number; leading: number };
  reporting?: {
    received: number | null;
    expected: number | null;
    percent: number | null;
    definition: string;
  };
  source?: {
    url: string;
    urls?: string[];
    reportDate: string | null;
    reportDates?: string[];
    fetchedAt: string;
    stale: boolean;
    error?: string | null;
  };
  station?: { name: string | null };
  coverage?: {
    sourcesAvailable: number;
    sourcesExpected: number;
    failures: { municipality: string; error: string }[];
  };
  warnings: string[];
};
export function useJSON<T>(url: string | null, version = 0, interval = 0) {
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ url: null, data: null, error: "", loading: Boolean(url) });
  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    let active = true;
    let inFlight = false;
    async function get(background = false) {
      if (inFlight) return;
      inFlight = true;
      if (!background)
        setState((s) =>
          s.url === url
            ? { ...s, loading: true }
            : { url, data: null, error: "", loading: true },
        );
      try {
        const r = await fetch(url!, {
          signal: ac.signal,
          cache: interval ? "no-store" : "default",
        });
        if (!r.ok) {
          let error = `Request failed (${r.status})`;
          try {
            error = (await r.json()).error ?? error;
          } catch {}
          throw Error(error);
        }
        const data = (await r.json()) as T;
        if (active)
          setState((s) => ({
            url,
            data: retainUnchangedFields(s.url === url ? s.data : null, data),
            error: "",
            loading: false,
          }));
      } catch (e) {
        if (active && !ac.signal.aborted)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : "Data unavailable",
            loading: false,
          }));
      } finally {
        inFlight = false;
      }
    }
    void get();
    const timer = interval ? setInterval(() => void get(true), interval) : null;
    return () => {
      active = false;
      ac.abort();
      if (timer) clearInterval(timer);
    };
  }, [url, version, interval]);
  return state.url === url
    ? state
    : { url, data: null, error: "", loading: Boolean(url) };
}
export function queryFor(selection: Selection, ballot: BallotMode) {
  const q = new URLSearchParams({ ballot });
  for (const [k, v] of Object.entries(selection)) if (v) q.set(k, v);
  return q.toString();
}
export function readSelection(): Selection {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(
    ["province", "district", "municipality", "ward", "vd"]
      .map((k) => [k, p.get(k)])
      .filter(([, v]) => v),
  ) as Selection;
}
