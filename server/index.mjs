import express from "express";
import { PublicSource } from "./public-source.mjs";
import { normalizeLive } from "./live-results.mjs";
import { GISService } from "./gis-service.mjs";
import { partyLogo } from "./party-assets.mjs";
import { CouncilService } from "./council-service.mjs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const app = express();
app.disable("x-powered-by");
const source = new PublicSource();
const gis = new GISService(source);
const councils = new CouncilService(source);
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  next();
});
app.get("/api/status", (_req, res) =>
  res.json({
    configured: false,
    eventId: source.events?.["2026"] ?? null,
    mode: "public-files",
    message:
      "Credential-free IEC dashboard JSON connector. National snapshots refresh every five minutes. Detailed files load on demand.",
    lastSuccess: source.lastSuccess,
    lastError: source.lastError,
  }),
);
app.get("/api/public", async (req, res) => {
  try {
    const allowed = new Set(["year", "kind", "id"]);
    if (
      Object.keys(req.query).some((k) => !allowed.has(k)) ||
      Object.values(req.query).some((v) => typeof v !== "string")
    )
      return res.status(400).json({ error: "Invalid query." });
    const result = await source.get(
      req.query.year ?? "2026",
      req.query.kind ?? "national",
      req.query.id,
    );
    res.set("Cache-Control", "no-store").json(result);
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message, stale: false });
  }
});
app.get("/api/live", async (_req, res) => {
  try {
    const packet = await source.get("2026", "national");
    let dictionary = [];
    try {
      dictionary = (await source.get("2026", "parties")).data;
    } catch {}
    res
      .set("Cache-Control", "no-store")
      .json(normalizeLive(packet, dictionary));
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message });
  }
});
app.get("/api/results", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await gis.results(req.query));
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message });
  }
});
app.get("/api/councils", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await councils.get(req.query));
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message });
  }
});
for (const [path, method] of [
  ["voting-districts", "votingGeometry"],
  ["stations", "stations"],
])
  app.get(`/api/gis/${path}`, async (req, res) => {
    try {
      if (
        Object.keys(req.query).length !== 1 ||
        typeof req.query.ward !== "string" ||
        !/^\d{8}$/.test(req.query.ward)
      )
        return res.status(400).json({ error: "A valid ward is required." });
      res
        .set("Cache-Control", "no-store")
        .json(await gis[method](req.query.ward));
    } catch (e) {
      res.status(e.status ?? 502).json({ error: e.message });
    }
  });
app.get("/api/party-logo/:id", async (req, res) => {
  try {
    const image = await partyLogo(req.params.id, source);
    res
      .set("Content-Type", image.mime)
      .set("Cache-Control", "public, max-age=86400")
      .send(image.buffer);
  } catch (e) {
    res.status(e.status ?? 404).end();
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown endpoint." }),
);
if (existsSync("dist/index.html")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
const poll = () =>
  source
    .get("2026", "national")
    .catch((e) => console.warn(`IEC public source: ${e.message}`));
const timer = setInterval(poll, 300000);
timer.unref();
app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1", () => {
  console.log(
    "Election Observer API: http://127.0.0.1:3001 (public IEC JSON, no credentials)",
  );
  void poll();
});
