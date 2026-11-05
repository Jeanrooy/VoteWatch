import { ThemeToggle } from "./theme";
import { ArrowLeft } from "lucide-react";
import PublicExplorer from "./PublicExplorer";
import CouncilResults from "./CouncilResults";

export default function App() {
  const councils =
    new URLSearchParams(location.search).get("view") === "councils";
  const mapURL = new URL(location.href);
  mapURL.searchParams.set("view", "official");
  mapURL.searchParams.delete("detail");
  return (
    <main className="election-workspace" aria-label="Election results">
      {councils ? (
        <>
          <div className="council-page-toolbar">
            <a href="/" className="council-home-link" aria-label="VoteWatch national map">VoteWatch</a><ThemeToggle />
            <a
              className="gis-back-to-map"
              href={mapURL.pathname + mapURL.search}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back to map
            </a>
          </div>
          <CouncilResults />
        </>
      ) : (
        <PublicExplorer />
      )}
    </main>
  );
}
