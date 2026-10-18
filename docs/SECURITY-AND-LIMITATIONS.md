# Security notes and known limitations

This is a working prototype with real, server-enforced access control — not a
cosmetic mock-up. It is **not** yet suitable for real residents' or employees'
personal information. This document is honest about the gap.

## What is real today

- Password authentication with scrypt hashing and constant-time comparison.
- Opaque session tokens in `httpOnly`, `SameSite=Lax` cookies; 24h idle expiry;
  logout destroys the session server-side.
- Login and "Show private" attempts are rate-limited (5 failures → 60 s lockout).
- Role- and assignment-based authorization resolved in one place (`resolveScope`);
  unauthorized dreamers return 404 to prevent enumeration.
- Private rows are filtered in SQL for every read, count and aggregate; staff can
  never create or toggle private data. Covered by automated tests.
- Input validation with zod on every write; JSON body size limit; no stack traces
  returned to clients. Future-dated entries are rejected.
- Private rows leave no trace for staff: random ids for privatizable rows (no
  countable gaps), owner-only markers omitted from staff payloads, and staff
  writes that never update, delete or cascade into a dreamer's private entries
  or notes.
- The private unlock expires 30 minutes after the last real interaction. The
  idle time is reported by the dreamer's own browser (`x-dc-idle`); that is a
  convenience against walking away from an open screen, not a defence against
  the account owner, who knows the password anyway.

## Before handling real personal data

1. **Transport & deployment.** Serve over HTTPS only and set
   `DC_SECURE_COOKIES=1`. Put the process behind a reverse proxy with HSTS, and
   add a CSRF defense for cookie auth (the API currently relies on `SameSite=Lax`
   and JSON content-type; add a double-submit token or Origin check).
2. **Secrets & accounts.** Replace the uniform demo password with per-user
   onboarding (invite + set password), password strength rules, reset flow, and
   ideally SSO/MFA via the organization's identity provider. Remove the
   `/api/auth/demo-accounts` endpoint and the login-page account picker.
3. **Encryption at rest.** SQLite file is plaintext. Use full-disk/volume
   encryption at minimum; consider SQLCipher or a managed Postgres with
   encryption and backups. Journal entries are sensitive free text.
4. **Audit & admin.** Add an audit log for staff reads of dreamer data, admin
   tooling for account lifecycle (add/remove dreamers and coaches, offboarding,
   data export/deletion requests), and retention policies.
5. **Session hardening.** Rotate tokens on privilege changes, add device/session
   lists ("sign out everywhere"), shorter idle expiry for staff, and consider
   requiring re-authentication for the private unlock after a password change.
6. **Rate limiting & abuse.** Current lockout is in-memory-per-database; add
   IP-based throttling at the proxy and alerting on repeated failures.
7. **Backups & recovery.** Automated encrypted backups and a tested restore.
8. **Privacy review.** Confirm with program leadership what the Director should
   see (currently: everything shared, by design) and whether coaches should see
   dreamers' email addresses (currently shown in profile).
9. **Accessibility & browser QA.** The UI uses semantic controls and keyboard
   navigation for the grid and rating inputs, but has not had a formal WCAG audit
   or cross-browser testing beyond Chromium.
10. **Dependencies.** Pin and scan dependencies; set up CI running typecheck,
    API tests and the E2E suite.

## Functional limitations of the prototype

- Single program and organization; no multi-tenant separation.
- No account management UI (users come from the seed). The Director can reassign
  dreamers between coaches and pause/activate them; adding people requires the
  seed or SQL.
- Dreams cannot be marked private (see DECISIONS.md #1); coaches have no private
  notes (#3).
- No notifications, email, calendar integration or file attachments.
- Light theme only; no offline mode.
- Timestamps are stored in UTC and shown in the browser's local time; the seed
  writes its times for a program running in US Eastern time.
- The demo database lives in `data/dreamcoach.db`; `npm run seed` resets it.
