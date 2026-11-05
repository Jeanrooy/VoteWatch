import { retainUnchangedFields } from "./lib/refresh-data";
import { useEffect, useState } from "react";
export type LiveRow = {
  id: string;
  label: string;
  name: string;
  color: string;
  votes: number;
  share: number;
  seats: number | null;
};
export type LiveRegion = {
  votes: number;
  rows: LiveRow[];
  counted: number | null;
  all: number | null;
  progress: number | null;
  reportDate: string;
  registered: number | null;
  ballot: string;
  sourcePartyCount: number;
};
export type LiveSnapshot = {
  eventId: number;
  year: number;
  url: string;
  fetchedAt: string;
  reportDate: string;
  stale: boolean;
  error: string | null;
  national: LiveRegion;
  regions: Record<string, LiveRegion>;
};
export function useLiveResults() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let inFlight = false;
    async function get(background = false) {
      if (inFlight) return;
      inFlight = true;
      if (!background) setLoading(true);
      try {
        const r = await fetch("/api/live", { signal: controller.signal });
        const body = await r.json();
        if (!r.ok) throw Error(body.error ?? "Results unavailable.");
        if (body.eventId !== 1887 || !body.regions || !body.national)
          throw Error("Unexpected live response.");
        if (active) {
          setSnapshot((previous) => retainUnchangedFields(previous, body));
          setError(body.stale ? (body.error ?? "Retained snapshot") : "");
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Live results unavailable.",
          );
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    void get();
    const timer = setInterval(() => void get(true), 10000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [version]);
  return { snapshot, error, loading, refresh: () => setVersion((v) => v + 1) };
}
export const sourceTime = (value: string) =>
  new Date(value).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " SAST";
