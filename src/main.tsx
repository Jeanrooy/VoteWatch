import { ThemeProvider } from "./theme";
import "./analytics";
import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./modern.css";
import "./themes.css";
const ElectionWorld = lazy(() => import("./ElectionWorld"));
const is3D = new URLSearchParams(location.search).get("view") === "3d";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      {is3D ? (
        <Suspense
          fallback={
            <div
              style={{
                minHeight: "100vh",
                background: "#070d1b",
                color: "#b7c9eb",
                display: "grid",
                placeItems: "center",
              }}
            >
              Loading election landscape…
            </div>
          }
        >
          <ElectionWorld />
        </Suspense>
      ) : (
        <App />
      )}
    </ThemeProvider>
  </React.StrictMode>,
);
