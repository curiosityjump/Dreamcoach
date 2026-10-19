# Demo guide

Everything below runs against the seeded demo data. Password for every account:
**`dream2026`**. Start the app (`npm install && npm run build && npm start`) and
open http://localhost:3000. The login page lists every demo account — click one
to fill the form.

> All people and entries are fictional. Reset the data at any time with
> `npm run seed` (stop the server first) or by starting with `DC_RESET_DB=1`.

## The cast

| Who | Account | Why they're interesting |
|---|---|---|
| Jordan Ellis — Director | director@dreamcoach.demo | Oversees 4 coaches and 11 dreamers; personally coaches Sam Whitaker |
| Maya Thompson — Coach | maya@dreamcoach.demo | Largest caseload (5): Alicia, Marcus, Tamsin, Owen, Lena |
| Daniel Okafor — Coach | daniel@dreamcoach.demo | 3 dreamers incl. Victor (paused) and Darnell |
| Priya Raman — Coach | priya@dreamcoach.demo | 2 dreamers: Grace, Theo |
| Alicia Moreno — Dreamer | alicia@dreamcoach.demo | Highly engaged: weekly self check-ins, journal, private entries |
| Darnell Price — Dreamer | darnell@dreamcoach.demo | The Energy 4 → 8 journal story from the brief (August) |
| Grace Oyelaran — Dreamer | grace@dreamcoach.demo | Many reflections, several private |
| Marcus Bell — Dreamer | marcus@dreamcoach.demo | Achieved his program dream (camping every month) |
| Tamsin Reyes — Dreamer | tamsin@dreamcoach.demo | Light user: the odd check-in (some private), and no session for the last couple of months — see how gaps look without guilt |
| Lena Hoffmann — Dreamer | lena@dreamcoach.demo | Joined two months ago |

## Tour 1 — the dreamer (sign in as Alicia)

1. **Home** — greeting, the four dreams with progress and how far each has moved
   since a coaching session (labelled, e.g. "▲ 6 pts since S9"), the CARE wheel
   from her latest readings, active actions (check one off right here), the last
   coaching session with Maya's focus and notes, and a recent activity feed.
2. **Dreams** — open *Run the Riverfront Half Marathon*. Edit the title or
   description inline, read the progress history (solid dots = coaching sessions,
   hollow = self check-ins), hover points for the note behind each number, and use
   **Update progress** to record a new percentage with an optional note — each with
   its own Shared/Private switch.
3. **Actions** — Active / Completed / Set aside. Add an action, link it to a dream or
   CARE area, complete it (gentle "Done — nicely."), reopen it, set one aside and
   restore it. Use the ⋯ menu to make an action private.
4. **CARE** — click or drag inside a quadrant of the wheel (on a phone: tap; a
   vertical swipe still scrolls) to set a new rating; a save panel appears so you
   can add a note and choose what to share — on phones a bar at the bottom keeps
   the unsaved change and *Save* in view. Tick *Compare with last coaching
   session* to overlay the dashed outline. For Commitment or Satisfaction, pick a
   number, optionally add a note, then *Save*. Scroll for all areas over time.
5. **CARE → Energy → History** — the single-area view: trend, the "ranged x–y" line,
   and every entry with its note and the reflections written alongside it. From
   the ⋯ menu: edit or delete your own self entries, add your own note to a value
   Maya recorded in a session, or make any entry private.
6. **Check in** (top-right) — pick any subset of areas and dreams, rate them, add
   notes, write a reflection; every piece has its own privacy switch. Save.
7. **Journal** — write a reflection (tag it with a dream or area), switch between
   *Reflections* and *Everything*, search and filter.
8. **Sessions** (in the navigation) — the months-side-by-side grid of every
   coaching session plus Maya's notes and the actions chosen each time.

### Privacy, hands-on
- Notice the top bar says **Show private** — private entries are hidden by default
  after sign-in. The lists you see are exactly what Maya sees.
