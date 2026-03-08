# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server
node server.js
# or
npm start

# Install dependencies (if node_modules missing)
npm install

# Build Windows .exe (uses pkg, targets node18-win-x64)
npm run build
# Output: dist/ware-fehlt.exe + dist/public/
```

Server runs on port 3000 by default. Override with `PORT` environment variable.

## Architecture

Single-page app with a Node.js/Express backend and vanilla JS frontend, communicating via REST API and Socket.IO for real-time updates across devices. No build step for the frontend — edit and reload.

**Backend (`server.js`):**
- Express serves static files from `public/`
- `lager.json` is the database — loaded into memory on start, written synchronously on every mutation
- `katalog.csv` is the article catalog (artikelname;artikelnummer;lagerort) — read on each `/api/katalog` request, never cached
- Socket.IO broadcasts mutations to all clients: `artikel_neu`, `artikel_erledigt`, `artikel_offen`, `artikel_geloescht`
- When built as `.exe` via `pkg`, both `lager.json` and `katalog.csv` are expected next to the `.exe` (not bundled), `public/` is bundled as asset

**Frontend (`public/`):**
- `app.js` — all logic: Socket.IO events, REST calls, rendering, modals, toasts, catalog autofill
- `index.html` / `style.css` — single page, no framework

**Data model** (`lager.json > artikel[]`):
```
id, artikelname, artikelnummer, lagerort, menge, einheit,
gemeldet_von, erstellt_am, status ('offen'|'erledigt'),
erledigt_von, erledigt_am, notiz
```

**API endpoints:**
- `GET /api/artikel` — all entries, sorted: offen first, then by date desc
- `POST /api/artikel` — create entry (required: artikelname, lagerort, gemeldet_von)
- `PATCH /api/artikel/:id/erledigt` — mark done (required: erledigt_von)
- `PATCH /api/artikel/:id/offen` — reopen
- `DELETE /api/artikel/:id` — delete
- `GET /api/statistik` — counts for gesamt/offen/erledigt/lagerorte
- `GET /api/katalog` — returns parsed katalog.csv as JSON array

**Catalog autofill:**
- `katalog.csv` supports both `,` and `;` delimiters and Windows-1252 (latin1) encoding (Excel German default) — replace the file anytime without restarting the server
- Typing in `f-name` shows a custom touch-friendly dropdown (not `<datalist>`) with filtered results; selecting fills `f-nummer` and `f-lagerort`
- Scroll detection on touch: only selects if finger moved < 8px (prevents accidental selection while scrolling)
- An ✕ button appears inside `f-name` when it has content to quickly clear the field

**Einheit options** (in `index.html` `#f-einheit`): Stück, Karton, Palette, BEKLEBEN
