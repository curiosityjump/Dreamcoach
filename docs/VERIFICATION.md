# Verification

How each requirement in the brief was verified. "API test" = `tests/api/*.test.ts`
(53 tests against an in-memory, freshly seeded database). "E2E" = the Playwright
journey in `tests/e2e/journey.spec.ts` (6 serial steps, fresh database on :3100).
"Manual" = exercised in Chromium with screenshots in `docs/screenshots/`.

Run everything: `npm run typecheck && npm run test:api && npm run test:e2e`.

## Dreamer experience

| Requirement | How it works | Verified by |
|---|---|---|
| Own login and personal dashboard | Session cookie auth; `/home` with dreams, CARE, actions, coaching, recent activity | E2E 2, manual |
| Four dreams with description, current + historical progress, related actions/reflections | `dreams` table (4 slots, program-defined labels); `/dreams`, `/dreams/:id` with chart, entries, actions, reflections | Manual; API test (dreams, achieved) |
| Progress 0–100%, updatable outside sessions, optional note, history over time | Progress dialog → `POST /check-ins` with `progress[]`; history list + trend chart | Manual; API test ("dream progress reaching 100%") |
| Action items: add, edit, complete, archive, review, link to dream/CARE, mark private | Shared `ActionList`/`ActionComposer` on `/actions`, Home, dream detail, coach views | E2E 2–3 (add + complete), API test (status transitions, privacy), manual (edit, set aside, restore, delete) |
| No punitive mechanics | No due dates / overdue; "Set aside" wording; restore/reopen | Design review |
| CARE Wheel of Life, interactive, any subset of ratings | SVG wheel with click/drag → pending panel → check-in; `/check-in` picker | Manual (`dreamer-care-*` screenshots); E2E 4 (Energy only) |
| Commitment & Satisfaction 0–10 | One-tap rating cards on `/care`; grid rows in sessions | E2E 1 (session), manual |
| Timestamps on every rating | `occurred_at` on all entries; shown in lists and tooltips | API test, manual |
| Journal attached to ratings/progress, and standalone | `journal_entries` with `rating_id` / `progress_id` / standalone; composer on `/journal` | E2E 4, API test |
| Historical view per category: graph, each rating + timestamp, comments, chronology | `/care/:category` | E2E 8, manual |
| Same for each dream | `/dreams/:id` | Manual |
| Move between big picture and one area | Wheel → category links; dreams → detail; timeline links | Manual |

## Privacy

