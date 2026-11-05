# Vote Watch

[**votewatch.co.za**](https://votewatch.co.za)

South African local election results on an interactive map. Explore provinces, municipalities, wards and voting districts, or select a party to see where it leads.

- Published IEC votes, party shares, seats and council counts.
- Background updates every 10 seconds, preserving the current map and scroll position.
- Party maps with location drill-down and shareable links.
- Desktop sidebar and mobile tap-to-explore results cards.

## Screenshots

### National results

![Vote Watch desktop dashboard](docs/screenshots/dashboard-desktop.png)

### Party view

![Party results and leading municipalities](docs/screenshots/party-view.png)

### Mobile

<img src="docs/screenshots/dashboard-mobile.png" alt="Vote Watch mobile dashboard" width="300" />
<img src="docs/screenshots/mobile-tap.png" alt="Mobile location card with province and municipality actions" width="300" />

Screenshots show partial results captured on 5 November 2026.

## Run locally

Node.js 24+.

```sh
npm ci
npm run build
npm run server
```

Open http://127.0.0.1:3001. For development, also run `npm run dev` and open http://127.0.0.1:5173. No IEC credentials required.

```sh
npm test
```

Independent project. Results remain partial until officially declared. [Official IEC results](https://results.elections.org.za/dashboards/lge/) ? [Data and third-party credits](THIRD_PARTY_NOTICES.md).

## Deploy with Dokploy

Create a **Docker Compose** application connected to this repository, using `compose.yaml`. Deploy, then add your domain in Dokploy's **Domains** tab:

- Service: `votewatch`
- Container port: `3001`
- HTTPS: enabled

The frontend and API run together. No IEC credentials or separate database are needed. The `results-data` volume preserves cached results and logos across redeployments. Do not delete the volume when updating.

For a local Docker check:

```sh
docker compose up --build -d
docker compose exec votewatch node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>r.text()).then(console.log)"
```

Dokploy routes the domain to the internal port; the Compose file does not publish a host port. Use Docker Compose, rather than Docker Stack, because this file builds the image from source.
