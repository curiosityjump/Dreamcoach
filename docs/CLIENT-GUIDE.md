# Dream Coach — client implementation guide

This guide is for anyone implementing or changing a client page. The server, data
model, privacy layer, shared types, UI kit, hooks, routing and app shell already
exist. Pages are built on top of them — do not duplicate or bypass them.

## Run / check

```bash
npm run dev            # API on :3000 + Vite on :5173 (proxying /api)
npm run typecheck      # tsc for client AND server — must pass before you are done
npm run build          # production client build into dist/
# screenshot a page (server must be running on :3005 or pass base as 6th arg)
node scripts/screenshot.mjs /care out.png 1280 800 alicia@dreamcoach.demo
```

A shared dev server is often already running on **http://localhost:3005** using
`data/dev.db` (`DC_PORT=3005 DC_DB=data/dev.db npx tsx server/index.ts`). It serves
the *built* client from `dist/`, so run `npm run build` to see client changes
there, or use Vite on :5173 for hot reload (`npm run dev:client` with
`DC_PORT=3000` server).

Demo accounts (password `dream2026` for all): dreamers `alicia@dreamcoach.demo`
(highly engaged), `darnell@dreamcoach.demo` (has the Energy 4→8 journal story),
`grace@dreamcoach.demo`, `marcus@dreamcoach.demo` (achieved a dream),
`tamsin@dreamcoach.demo` (light user), `lena@dreamcoach.demo` (new, 2 months);
coaches `maya@`, `daniel@`, `priya@dreamcoach.demo`; director
`director@dreamcoach.demo` (also coaches Sam Whitaker).

## Where things live

| Path | What |
|---|---|
| `shared/types.ts` | **The API contract.** Every response/request shape. Read it first. |
| `shared/care.ts` | CARE categories, `CATEGORY_META` (label, color, tint, prompt, sub-areas) |
| `client/api/hooks.ts` | TanStack Query hooks for every endpoint + mutations (auto-invalidate) |
| `client/api/client.ts` | `get/post/patch/put/del`, `errorMessage(e)` |
| `client/auth/AuthContext.tsx` | `useAuth()` → `{ auth, login, logout, unlockPrivate, lockPrivate }`; `useUser()` |
| `client/components/ui.tsx` | UI kit (below) |
| `client/components/icons.tsx` | Inline SVG icons (`IconLock`, `IconCheck`, …) |
| `client/components/charts.tsx` | `TrendChart`, `MultiTrendChart`, `SourceLegend`, `Sparkline` |
| `client/components/WheelOfLife.tsx` | The CARE wheel (static or interactive, with compare overlay) |
| `client/components/toast.tsx` | `useToast().toast(message, 'success' \| 'error' \| 'info' \| 'private')` |
| `client/lib/format.ts` | `fmtDate`, `fmtDateTime`, `relativeTime`, `dayHeading`, `pct`, `num`, `signed`, `plural`, `firstName` |
| `client/app/routes.ts` | `staffDreamerPath(id, tab?)`, `sessionPath(id, sid)`, `presentPath(id, sid)` |
| `client/app/Shell.tsx` | Top bar + nav for dreamer and staff; `PrivacyControl` lives in the dreamer top bar |
| `client/styles/*.css` | tokens → base → components → features. Add page CSS to `client/styles/features.css` under a clearly labelled section, using the tokens. |
| `client/features/<role>/<Page>.tsx` | Pages. One file per page; small sub-components may live next to it (`features/<role>/<Thing>.tsx`). |

Path aliases: `@/…` → `client/…`, `@shared/…` → `shared/…`.

## UI kit (client/components/ui.tsx)