| Requirement | How it works | Verified by |
|---|---|---|
| Any entry can be private (ratings, progress, actions, journal, notes) | `is_private` on every row; per-entry switches in every composer and ⋯ menu | API privacy test (all five kinds), E2E 4–5 |
| Granular: shared rating with private note | Separate flags on rating and attached note; note requires parent visible | API test "shared rating with private note is intact…" + "private note … is absent", E2E 6 |
| Absent from coach, director, aggregates, charts, exports — no placeholders/counts | SQL filter in every read; counts/aggregates derived from filtered reads; check-ins with no visible entries do not exist | API tests: "private entries are absent…", "a check-in whose every entry is private…", director totals byte-identical; E2E 6 & 9 scan every staff page and API for markers and the word "private" |
| Private rating never silently changes a coach-visible current value | Latest-visible logic | API test (latest Energy unchanged, dream progress unchanged, last self activity unchanged) |
| Hide Private instant, no password | `POST /auth/privacy/lock`; client resets caches | E2E 7 |
| Show Private requires password re-entry; real check | `POST /auth/privacy/unlock` verifies scrypt hash; lockout after 5 failures | API test (wrong → 401, right → unlocked, lockout), E2E 7 (wrong refused) |
| Locked state on sign-out / sign-in / expiry / account switch | New login always hidden; logout destroys session; 30-min idle relock | API tests ("re-login starts hidden", "unlock times out server-side"), E2E 7 |
| Real access control, not cosmetic | Server-side filtering; hidden-mode owner cannot read/edit private rows by id | API test "dreamer in hidden mode cannot read or edit own private rows by id"; "hide private: the dreamer sees exactly what the coach sees" (deep-equal of 7 endpoints) |
| Staff can never create or toggle private | 403s | API test |
| A coach's session grid can never update, delete or reveal a value the dreamer made private | Staff writes touch shared rows only; owner-only markers are omitted from staff payloads | API test "a coach re-entering a cell the dreamer privatised…" |
| Deleting a session never destroys private rows; sessions with entries cannot be deleted | Emptiness judged on coach-visible content; private rows detached, not cascaded | API tests "deleting a session never destroys private rows…", "a session that looks empty to the coach can be deleted…" |
| Staff actions never destroy a dreamer's words | Clearing/deleting an entry detaches its note into a standalone reflection | API tests "staff clearing a cell or deleting a session value never destroys the dreamer's note…", "deleting an entry while private entries are hidden keeps its hidden private note" |
| Hidden mode never changes what the dreamer can't see | A hidden private note is never overwritten, cleared or re-flagged; write replies show only what a read would | API tests "a private note the dreamer cannot see right now…", "write responses in hidden mode show only what a GET would" |
| The dreamer can always hide a session value again | Shared-only session keys; kind 409 only when a newer coach value blocks sharing back; private and orphaned session values deletable by the dreamer | API tests "the dreamer can always hide a session value…", "a private value left behind by deleting a session…" |
| No countable traces: ids, order, timestamps | Random ids for privatizable rows (seeded and new); staff payload order fixed by visible fields; privacy-only toggles keep updated_at; private progress leaves dream timestamps alone | API tests "ids carry no trace…", "seeded rows carry random ids too…", "staff session payloads keep a fixed cell order…", "making an entry private and shared again leaves no trace…", "private progress leaves a dream's timestamps untouched…" |
| Unlock expires after 30 minutes without interaction, even with a page left open | Requests carry ms-since-last-input; background polling never extends the unlock; a keep-alive just before expiry for someone still using the page | API test "background requests never keep private entries showing…"; manual (Playwright, idle and typing scenarios) |
| Notes under private entries are private too, and marked so for the owner | parentPrivate (owner, unlocked only); Private chip and "private with its rating" in every dreamer view and filter | API test "notes on private entries are flagged for the owner only…"; manual |

## Coach experience

| Requirement | How it works | Verified by |
|---|---|---|
| Dashboard of assigned dreamers, caseload at a glance | `/coach` via `GET /coach/dashboard` | Manual |
| Per-dreamer: dreams, progress, CARE trends, commitment/satisfaction, actions, session history, shared reflections, engagement facts | `/dreamers/:id` tabs | Manual; E2E 6 visits every tab |
| Never sees private entries | Scope with `includePrivate=false` | API + E2E 6 |
| Live one-on-one tool modelled on the spreadsheet, months side by side | `SessionGridView` in `/dreamers/:id/session/:sid` | E2E 1 (typed values persist), manual screenshots |
| Six-step sequence supported, revisitable | Sidebar checklist inferred from data; all cells editable any time | Manual |
| Session entries update the shared record (no duplicates) | Upsert keyed by (session, category/dream) | API test "values upsert, not duplicate" |
| Attractive presentation during session | `/present` view, live-refreshing | Manual screenshot |
| Formal sessions vs self check-ins distinguishable | `source` on every entry; solid vs hollow markers; chips | Manual; API responses carry `source` |
| Review self check-ins between sessions | "Since last session" panel in the workspace; Reflections tab | Manual |
| Minimal duplicate entry / admin | Notes & focus autosave; actions appear on the dreamer's list immediately | E2E 1–2 |
| Spreadsheet-like entry that never loses work | Enter/Tab move down, arrows move between cells, Escape cancels; failed saves stay marked and retry; pending edits flush before leaving; a typed-but-unadded action is offered before completing | Manual (Playwright, incl. simulated network failures) |
| Review of previous actions that stays accurate over time | Open-at-the-time actions plus anything completed/set aside since the previous session; correct window for past and reopened sessions; saved "reviewed" tick; previous session's focus and notes shown | API test "a session counts the actions chosen in it…"; manual |
| One open session per dreamer; honest crediting | Reopen refused while another is open; a session is credited to whoever completes it; future dates rejected | API tests "one open session per dreamer…", "a session is credited to the coach who completes it", "entries and sessions cannot be dated in the future" |

