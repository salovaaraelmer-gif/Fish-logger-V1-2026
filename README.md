# Kalapäivä — saalisvahti

**Do not open `index.html` by double‑clicking** (that uses `file://`). The app uses JavaScript **ES modules**; browsers block loading them from `file://`, so the page stays on “Ladataan…” and buttons do nothing. Always use a **local HTTP server** (see [How to run](#how-to-run) and [Why `file://` fails](#why-file-fails-cors)).

**Kalapäivä** is a small, boat-oriented fishing log (Fish Logger V1). The goal is **fast catch entry** with minimal taps: you only enter what matters; time and location are captured when the browser allows it.

The UI is in **Finnish**. The code and data model follow the spec in `Plan v1.ini`.

## Features (V1)

- **Kalastajat** — add and store anglers locally.
- **Sessiot** — one active session at a time; start with at least one angler, end when done.
- **Saalis** — guided flow: angler → species (required) → optional length (cm) / weight (kg) → optional notes → confirmation.
- **Tallennus** — data persisted in the browser with **IndexedDB** (`FishLoggerV1`).
- **Sijainti** — GPS is requested best-effort when logging a catch (permission required).

Species options: hauki, ahven, kuha, taimen, muu (mapped internally to pike, perch, zander, trout, other).

## Tech stack

- Static **HTML / CSS / JavaScript (ES modules)** — no build step.
- **IndexedDB** for anglers, sessions, session–angler links, and catch records.

## How to run

This app uses `import` in scripts, so it must be served over **HTTP** (opening `index.html` as `file://` may block modules).

Examples:

- **VS Code**: [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) (or similar) → open the project folder and start the server on `index.html`.
- **Node** (if installed): from the project directory, run `npx --yes serve .` and open the URL shown (often `http://localhost:3000`), or **`npm start`** (serves on port **5050** via `package.json`).
- **Python** (often already installed): in the project folder run `py -m http.server 5050` or `python -m http.server 5050`, then open `http://localhost:5050/`.

### Why `file://` fails (CORS)

When the address bar shows `file:///...`, the page’s origin is treated specially. Module scripts (`<script type="module" src="js/app.js">`) are loaded with **stricter rules** than old non-module scripts; loading them from `file://` is blocked, so `app.js` never runs. You may see errors mentioning **CORS**, **origin `null`**, or **`net::ERR_FAILED`**. Serving the same folder over **`http://localhost`** fixes this.

## Project layout

| Path | Role |
|------|------|
| `index.html` | Main page and overlays |
| `css/app.css` | Styles |
| `js/app.js` | UI wiring |
| `js/db.js` | IndexedDB access |
| `js/sessionService.js` | Session lifecycle |
| `js/catchService.js` | Catch validation, GPS, species |
| `Plan v1.ini` | Product/spec notes (V1 scope and data model) |

## Out of scope (V1)

No analytics, maps, sync, weather, or extra “smart” features — see `Plan v1.ini` for the full list.

## License

Not specified in this repository; add a `LICENSE` file if you distribute the project.