- `Button` — `variant: 'primary'|'secondary'|'ghost'|'danger'|'gold'`, `size: 'sm'|'md'|'lg'`, `block`, `icon`, `loading`
- `Card` (`pad`, `pad="sm"`, `soft`), `CardHead({title, sub, actions})`
- `PageHeader({eyebrow, title, lead, actions})`
- `Field({label, hint, error, htmlFor})`, `TextInput`, `TextArea` (auto-grows)
- `RatingInput({value, onChange, category?, compact?, allowClear?})` — 0–10 pills, colored by category
- `PercentInput({value, onChange, color?})` — range + number for 0–100
- `PrivacyToggle({value, onChange, size?})` — the per-entry Shared/Private switch (shows lock icon when private)
- `Chip`, `CategoryChip({category, short?})`, `SourceChip({source, coachName?})`, `PrivateChip`
- `Avatar({initials, size?, tone?})`, `Segmented({value, onChange, options})`
- `EmptyState({icon, title, children, action})` — every list needs a warm empty state
- `Spinner`, `LoadingPage`, `Skeleton`
- `Stat({label, value, sub, delta})`, `Delta({value})`, `Bar({value, color, large})`
- `Check({checked, onChange, label})` — round completion checkbox
- `Modal({open, onClose, title, footer, size?})`, `ConfirmDialog(...)`, `Dropdown({trigger, children})`

CSS utility classes: `.page`, `.page-narrow`, `.page-wide`, `.grid .grid-2/3/4`,
`.stack`, `.row`, `.row-wrap`, `.spread`, `.grow`, `.muted`, `.small`, `.tiny`,
`.tnum`, `.table-wrap table.table`, `.list .list-item`, `.timeline .timeline-item`,
`.note-block(.private)`, `.callout(.callout-private|.callout-gold|.callout-muted)`,
`.tabs .tab`, `.stat-row`, `.chart-wrap`, `.legend`.

## Charts

Read `CATEGORY_META[cat].color` for series colors; never invent colors. One y-axis
per chart. Session entries = solid dots, self check-ins = hollow dots (the
`TrendChart` does this; add `<SourceLegend color=…/>` under it). Direct-label
series. Use `MultiTrendChart` when showing all four CARE lines together.

## Data & privacy rules (non-negotiable)

1. **Never filter privacy client-side.** The server already returns only what the
   viewer may see. `isPrivate` is only ever `true` on the dreamer's own entries when
   their session is unlocked. Render a `PrivateChip`/lock on those; never show
   placeholders, counts, or "hidden" hints anywhere.
2. **Staff pages must not mention private entries at all** — not even "no private
   entries". Only the dreamer's own UI has privacy controls.
3. Dreamer pages use `'me'` as the dreamer ref (`useOverview('me')`). Staff pages
   use the numeric `dreamerId` from the route.
4. After a mutation the hooks invalidate the dreamer's queries + coach/director
   aggregates; you do not need manual refetches. Show a toast on success
   (`'private'` kind when something was saved as private, with the message
   "Saved as private — private entries are currently hidden." if
   `!auth.privateUnlocked`).
5. When the dreamer marks something private while private entries are hidden, it
   disappears from the list; that is expected — the toast explains it.
6. No dead buttons. Every control must do something real through a hook, or not exist.

## Tone & design

- Warm, calm, personal. Encouraging without being childish; no gamification, no
  streak shaming, no overdue/red alarms. Archiving an action is a neutral act
  ("Set aside"), never a failure. Use language like "What's on your mind?", "Set
  aside", "Reopen", "Celebrate".
- Clear hierarchy: `PageHeader` with an eyebrow, then cards. Keep text concise.
- Responsive: phones (≥360px) and laptops. Use the grid utilities; tables wrap in
  `.table-wrap`. Touch targets ≥ 40px.
- Loading: use `LoadingPage` or `Skeleton`; errors: a `.callout` with
  `errorMessage(error)`.
- Dates: `fmtDate`, `relativeTime`, `dayHeading` from `lib/format`.
- Add `data-testid` attributes to key controls so E2E tests can target them
  (e.g. `data-testid="add-action"`, `"action-item"`, `"checkin-save"`).

## Distinguishing sources

