# Architecture

Dream Coach is a single Node.js process serving a JSON API and a built React
client, backed by one SQLite file. It is deliberately simple: one `npm install`,
one `npm start`, no external services.

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser — React 19 + TypeScript (Vite)                          │
│  react-router 7 · TanStack Query 5 · Recharts 3 · custom SVG     │
│  client/                                                         │
│    app/        shells (dreamer / staff / bare), router            │
│    auth/       AuthContext: login, logout, show/hide private      │
│    api/        fetch client + query/mutation hooks                │
│    components/ UI kit, icons, charts, Wheel of Life, toasts       │
│    features/   dreamer · coach · director · shared pages          │
└──────────────┬───────────────────────────────────────────────────┘
               │ /api/* (same origin, httpOnly cookie)
┌──────────────┴───────────────────────────────────────────────────┐
│  Express 5 (server/)                                             │
│    auth.ts      scrypt passwords, sessions, lockout, viewer       │
│    privacy.ts   Scope: who is looking, may they see private rows  │
│    queries.ts   every read filtered by Scope in SQL               │
│    commands.ts  every write checks ownership via Scope            │
│    metrics.ts   staff aggregates (always private-excluded)        │
│    routes/      auth · dreamers (self + staff) · coach · director │
│    seed.ts      deterministic fictional demo data                 │
└──────────────┬───────────────────────────────────────────────────┘
               │ better-sqlite3 (synchronous, WAL)
┌──────────────┴───────────────────────────────────────────────────┐
│  SQLite  data/dreamcoach.db                                      │
│  programs · users · dreamers · dreams · coaching_sessions ·      │
│  check_ins · ratings · dream_progress · journal_entries ·        │
│  actions · auth_sessions · login_attempts                        │
└──────────────────────────────────────────────────────────────────┘
```

## Data model

- **users** — one row per person; `role` is `dreamer | coach | director`.
- **dreamers** — the dreamer profile: assigned coach (`coach_user_id`, may be the
  Director), program, status, joined date, short "about".
- **programs** — name, dates, and the four dream-slot labels + guidance, so other
  programs can use different dream horizons.
- **dreams** — exactly four per dreamer (slot 1–4). `achieved_at` is derived from
  *shared* progress reaching 100%.
- **coaching_sessions** — one per one-on-one: coach, status (`in_progress` →
  `completed`), `occurred_at`, running `notes` and `focus` (visible to the dreamer).
- **check_ins** — a grouping record for a self check-in (several entries made
  together). Sessions and check-ins are the two *sources* of entries.
- **ratings** — one row per rating: category (`contribution | alignment |
  relationships | energy | commitment | satisfaction`), value 0–10, `source`
  (`session | self`), `session_id` / `check_in_id`, `recorded_by`, `is_private`.
  A unique index on (`session_id`, `category`) makes session values upserts.
- **dream_progress** — same shape for 0–100% progress per dream.
- **journal_entries** — reflections. Standalone, attached to a check-in, attached
  to one rating (`rating_id`) or one progress entry (`progress_id`), each with its
  own `is_private`. Optional dream/category tags.
- **actions** — title, details, status (`active | completed | archived`), optional
  dream or CARE category link, `is_private`, creator, originating session.
- **auth_sessions** — opaque token (httpOnly cookie), idle expiry,
  `private_unlocked_until`.
- **login_attempts** — failure counter and lockout per email / per unlock.

## The privacy layer

Every request that touches dreamer data resolves a **Scope**
(`server/privacy.ts`):

```
Scope { dreamerId, includePrivate, viewer, isOwner, isCoachFor }
includePrivate = isOwner && viewer.session.private_unlocked_until > now
```

- `/api/dreamers/:id/...` accepts `me` or a numeric id. A dreamer may only resolve
  their own id; a coach only dreamers assigned to them; the Director any dreamer.
  Everything else is a 404 (identical to "does not exist", so caseloads cannot be
  probed).
- Every SQL read in `queries.ts` carries `(x.is_private = 0 OR ? = 1)` with
  `includePrivate` as the parameter. Attached notes additionally require their
  parent entry to be visible (`JOURNAL_VISIBLE`). Rows that are not visible are
  never loaded, so they cannot be counted, averaged, sorted, or serialized.
- Derived values (latest rating, current dream progress, counts in the snapshot,
  check-in counts, monthly aggregates, coach/director metrics) are all computed
  from the same filtered reads. A self check-in whose every entry is private does
  not exist for staff — it is not listed and not counted.
- "Show private" (`POST /api/auth/privacy/unlock`) verifies the account password
  and stamps `private_unlocked_until` on the *server-side session*; it slides
  with activity and expires after 30 idle minutes. "Hide private" clears it.
  Signing in always starts hidden. Signing out destroys the session.
- Staff can never create private rows (403), never toggle privacy (403), and
  never see `isPrivate: true` in any response.

The client never filters privacy itself; it renders what the server returns. The
`tests/api/privacy.test.ts` suite asserts all of the above end-to-end, including
that director aggregates are byte-identical before and after private-only writes.

## Connected updates

Mutations invalidate the TanStack Query caches for the affected dreamer plus the
coach/director aggregates, so a value typed into the live coaching grid shows up on
the dreamer's pages (and the Director's numbers) the next time they are viewed. The
Present view polls its session every few seconds so edits appear live during a
screen-share.

## Running

- `npm run dev` — API (`:3000`) + Vite dev server (`:5173`, proxying `/api`).
- `npm run build && npm start` — one process on `:3000` serving the built client.
- `npm run seed` — reset the database to the demo dataset.
- `npm run typecheck`, `npm run test:api`, `npm run test:e2e`.

Environment: `DC_PORT`, `DC_DB` (path), `DC_RESET_DB=1` (wipe + reseed on start),
`DC_SECURE_COOKIES=1` (when served over HTTPS).
