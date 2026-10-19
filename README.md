# Dream Coach

A connected coaching tool for **Dreamers**, **Dream Coaches**, and the **Director**
of a Dream Team. Dreamers track four dreams, action items, CARE / Wheel of Life
ratings, and reflections — with granular, server-enforced privacy. Coaches run live
one-on-one sessions in a spreadsheet-like workspace. The Director sees honest
team-level metrics derived only from shared information.

> Dreams belong to the dreamer. Coaches help people understand themselves, explore
> possibilities, get resourceful, decide what they want, and move forward.

## Quick start

Requirements: Node.js 20.19+ (22 recommended) and npm.

```bash
npm install
npm run build        # builds the client into dist/
npm start            # http://localhost:3000  (creates and seeds data/dreamcoach.db on first run)
```

For development with hot reload:

```bash
npm run dev          # API on :3000, client on http://localhost:5173
```

Reset the demo data at any time with `npm run seed`.

## Demo accounts

Every account uses the password **`dream2026`**. The login page lists them all;
click one to fill the form.

| Role | Account | Notes |
|---|---|---|
| Director | `director@dreamcoach.demo` — Jordan Ellis | Oversees 3 coaches / 11 dreamers; also coaches Sam Whitaker directly |
| Dream Coach | `maya@dreamcoach.demo` — Maya Thompson | 5 dreamers (Alicia, Marcus, Tamsin, Owen, Lena) |
| Dream Coach | `daniel@dreamcoach.demo` — Daniel Okafor | 3 dreamers (Darnell, Hana, Victor — paused) |
| Dream Coach | `priya@dreamcoach.demo` — Priya Raman | 2 dreamers (Grace, Theo) |
| Dreamer | `alicia@dreamcoach.demo` — Alicia Moreno | Highly engaged; weekly self check-ins, private entries |
| Dreamer | `darnell@dreamcoach.demo` — Darnell Price | Engaged; has the Energy 4 → 8 journal story |
| Dreamer | `grace@dreamcoach.demo` — Grace Oyelaran | Engaged; many reflections, several private |
| Dreamer | `marcus@dreamcoach.demo` — Marcus Bell | Moderate; one dream achieved |
| Dreamer | `tamsin@dreamcoach.demo` — Tamsin Reyes | Light user: the odd check-in, and no session for the last couple of months |
| Dreamer | `lena@dreamcoach.demo` — Lena Hoffmann | Joined two months ago |

All people and data are fictional. Private entries in the seed belong to dreamers
only — sign in as the dreamer and use **Show private** (password again) to reveal
them; coaches and the Director never receive them.

## Documentation

- [docs/DEMO-GUIDE.md](docs/DEMO-GUIDE.md) — a guided tour of every role and the complete journey from the brief
- [docs/VERIFICATION.md](docs/VERIFICATION.md) — feature-by-feature verification of the brief's requirements
- [docs/DECISIONS.md](docs/DECISIONS.md) — the decision log for ambiguous points
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, data model, privacy layer
- [docs/SECURITY-AND-LIMITATIONS.md](docs/SECURITY-AND-LIMITATIONS.md) — what is real, what is missing before real personal data
- [docs/CLIENT-GUIDE.md](docs/CLIENT-GUIDE.md) — conventions for developers working on the client

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + Vite dev server with hot reload |
| `npm run build` | Production client build |
| `npm start` | Serve API + built client on one port (`DC_PORT`, default 3000) |
| `npm run seed` | Reset `data/dreamcoach.db` to the demo dataset |
| `npm run typecheck` | TypeScript for client and server |
| `npm run test:api` | API & privacy tests (node:test) against an in-memory database |
| `npm run test:e2e` | Playwright end-to-end journey (starts its own server on :3100) |

## Tech

Node.js · Express 5 · SQLite (better-sqlite3) · TypeScript · React 19 · Vite ·
TanStack Query · react-router 7 · Recharts · Playwright.
