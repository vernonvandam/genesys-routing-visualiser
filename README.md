# Genesys Cloud Routing Visualiser

An independent browser-based tool for exploring Genesys Cloud Architect data
tables and visualising routing paths. This is a personal project, not an
official or NTT-supported product.

## What it does

- Authenticates to Genesys Cloud using the Platform SDK's OAuth PKCE flow.
- Lists Architect data tables and their inbound service entries.
- Traces routing modules and destinations from the selected service.
- Visualises the route as an interactive, top-down diagram.
- Lets you inspect normal/open-hours, after-hours, public-holiday, unstaffed,
  and emergency paths when those branches are configured in the routing data.
- Exports diagrams as SVG or PNG.

The visualiser reads the routing configuration available to the signed-in
Genesys Cloud user. It does not change Architect flows or other Genesys
configuration.

## Requirements

- Node.js and npm (use a currently supported Node.js LTS release).
- A Genesys Cloud organization and user account.
- A Genesys Cloud OAuth client configured for this application.
- Genesys Cloud permissions that allow the user to read the Architect data
  tables and other configuration used by the visualiser.

## Run locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. A direct visit without Genesys Cloud launch
parameters shows an integration notice; the app must be launched from the
configured Genesys Cloud client application.

The app accepts the following launch parameter names:

| Setting | Accepted parameters |
| --- | --- |
| OAuth client ID | `clientId` or `gc_clientId` |
| Genesys Cloud region | `region` or `gc_region` |
| OAuth redirect URI | `redirectUri`, `redirectURI`, or `gc_redirectUrl` |

The initial launch settings are saved in the browser session so they remain
available when OAuth redirects back to the app.

## Genesys Cloud integration setup

1. Create or select an OAuth client for the app in Genesys Cloud.
2. Configure the OAuth client as a public client that supports the app's PKCE
   authorization flow.
3. Add the exact deployed app URL as an allowed redirect URI. For local
   development, use the local URL/redirect URI configured for your development
   setup; for production, use the HTTPS URL where this app will be hosted.
4. Configure a Genesys Cloud client application/embedded app to launch this
   app and supply the OAuth client ID, Genesys Cloud region, and redirect URI
   using the launch parameters listed above.
5. Grant the users who will run the app the Genesys Cloud permissions needed to
   view the relevant Architect data tables and referenced routing
   configuration.
6. Launch the app from the Genesys Cloud client application and complete the
   OAuth sign-in flow.

The user must have access to the particular tables and routing configuration
they want to inspect. The app reports API errors from Genesys Cloud when access
is missing or a request fails.

## Verify and build for production

```bash
npm run lint
npm run build
npm run preview
```

`npm run build` runs the TypeScript project build and creates the production
site in `dist/`. `npm run preview` serves that build locally for a final
browser check.

Deploy the contents of `dist/` to a static web host. Configure the host to
serve `index.html` for the app's route and use HTTPS. Register the deployed
origin/redirect URI with the Genesys Cloud OAuth client before users launch the
production app.

## Technology

- React 19 and TypeScript
- Vite
- Genesys Cloud Platform JavaScript SDK
- React Flow (`@xyflow/react`)

## Project files

- `src/App.tsx` — launch-parameter handling, OAuth connection, and application
  shell.
- `src/components/DataTableBrowser.tsx` — data-table selection and route
  controls.
- `src/routing/genesysRouting.ts` — routing data loading and path construction.
- `src/components/RouteFlowCanvas.tsx` — interactive diagram and SVG/PNG
  export.

## Attribution

Independent project by
[Vernon van Dam](https://www.linkedin.com/in/vernonvandam/). This project is
not an official NTT product.