- Click **Show private**, enter a wrong password (refused), then `dream2026`. Private
  entries appear with a purple lock chip — including a private action, a private
  reflection, a private rating, and a *shared* rating whose note is private (in
  the last week or two, after her latest session). Current values that come from
  a private entry carry the same chip on Home and CARE.
- Click **Hide private** — everything private disappears instantly, with no
  placeholders or counts. Sign out and back in: hidden again.
- Private entries also hide automatically after 30 minutes without interaction
  (a page that is merely left open — even a live session page — doesn't count),
  with a short notice. Hiding in one tab hides every open tab.
- Try making something private while private entries are hidden: it simply
  disappears from view with a toast. If a shared rating already carries a
  private note you can't currently see, *Add a note* asks you to show private
  entries first rather than overwrite it.

## Tour 2 — the coach (sign in as Maya)

1. **My dreamers** — the caseload at a glance: last session, last self activity,
   CARE average with the four values, dream progress, active actions.
2. Open **Alicia Moreno** — Overview (dreams, wheel now vs last session, latest
   ratings, facts about engagement, recent shared activity), **Sessions** (the
   spreadsheet-style grid), **Actions**, **History** (any area or dream, with the
   shared notes), **Reflections** (shared only). You will find no trace of her
   private entries anywhere — not even a count.
3. **Start session** — the live workspace. Type numbers into the highlighted
   column (Tab or Enter moves down, arrows move between cells, Escape cancels an
   edit), review previous actions — last session's focus and notes sit on top,
   and anything Alicia completed since then is listed too — complete, set aside
   or edit them, add new actions chosen together, write the focus and notes
   (autosaved). The right-hand *Session flow* checklist mirrors the six-step
   sequence (tick *Review previous actions* yourself; the rest fill in from the
   data); *Since last session* shows Alicia's shared self check-ins and
   reflections since last time.
4. **Present** — opens a clean screen-share view in a new tab: wheel today vs last
   session, dream progress with deltas, CARE over the program, commitment and
   satisfaction. It updates live as you type in the workspace tab.
5. **Complete session** — the record is final (reopen or *Edit values* if needed;
   an empty session asks before completing and offers *Delete* instead). Sign in
   as Alicia: Home and History already show the new values with a "Coaching
   session" label.

## Tour 3 — the Director (sign in as Jordan)

1. **Team** — totals (dreamers, sessions, participation, engagement between
   sessions, dreams achieved, CARE change since first session with n), CARE across
   the team, month-by-month trends, and the coaches table. Read the caveat: these
   are context, not rankings; *How these are calculated* spells out each metric —
   sessions are credited to the coach who ran them, every other per-coach figure
   describes their current caseload.
2. Click a coach → caseload and trends for that coach. Click a dreamer → the same
   dreamer view the coach has.
3. **All dreamers** — search, filter by coach or status, sort; reassign a dreamer to
   another coach (their past sessions stay credited to whoever ran them) or mark
   them paused from the row menu, and watch the coach pages and metrics follow.
4. **My coaching** — Jordan's own caseload (Sam Whitaker) with the same live
   workspace coaches use.

## The complete journey (as in the brief)

1. As **Maya**, open Alicia → **Start session**; enter CARE, dream progress,
   commitment and satisfaction; add an action; write notes; **Complete session**.
2. As **Alicia**, Home shows the new values and the new action.
3. Add an action on **Actions** and complete it.
4. **Check in**: rate Energy, add a note, write a reflection.
5. Make the note private (lock switch under the note) and write a private journal entry.
6. As **Maya**, open Alicia: the Energy rating is there; the note and the private
   entry are not, and nothing hints at them.
7. As **Alicia**: **Show private** (wrong password → refused; right password →
   shown), then **Hide private**.
8. Open **CARE → Energy** and **Journal → Everything** for the history and timeline.
9. As **Jordan**, **Team** and **All dreamers** reflect the new session; no private
   content appears anywhere.

This exact journey runs automatically in `npm run test:e2e`.