## Director experience

| Requirement | How it works | Verified by |
|---|---|---|
| All coaches, dreamers per coach, participation, activity, outcomes, trends | `/director` via `GET /director/overview` | E2E 9, manual |
| All Dreamers view, search, drill-down | `/director/dreamers` → `/dreamers/:id` | E2E 9, manual |
| Director can run sessions | Same workspace; director is `isCoachFor` everyone | API test "director can run a session for any dreamer" |
| Sound metrics, no misleading rankings | Definitions in UI ("How these are calculated") and DECISIONS.md #17; caveat text | Design review |
| No private data in reporting | Aggregates from filtered reads | API test (director totals identical before/after private writes), E2E 9 |
| Metrics that mean what they say | Engaged and Participation over active dreamers; sessions credited to who ran them, outcomes to the current caseload; last self activity names check-in vs reflection; unassigned dreamers surfaced; UTC months everywhere | API tests in `metrics.test.ts` (paused dreamers, engagement sources, crediting, last activity, unassigned, UTC months) |

## Connected experience

| Scenario | Verified by |
|---|---|
| Coach records Energy → dreamer sees it in history with source "session" | API test (sessions), E2E 1–2 |
| Dreamer adds action → coach sees it | API test (coach sees completed action), E2E 1–2 (coach-created action on dreamer's Home) |
| Dreamer completes action → reflected | API test, E2E 3 |
| Private journal → only dreamer | API, E2E 5–7 |
| Director aggregates from shared data only | API, E2E 9 |

## Role boundaries

| Check | Verified by |
|---|---|
| Dreamer cannot reach staff endpoints (403) or other dreamers (404) | API test |
| Coach cannot see other caseloads (404, indistinguishable from missing) or director endpoints (403) | API test |
| Director can see everyone | API test |
| Dreamer cannot edit session metadata or record session ratings | API test |
| Value edits restricted to the entry's source owner; privacy restricted to the dreamer | API test |

## Demo data

| Requirement | Present in seed |
|---|---|
| Several coaches with different caseloads | 3 coaches (5 / 3 / 2) + Director (1) |
| Dreamers with different engagement | high / moderate / light / paused / new |
| Four dreams per dreamer | 44 dreams |
| Multiple months of coaching history | 9 monthly sessions for most dreamers (~87 sessions) |
| CARE and dream-progress changes | Trajectories with noise, dips and recoveries |
| Active, completed, archived actions | ~200 actions across states |
| Self check-ins between sessions | ~170 check-ins |
| Public and private ratings; public ratings with private notes; private actions and journal entries | ~150–175 private rows incl. personal guaranteed examples for Alicia, Darnell, Grace |
| Trend charts with enough history | 9 months |
| Aggregated Director metrics | Yes |

## How the prototype was reviewed

Beyond the automated suites, the finished prototype went through repeated
adversarial review rounds. Each round, independent reviewers took one lens each
— privacy end to end (actively trying to exploit the API as a coach, the
Director and a hidden-mode dreamer), the dreamer experience, the coach's live
session, Director metrics (recomputed from raw API data), and demo data plus
code correctness — at laptop and phone widths, with screenshots. A separate
skeptic then tried to reproduce and refute every finding, and only findings
that survived were fixed. Every fix was verified in the running app, and new
server behaviour got an API test.

| Round | Findings that survived the skeptics | High | Medium |
|---|---|---|---|
| 1 | 41 distinct, plus 14 whose verification was cut short (reproduced and fixed in the first fix pass) | 2 | 25 |
| 2 | 99 | 2 | 21 |
| 3 | 40 | 0 | 13 |
| 4 | 36 | 2 | 10 |
