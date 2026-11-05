import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  ChevronRight,
  Expand,
  Focus,
  Info,
  Layers3,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Vote,
} from "lucide-react";
import { number, provinces } from "./data";
import { useLiveResults, sourceTime, type LiveRegion } from "./useLiveResults";
import "./world.css";

type Mode = "votes" | "reporting" | "parties";
type View = "perspective" | "top";
type SceneProps = {
  results: Record<string, LiveRegion>;
  maxVotes: number;
  mode: Mode;
  selected: string;
  separation: number;
  rotate: boolean;
  view: View;
  reset: number;
  onSelect: (id: string) => void;
  onHover: (id: string) => void;
};
const project = (lng: number, lat: number) =>
  new THREE.Vector2((lng - 25) * 0.88, lat + 29);

function label(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '500 32px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillStyle = "#dce9ff";
  ctx.shadowColor = "#020817";
  ctx.shadowBlur = 9;
  ctx.fillText(text, 256, 56);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(3.1, 0.58, 1);
  sprite.renderOrder = 8;
  return sprite;
}
function WorldScene(props: SceneProps) {
  const mount = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const host = mount.current!;
    const ac = new AbortController();
    let disposed = false;
    let cleanup = () => {};
    async function init() {
      try {
        const response = await fetch("/provinces.geojson", {
          signal: ac.signal,
        });
        if (!response.ok)
          throw Error("Province boundaries could not be loaded.");
        const geo = (await response.json()) as FeatureCollection<
          Polygon | MultiPolygon
        >;
        if (disposed) return;
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.setClearColor("#070d1b");
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
        host.appendChild(renderer.domElement);
        renderer.domElement.setAttribute(
          "aria-label",
          "Interactive 3D South African election landscape. Use the province buttons for keyboard navigation.",
        );
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2("#070d1b", 0.018);
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
        camera.position.set(13, 17, 21);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.minDistance = 10;
        controls.maxDistance = 39;
        controls.maxPolarAngle = Math.PI * 0.47;
        controls.minPolarAngle = 0.05;
        controls.target.set(0, 0.5, 0);
        controls.autoRotateSpeed = 0.5;
        controls.enablePan = true;
        scene.add(new THREE.HemisphereLight("#a9caff", "#15233d", 2.4));
        const key = new THREE.DirectionalLight("#d5e8ff", 3.5);
        key.position.set(-8, 18, 12);
        scene.add(key);
        const rim = new THREE.PointLight("#2e78ff", 65, 45);
        rim.position.set(8, 5, -9);
        scene.add(rim);
        const floor = new THREE.Mesh(
          new THREE.CylinderGeometry(12, 12.3, 0.22, 96),
          new THREE.MeshStandardMaterial({
            color: "#101e35",
            metalness: 0.45,
            roughness: 0.58,
          }),
        );
        floor.position.y = -0.55;
        scene.add(floor);
        const grid = new THREE.GridHelper(29, 58, "#24416a", "#152640");
        grid.position.y = -0.39;
        scene.add(grid);
        for (const radius of [8, 10, 12]) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, 0.012, 5, 160),
            new THREE.MeshBasicMaterial({
              color: radius === 12 ? "#3c79c0" : "#243e63",
              transparent: true,
              opacity: 0.65,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = -0.405;
          scene.add(ring);
        }
        const dustPositions = new Float32Array(180 * 3);
        for (let i = 0; i < 180; i++) {
          dustPositions[i * 3] = Math.sin(i * 127.1) * 35;
          dustPositions[i * 3 + 1] = 3 + (i % 23) * 0.7;
          dustPositions[i * 3 + 2] = Math.cos(i * 83.7) * 35;
        }
        const dustGeometry = new THREE.BufferGeometry();
        dustGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(dustPositions, 3),
        );
        scene.add(
          new THREE.Points(
            dustGeometry,
            new THREE.PointsMaterial({
              color: "#5272a8",
              size: 0.035,
              transparent: true,
              opacity: 0.55,
            }),
          ),
        );
        const pickables: THREE.Object3D[] = [];
        const objects: {
          id: string;
          group: THREE.Group;
          plate: THREE.Mesh;
          mat: THREE.MeshStandardMaterial;
          outline: THREE.LineSegments;
          bars: THREE.Group;
          sprite: THREE.Sprite;
          offset: THREE.Vector3;
        }[] = [];
        for (const feature of geo.features) {
          const id = String(feature.properties?.shapeISO);
          const province = provinces.find((p) => p.id === id);
          if (!province) continue;
          const f = current.current.results[id];
          if (!f) continue;
          const polygons =
            feature.geometry.type === "Polygon"
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates;
          const shapes = polygons
            .filter((p) => p[0].length >= 4)
            .map((poly) => {
              const points = poly[0].map((p) => project(p[0], p[1]));
              const shape = new THREE.Shape(points);
              for (const hole of poly.slice(1))
                shape.holes.push(
                  new THREE.Path(hole.map((p) => project(p[0], p[1]))),
                );
              return shape;
            });
          const geometry = new THREE.ExtrudeGeometry(shapes, {
            depth: 1,
            bevelEnabled: false,
            steps: 1,
            curveSegments: 1,
          });
          geometry.rotateX(-Math.PI / 2);
          const material = new THREE.MeshStandardMaterial({
            color: f.rows[0]?.color ?? "#263e63",
            roughness: 0.5,
            metalness: 0.22,
            emissive: "#162b49",
            emissiveIntensity: 0.15,
          });
          const plate = new THREE.Mesh(geometry, material);
          plate.userData.id = id;
          const group = new THREE.Group();
          group.add(plate);
          pickables.push(plate);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 25),
            new THREE.LineBasicMaterial({
              color: "#b9d8ff",
              transparent: true,
              opacity: 0.48,
            }),
          );
          group.add(edges);
          const center = project(...province.center);
          const bars = new THREE.Group();
          bars.position.set(center.x, 0, -center.y);
          for (let i = 0; i < 4; i++) {
            const bar = new THREE.Mesh(
              new THREE.BoxGeometry(0.22, 1, 0.22),
              new THREE.MeshStandardMaterial({
                color: "#8198bd",
                metalness: 0.25,
                roughness: 0.32,
                emissive: "#8198bd",
                emissiveIntensity: 0.12,
              }),
            );
            bar.position.set((i - 1.5) * 0.31, 0.5, 0);
            bar.userData.id = id;
            bars.add(bar);
            pickables.push(bar);
          }
          group.add(bars);
          const sprite = label(province.name);
          sprite.position.set(center.x, 1, -center.y);
          group.add(sprite);
          const offset = new THREE.Vector3(
            center.x * 0.14,
            0,
            -center.y * 0.14,
          );
          scene.add(group);
          objects.push({
            id,
            group,
            plate,
            mat: material,
            outline: edges,
            bars,
            sprite,
            offset,
          });
        }
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let hovered = "";
        let down = { x: 0, y: 0 };
        const pick = (e: PointerEvent) => {
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(mouse, camera);
          return (
            raycaster
              .intersectObjects(pickables, false)
              .find((hit) => hit.object.visible && hit.object.parent?.visible)
              ?.object.userData.id ?? ""
          );
        };
        const move = (e: PointerEvent) => {
          const id = pick(e);
          if (id !== hovered) {
            hovered = id;
            current.current.onHover(id);
            renderer.domElement.style.cursor = id ? "pointer" : "grab";
          }
        };
        const leave = () => {
          hovered = "";
          current.current.onHover("");
        };
        const pointerDown = (e: PointerEvent) => {
          down = { x: e.clientX, y: e.clientY };
        };
        const up = (e: PointerEvent) => {
          if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
          const id = pick(e);
          if (id) current.current.onSelect(id);
        };
        renderer.domElement.addEventListener("pointermove", move);
        renderer.domElement.addEventListener("pointerleave", leave);
        renderer.domElement.addEventListener("pointerdown", pointerDown);
        renderer.domElement.addEventListener("pointerup", up);
        const resize = () => {
          const width = host.clientWidth,
            height = host.clientHeight;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        let lastView: View = "perspective";
        let lastReset = 0;
        let cameraDestination: THREE.Vector3 | null = null;
        let lastTime = 0;
        renderer.setAnimationLoop((time) => {
          if (disposed || document.hidden) return;
          const dt = Math.min((time - lastTime) / 1000, 0.05);
          lastTime = time;
          const p = current.current;
          controls.autoRotate = p.rotate && !reduced;
          if (p.view !== lastView || p.reset !== lastReset) {
            cameraDestination =
              p.view === "top"
                ? new THREE.Vector3(0, 29, 0.1)
                : new THREE.Vector3(13, 17, 21);
            controls.target.set(0, 0.5, 0);
            lastView = p.view;
            lastReset = p.reset;
          }
          if (cameraDestination) {
            camera.position.lerp(
              cameraDestination,
              reduced ? 1 : Math.min(1, dt * 5),
            );
            if (camera.position.distanceTo(cameraDestination) < 0.03)
              cameraDestination = null;
          }
          for (const o of objects) {
            const f = p.results[o.id];
            if (!f) continue;
            const h =
              p.mode === "votes"
                ? 0.2 + (f.votes / p.maxVotes) * 3.8
                : p.mode === "reporting"
                  ? 0.2 + ((f.progress ?? 0) / 100) * 3.8
                  : 0.22;
            const speed = reduced ? 1 : Math.min(1, dt * 7);
            o.plate.scale.y = THREE.MathUtils.lerp(o.plate.scale.y, h, speed);
            o.outline.scale.y = o.plate.scale.y;
            o.group.position.lerp(
              o.offset.clone().multiplyScalar(p.separation),
              speed,
            );
            const isSelected = o.id === p.selected;
            const isHover = o.id === hovered;
            o.group.position.y = THREE.MathUtils.lerp(
              o.group.position.y,
              isSelected ? 0.28 : 0,
              speed,
            );
            o.mat.color.set(
              p.mode === "reporting"
                ? "#3588f6"
                : p.mode === "parties"
                  ? "#263e63"
                  : (f.rows[0]?.color ?? "#263e63"),
            );
            o.mat.emissive.set(
              isSelected ? "#2e78ff" : isHover ? "#6d8ba9" : "#14243d",
            );
            o.mat.emissiveIntensity = isSelected ? 0.55 : isHover ? 0.3 : 0.12;
            o.bars.visible = p.mode === "parties";
            o.bars.position.y = 0.27;
            const top = f.rows.filter((r) => r.id !== "OTHER").slice(0, 3);
            const remainder = Math.max(
              0,
              f.votes - top.reduce((sum, r) => sum + r.votes, 0),
            );
            const barRows = [...top, { votes: remainder, color: "#8c9dba" }];
            o.bars.children.forEach((bar, i) => {
              const mesh = bar as THREE.Mesh<
                THREE.BoxGeometry,
                THREE.MeshStandardMaterial
              >;
              const row = barRows[i];
              const target = row && f.votes ? (row.votes / f.votes) * 5 : 0;
              mesh.scale.y = THREE.MathUtils.lerp(
                mesh.scale.y,
                Math.max(0.001, target),
                speed,
              );
              mesh.position.y = mesh.scale.y / 2;
              mesh.material.color.set(row?.color ?? "#8198bd");
              mesh.material.emissive.set(row?.color ?? "#8198bd");
            });
            o.sprite.position.y =
              p.mode === "parties" ? 3.8 : o.plate.scale.y + 0.4;
          }
          controls.update();
          renderer.render(scene, camera);
        });
        cleanup = () => {
          observer.disconnect();
          renderer.setAnimationLoop(null);
          controls.dispose();
          renderer.domElement.removeEventListener("pointermove", move);
          renderer.domElement.removeEventListener("pointerleave", leave);
          renderer.domElement.removeEventListener("pointerdown", pointerDown);
          renderer.domElement.removeEventListener("pointerup", up);
          scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
              for (const mat of Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]) {
                const texture = (mat as THREE.SpriteMaterial).map;
                if (texture) texture.dispose();
                mat.dispose();
              }
            }
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
        setLoading(false);
      } catch (e) {
        if (!disposed) {
          setError(
            e instanceof Error ? e.message : "3D rendering unavailable.",
          );
          setLoading(false);
        }
      }
    }
    void init();
    return () => {
      disposed = true;
      ac.abort();
      cleanup();
    };
  }, []);
  return (
    <div className="world-canvas" ref={mount}>
      {loading && (
        <div className="world-loading">
          <Box size={30} />
          <span>Building your election landscape…</span>
        </div>
      )}
      {error && (
        <div className="world-loading">
          <Info size={28} />
          <strong>3D view unavailable</strong>
          <span>
            {error} Use the province selector and results panel to explore the
            same data.
          </span>
          <a href="/">Open standard dashboard</a>
        </div>
      )}
    </div>
  );
}
export default function ElectionWorld() {
  const [selected, setSelected] = useState("GT");
  const [hover, setHover] = useState("");
  const [mode, setMode] = useState<Mode>("votes");
  const [separation, setSeparation] = useState(0.25);
  const [rotate, setRotate] = useState(false);
  const [view, setView] = useState<View>("perspective");
  const [reset, setReset] = useState(0);
  const [about, setAbout] = useState(false);
  const { snapshot, error, loading, refresh } = useLiveResults();
  const province = provinces.find((p) => p.id === selected)!;
  const data = snapshot?.regions[selected];
  const total = snapshot?.national;
  const maxVotes = Math.max(
    1,
    ...Object.values(snapshot?.regions ?? {}).map((r) => r.votes),
  );
  if (!snapshot || !data || !total)
    return (
      <div className="world-app">
        <div className="world-loading">
          <Box size={30} />
          <h2>
            {loading
              ? "Loading published IEC results?"
              : "Live results unavailable"}
          </h2>
          <span>
            {error ||
              "Fetching the current 2026 national snapshot. No preview figures are substituted."}
          </span>
          <button className="button" onClick={refresh}>
            Retry
          </button>
          <a href="/">Standard dashboard</a>
        </div>
      </div>
    );
  const modes: [Mode, string, string][] = [
    ["votes", "Vote landscape", "Province height = valid votes"],
    ["reporting", "The count rises", "Province height = reporting %"],
    ["parties", "Party skylines", "Tower height = party vote share"],
  ];
  const currentMode = modes.find((m) => m[0] === mode)!;
  const hovered = provinces.find((p) => p.id === hover);
  return (
    <div className="world-app">
      <header className="world-header">
        <a className="world-brand" href="/">
          <span>
            <Vote size={23} />
          </span>
          election<span>observer</span>
          <b>LAB / 03</b>
        </a>
        <div className="world-header-center">
          <i /> SOUTH AFRICA <span>/</span> LOCAL ELECTIONS 2026
        </div>
        <a className="world-back" href="/">
          <ArrowLeft size={14} /> Standard dashboard
        </a>
      </header>
      <main className="world-main">
        <div className="world-intro">
          <div>
            <span className="world-eyebrow">
              A DIFFERENT DIMENSION OF DEMOCRACY
            </span>
            <h1>
              See the vote.
              <br />
              <em>Feel the scale.</em>
            </h1>
            <p>
              Nine provinces. Millions of voices.
              <br />
              Explore the election as a living landscape.
            </p>
          </div>
          <span className="world-preview">
            <i />{" "}
            {error || snapshot.stale
              ? "RETAINED IEC SNAPSHOT"
              : "PUBLISHED IEC RESULTS ? UPDATING"}
          </span>
        </div>
        <div className="world-layout">
          <section className="world-stage" aria-label="3D election explorer">
            <WorldScene
              results={snapshot.regions}
              maxVotes={maxVotes}
              mode={mode}
              selected={selected}
              separation={separation}
              rotate={rotate}
              view={view}
              reset={reset}
              onSelect={setSelected}
              onHover={setHover}
            />
            <div className="world-scene-caption">
              <span>01 — ELECTION LANDSCAPE</span>
              <strong>{hovered?.name ?? "South Africa"}</strong>
              <small>
                {hovered
                  ? "Click to inspect province"
                  : "Drag to orbit · Scroll to zoom"}
              </small>
            </div>
            <div className="world-scene-tools">
              <button
                aria-label="Reset camera"
                title="Reset camera"
                onClick={() => {
                  setView("perspective");
                  setReset((v) => v + 1);
                }}
              >
                <RotateCcw size={17} />
              </button>
              <button
                aria-label="Toggle top-down view"
                title="Toggle top-down view"
                aria-pressed={view === "top"}
                onClick={() => setView(view === "top" ? "perspective" : "top")}
              >
                <Focus size={18} />
              </button>
              <button
                aria-label={rotate ? "Pause rotation" : "Rotate landscape"}
                title={rotate ? "Pause rotation" : "Rotate landscape"}
                aria-pressed={rotate}
                onClick={() => setRotate(!rotate)}
              >
                {rotate ? <Pause size={17} /> : <Play size={17} />}
              </button>
            </div>
            <div className="world-scale">
              <span>
                {mode === "parties"
                  ? "VOTE SHARE"
                  : mode === "reporting"
                    ? "REPORTING"
                    : "VALID VOTES"}
              </span>
              <div>
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <small>
                0{" "}
                {mode === "parties"
                  ? "→ 100%"
                  : mode === "reporting"
                    ? "→ 100%"
                    : `→ ${(maxVotes / 1e6).toFixed(2)}m`}
              </small>
            </div>
            <div className="world-stage-bottom">
              <div className="world-encoding">
                <span className="world-live-dot" />
                <div>
                  <strong>{currentMode[1]}</strong>
                  <small>{currentMode[2]} · Linear scale</small>
                </div>
              </div>
              <button onClick={() => setAbout(!about)} aria-expanded={about}>
                <Info size={16} /> Reading this world
              </button>
            </div>
          </section>
          <aside className="world-inspector">
            <div className="world-panel-kicker">
              <span>PROVINCE IN FOCUS</span>
              <span>{province.id} / ZA</span>
            </div>
            <div className="world-province-title">
              <h2>{province.name}</h2>
              <span>
                <MousePointer2 size={18} />
              </span>
            </div>
            <label className="world-select-label">
              Explore a province
              <select
                aria-label="Select province in 3D"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {provinces.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="world-vote-total">
              <span>VALID VOTES · MUNICIPAL PR</span>
              <strong>{number(data.votes)}</strong>
              <small>Source: {sourceTime(data.reportDate)}</small>
            </div>
            <div className="world-count">
              <div>
                <span>Voting districts reporting</span>
                <strong>
                  {data.progress === null ? "?" : data.progress.toFixed(0)}%
                </strong>
              </div>
              <div className="world-progress">
                <i style={{ width: `${data.progress ?? 0}%` }} />
              </div>
              <small>
                {number(data.counted ?? 0)} of {number(data.all ?? 0)} voting
                districts
              </small>
            </div>
            <div className="world-party-heading">
              <span>PARTY BREAKDOWN</span>
              <span>VOTE SHARE</span>
            </div>
            <div className="world-party-list">
              {data.rows.map((p, i) => (
                <div className="world-party" key={p.id}>
                  <i style={{ background: p.color }} />
                  <div>
                    <strong>
                      {p.label}
                      {i === 0 && p.id !== "OTHER" && p.votes > 0 && (
                        <b>LEADING</b>
                      )}
                    </strong>
                    <span>{p.name}</span>
                    <div className="world-party-track">
                      <i
                        style={{ width: `${p.share}%`, background: p.color }}
                      />
                    </div>
                  </div>
                  <strong>
                    {p.share.toFixed(2)}
                    <small>%</small>
                  </strong>
                </div>
              ))}
            </div>
            <a
              className="world-detail-link"
              href={`/?view=official&province=${({ EC: 1, FS: 2, GT: 3, KZ: 4, MP: 5, NC: 6, LI: 7, NW: 8, WC: 9 } as Record<string, number>)[selected]}`}
            >
              Explore wards & municipalities <ArrowUpRight size={16} />
            </a>
          </aside>
        </div>
        <section className="world-controls" aria-label="Landscape settings">
          <div className="world-mode-tabs">
            {modes.map(([id, title], i) => (
              <button
                key={id}
                className={mode === id ? "active" : ""}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
              >
                <span>0{i + 1}</span>
                <strong>{title}</strong>
                {mode === id && <i />}
              </button>
            ))}
          </div>
          <label className="world-explode">
            <Layers3 size={16} />
            <span>Separate provinces</span>
            <input
              aria-label="Separate provinces"
              type="range"
              min="0"
              max="2"
              step=".05"
              value={separation}
              onChange={(e) => setSeparation(Number(e.target.value))}
            />
            <small>{((separation / 2) * 100).toFixed(2)}%</small>
          </label>
        </section>
        {about && (
          <div className="world-explanation">
            <Info size={20} />
            <div>
              <h3>One map. Three ways to see the same data.</h3>
              <p>
                Vote landscape uses a common linear height scale for the IEC
                published combined-ballot valid votes. The count rises maps
                0–100% reporting to a common height; reporting is not votes
                counted. Party skylines place four towers (top three parties and
                all remaining parties combined) at each province’s
                representative point, with the same 0–100% share scale. Province
                surface area represents geography, so compare height rather than
                3D volume. Separating provinces moves them for inspection, not
                to indicate a geographical change.
              </p>
              <p>
                Results are read from the IEC public national file. This is
                partial reporting, not final results. Combined ballot votes are
                not unique voters. The polygons are geoBoundaries province
                shapes, not official 2026 ward boundaries. Auto-rotation is off
                by default; reduced-motion preferences suppress automatic
                movement.
              </p>
            </div>
            <button
              aria-label="Close explanation"
              onClick={() => setAbout(false)}
            >
              ×
            </button>
          </div>
        )}
        <div className="world-bottom">
          <div className="world-national">
            <span>NATIONAL RESULTS</span>
            <strong>
              {(total.votes / 1e6).toFixed(2)}m <small>valid votes</small>
            </strong>
            <div />
            <strong>
              9 <small>provinces</small>
            </strong>
            <div />
            <strong>
              04 NOV <small>election day</small>
            </strong>
          </div>
          <div className="world-legend">
            {total.rows.slice(0, 6).map((p) => (
              <span key={p.id}>
                <i style={{ background: p.color }} />
                {p.label}
              </span>
            ))}
          </div>
        </div>
        <div className="world-source-status" role="status">
          <span>
            {error
              ? `Refresh issue: ${error} ? Showing last successful data`
              : `Source generated ${sourceTime(snapshot.reportDate)}`}{" "}
            ? Retrieved {sourceTime(snapshot.fetchedAt)} ? Refresh checks every
            minute; upstream cache 5 minutes.
          </span>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Checking?" : "Check updates"}
          </button>
          <a href={snapshot.url} target="_blank" rel="noreferrer">
            Original JSON ?
          </a>
        </div>
        <footer className="world-footer">
          <span>
            INDEPENDENT EXPLORATION <span>/</span> NOT AN OFFICIAL IEC PRODUCT
          </span>
          <span>
            Boundaries:{" "}
            <a
              href="https://www.geoboundaries.org/"
              target="_blank"
              rel="noreferrer"
            >
              geoBoundaries · CC BY 4.0
            </a>
            <span>/</span>
            <a href="/?view=official">
              Published data in standard dashboard <ChevronRight size={12} />
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
