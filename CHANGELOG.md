# Changelog

## 0.3.1 - 2026-09-03

- Table browser fetches large json/jsonb/text/bytea cells as capped previews so pages stay fast on tables with multi-megabyte values; clicking a truncated cell opens the inspector and loads the full value by primary key.

## 0.3.0 - 2026-07-14

- Persist Linux connection credentials across restarts using Secret Service, while keeping saved connection metadata visible when a credential is missing.
- Add editable data grids with staged batch edits, insert/delete support, SQL previews, foreign-key navigation, export, and larger streamed query results.
- Add SSL modes, root certificates, read-only connections, connection colors, saved tabs, favorites, and improved sidebar navigation.
- Add in-app update checks and installation through signed GitHub release artifacts.
- Add frontend and PostgreSQL integration coverage for the new workflows.

## 0.2.0 - 2026-06-12

- Previous public release.