A rating or progress entry has `source: 'session' | 'self'`. Always make this
visible where entries are listed or charted (`SourceChip`, hollow vs solid dots).
Coaching sessions have a `number` ("Session 6") and `occurredAt`.

## Page expectations (summary)

See the brief in `docs/BRIEF.md` for the full product vision. Page-by-page notes:

**Dreamer** (`features/dreamer`, ref `'me'`)
- `HomePage` — greeting, privacy status hint, four dreams with progress bars, latest
  CARE snapshot (small wheel), active actions (quick complete), "Check in" and
  "Write" CTAs, recent activity, next/last session.
- `DreamsPage` + `DreamDetailPage` — the four dreams (slot label + guidance from
  `dreamer.program`), edit title/description inline, update progress with optional
  note + privacy, history chart, entries list with notes, related actions and
  reflections.
- `ActionsPage` — Active / Completed / Set aside tabs; add, edit, complete, reopen,
  archive/restore, privacy per action, link to dream or CARE category; filters.
- `CarePage` — interactive Wheel of Life (click a quadrant → rate), latest values
  with deltas, Commitment & Satisfaction, trends (MultiTrendChart), links to each
  category history.
- `CategoryHistoryPage` — one category: trend chart with session vs self markers,
  chronological entries with their notes and check-in reflections, edit/privacy on
  own self entries, quick "rate now".
- `CheckInPage` — self check-in: choose categories to rate (any subset), each with
  value, optional note, privacy for rating and note separately; optional dream
  progress updates; optional overall reflection. Save → toast → back home.
- `JournalPage` — timeline of reflections and notes grouped by day; write new
  entry (private toggle, optional dream/category tag); edit/delete own; filter.
- `MySessionsPage` — list of coaching sessions with ratings/progress recorded,
  coach notes and focus; `/sessions/:sessionId` opens one.

**Coach** (`features/coach`, numeric id)
- `CoachDashboardPage` — stats row, caseload cards/table (last session, last
  self activity, CARE avg, dream avg, active actions, open session), start/continue
  session.
- `StaffDreamerPage` — tabs: Overview (dreams, wheel vs previous, latest ratings,
  actions, recent shared reflections), Sessions (grid like the spreadsheet + list),
  Actions, History (per category/dream charts), Journal (shared reflections).
  Buttons: Start session / Continue session.
- `SessionWorkspacePage` — the live one-on-one: spreadsheet-like grid (months as
  columns, current session editable), six-step sequence sidebar as guidance,
  previous actions to review (complete/edit/archive), add new actions, running
  notes + focus (autosave), Commitment/Satisfaction, "Present" button, "Complete
  session".
- `PresentPage` — clean full-screen view for screen-sharing: wheel now vs last,
  dream progress bars with deltas, trend lines, commitment/satisfaction.

**Director** (`features/director`)
- `DirectorOverviewPage` — totals, coaches table (caseload, sessions, participation,
  CARE change with n, engagement), program-wide month trends, caveat text about
  comparisons.
- `DirectorDreamersPage` — searchable/sortable table of all dreamers → dreamer page.
- `DirectorCoachPage` — one coach: summary, caseload, trends.

## Drafts and private entries (dreamer pages)

Hiding private entries — by hand, by the 30-minute re-hide or from another tab —
resets the `['dreamer']` queries, and it must never cost the dreamer what they were
typing. `client/features/dreamer/drafts.tsx` holds the conventions:

- Gate a page's skeleton on `useLoadedOnce(...)`, not `isLoading`, so forms stay
  mounted while data reloads.
- Wrap row editors in `KeepDrafts` / `useKeptDraft` so an open edit survives its
  row reloading.
- Cover a draft whose privacy switch is on with `useCovered` / `CoveredDraft`
  while private entries are hidden; it can still be saved, and its words come back
  when private entries are shown.
- Dialogs are portaled; `Modal` stops form submits at its root and only the
  topmost dialog answers Escape and Tab.

