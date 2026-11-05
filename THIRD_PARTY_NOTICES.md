# Data and third-party credits

The MIT license in this repository applies to the application source. Data, party logos and third-party software retain their respective rights and licenses.

- Election results and party logos: [Electoral Commission of South Africa](https://results.elections.org.za/dashboards/lge/). Party logos belong to their respective owners. This project is independent of the IEC.
- Prepared 2026 ward and municipal boundaries: IEC. Voting-district registry and station locations: [Municipal Demarcation Board](https://www.demarcation.org.za/), March 2026 station layer. Geographic coverage and source metadata are in `public/gis/manifest.json`.
- Provincial geometry used in the 3D view: [geoBoundaries / William & Mary geoLab](https://www.geoboundaries.org/), South Africa ADM1, gbOpen, CC BY 4.0. Display spelling and rendering are adapted.
- Map components: [mapcn](https://www.mapcn.dev/), MIT. Map renderer and bundled worker: [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js), BSD 3-Clause; the bundled worker retains its license header.

Dependency licenses are included with their npm packages. Prepared geography remains in the repository; downloaded research and runtime caches are excluded.

- Geographic place names in `public/gis/places.json`: ? OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright), extracted using Overpass. These orientation points are separate from IEC electoral boundaries and do not define voting areas. The local extract includes source identifiers, coordinates and source timestamp. Regenerate with `npm run prepare:places`.
