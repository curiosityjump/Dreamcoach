# Decision log

Independent judgments made where the brief left room. Each entry: the decision,
why, and what was traded off.

## Product scope and philosophy

1. **Dreams are not privatizable; everything inside them is.** The brief lists
   ratings, progress updates, actions, journal entries, comments and reflections
   as privatizable. The four dreams themselves are the shared basis of the
   coaching relationship, so their titles/descriptions stay visible to the coach.
   Every progress update, note, action and reflection about a dream can still be
   private. *Trade-off:* a dreamer cannot hide a dream's existence. Easy to add
   later (one flag) if a program wants it.

2. **The dreamer owns every entry, including ones a coach recorded.** A dreamer
   may mark a session-recorded rating or progress value private. The coach's grid
   then shows an empty cell for that month, exactly as if it were never recorded.
   The UI warns the dreamer that it will hide the value from the coach's views.
   *Why:* "dreams belong to the dreamer" — ownership shouldn't depend on who typed
   the number. *Trade-off:* the coach may remember the number; software cannot
   un-remember a conversation.

3. **Coaches have no private notes.** Session notes and focus are visible to the
   dreamer. The brief says dreamers can access "coaching notes", and transparency
   fits the philosophy. *Trade-off:* a coach who wants private scratch notes must
   keep them elsewhere; could be added as a clearly separated field later.

4. **Archiving is "setting aside", never failure.** No due dates, no overdue
   state, no streaks. Archived actions can be restored; completed ones reopened.
   Follow-through metrics only use shared actions and are explained as context,
   not judgement.

5. **No social features, gamification, AI coaching or notifications.** Out of
   scope per the brief. The one "small addition" taken: a coach-side "Since last
   session" panel showing the dreamer's shared self check-ins and reflections since
   the previous session, because it directly serves the conversation.

## Privacy semantics

6. **"Hide private" shows the dreamer exactly what the coach sees.** In hidden
   mode the dreamer's own API responses are identical to the coach's (tested).
   This makes the hidden state meaningful for screen-sharing and easy to reason
   about. *Trade-off:* a dreamer in hidden mode cannot edit their private rows by
   id (404) until they unlock — intentional.

7. **Coach-visible "current" values use the latest *shared* entry.** A private
   rating newer than the last shared one never changes what the coach sees, so the
   private entry's existence cannot be inferred from a moved number. Same for
   dream progress and for "last self activity".

8. **A check-in whose entries are all private does not exist for staff** — not
   listed, not counted in "self check-ins (30d)" or monthly totals.

9. **Attached notes inherit their parent's visibility and also have their own
   flag.** Shared rating + private note = coach sees the rating with `note: null`
   and no hint. Private rating + shared note = both hidden (a note alone would
   reveal the rating).

10. **Dream "achieved" is derived from shared progress only.** A private 100% is
    visible to the dreamer as 100% but does not flip the shared achieved badge
    (otherwise staff could infer the private entry).

11. **Unlock state lives on the server session, slides with activity, and expires
    after 30 idle minutes.** Sign-in always starts hidden; sign-out destroys the
    session; switching accounts therefore starts hidden. Wrong-password attempts
    on unlock are rate-limited like logins (5 → 60s lockout).

12. **The dreamer can create private entries while private is hidden.** The entry
    simply disappears from view and a toast explains why. Requiring an unlock to
    write a private note felt like a barrier to honest reflection.

## Coaching workflow

13. **The live workspace is a grid, not a wizard.** Months are columns, the
    current session is the editable column, and the six-step sequence is a
    checklist in the sidebar whose completion is inferred from the data. The
    coach can enter anything in any order, as with the spreadsheet.

14. **Session entries are upserts keyed by (session, category) / (session,
    dream) among *shared* rows.** Correcting a number during a conversation never
    creates duplicates. Entries take the session's date; changing the session date
    moves them. Staff writes only ever touch shared rows: if the dreamer has made a
    session value private, the coach's cell is empty and typing into it creates a
    new shared value, while clearing it removes only the shared one — the private
    row is never updated, deleted or revealed, so an empty cell behaves exactly like
    a never-recorded one. The dreamer then sees both entries in their own history;
    the shared one is what the grid shows.

15. **One open session per dreamer.** "Start session" returns the existing
    in-progress session if there is one. Completed sessions can be reopened or
    edited (values remain editable from the workspace); only an empty in-progress
    session can be deleted. "Empty" is judged on what the coach can see, so the
    answer never reveals private rows; anything the dreamer kept private survives
    the deletion as part of their own history, detached from the session.

16. **Sources are explicit everywhere.** Every rating/progress entry has
    `source: session | self`; charts draw sessions as solid points and self
    check-ins hollow; lists show a Session / Self chip.

## Director metrics

17. **Definitions chosen to be honest and explained in the UI.**
    - Participation (45d): % of *active* dreamers with a completed session in the
      last 45 days (monthly cadence with slack).
    - Engaged between sessions (30d): dreamers with at least one *shared* self
      check-in or reflection.
    - CARE change: mean of (latest session CARE average − first session CARE
      average) for dreamers with ≥ 2 sessions carrying all four ratings; always
      shown with n.
    - Follow-through: among shared actions created more than 30 days ago, %
      completed. Archived actions are reconsidered priorities, not failures.
    - Dreams achieved: shared progress reached 100%.
    A visible caveat states caseloads differ and these are not rankings.

## Technical

18. **Stack: Node + Express 5 + better-sqlite3; React 19 + Vite; TanStack Query;
    react-router 7; Recharts.** Chosen for a one-command local run, synchronous
    SQL that keeps the privacy filter obvious, and mature client tooling.
    Server runs via `tsx` so no build step is needed for the API.

19. **Authorization in one place.** `resolveScope` is the only way to reach dreamer
    data; routes cannot forget to check. Unauthorized dreamers return 404, not
    403, so coaches cannot enumerate other caseloads.

20. **Passwords with scrypt; sessions as opaque tokens in httpOnly cookies.** No
    JWTs (nothing to leak in client storage), no third-party auth. Adequate for a
    prototype; see SECURITY-AND-LIMITATIONS.md for production needs.

21. **Deterministic, relative-dated demo data.** The seed is a seeded PRNG
    anchored to "now", so the demo always looks current and reproduces the same
    shapes. Includes guaranteed privacy examples for the main demo dreamers and
    the brief's Energy 4 → 8 journal story (Darnell Price).

22. **Validated chart palette.** CARE colors come from the dataviz skill's
    reference palette (orange, violet, magenta, aqua; blue and amber for
    Commitment/Satisfaction) and were run through its colour-vision validator;
    all series are direct-labelled since the four-hue set sits in the warn band
    for one deuteranopia pair.
