# Bestgres — Minimalist Postgres Explorer

## Core Philosophy
- **KISS & Lean:** Zero bloat. Every feature must justify its existence.
- **Performance:** UI must be 60+ FPS. Data fetching must be non-blocking (async Rust).
- **Aesthetic:** Monochrome professional. Black/White/Grays + Light Blue (`#3b82f6`) accent.
- **Architecture:** Hybrid — Rust handles state, security, and DB logic. React/TypeScript handles rendering and state sync.

## Technical Stack
- **Framework:** Tauri v2
- **Backend:** Rust + `sqlx` (async Postgres) + `tokio`
- **Frontend:** React + Vite + TypeScript + Tailwind CSS v4
- **Data Grid:** TanStack Table + `@tanstack/react-virtual`
- **Icons:** Lucide React

## Development Standards
- **Error Handling:** Never `panic!` in Rust. Return `Result<T, E>` and map errors to user-friendly strings for the UI.
- **Code Style:**
  - Rust: `cargo fmt` + `cargo clippy` (pedantic).
  - TS: Functional components with hooks. No class components.
- **Security:** No `dangerous_disable_table_check`. Validate SQL inputs or use parameterized queries where applicable.
- **Optimization:** Virtualize large data grids. Use `React.memo` where it prevents unnecessary re-renders.

---

## Features

### Connection Management
- [x] Add new connections (name, host, port, user, password, database, SSL)
- [x] Edit existing connections
- [x] Remove connections
- [x] Connect / disconnect
- [x] System keychain password storage (`keyring-rs`)
- [x] Auto-load connections from `~/.config/bestgres/connections/*.json` on startup
- [x] Multi-database support — detect all databases on a server, pool reuse per database
- [x] Auto-save connections — adding/editing persists as JSON in `~/.config/bestgres/connections/`, removing deletes the file
- [x] Connection health indicator — green/red dot in sidebar showing if connection is alive

### Schema Browsing
- [x] Sidebar tree: Connection > Databases > Tables / Views
- [x] Column metadata (name, type, nullable, primary key) via `information_schema`
- [x] Column data types shown as subtitles in table headers
- [x] Table structure / DDL view — dedicated tab showing columns with types/defaults, indexes, constraints, and foreign keys

### Table Browser
- [x] Paginated loading (100 rows per page, "Load more" button)
- [x] Total row count shown alongside loaded count
- [x] Virtualized rows (`@tanstack/react-virtual`) for smooth scrolling
- [x] Stable column widths (no horizontal jitter on scroll)
- [x] NULL display (italic muted placeholder)
- [x] JSON/JSONB columns rendered as `JSON.stringify` instead of `[object Object]`
- [x] **Inline cell editing** — click a cell to edit its value, save with Enter, cancel with Escape
- [x] **Add new row** — button to insert a blank row, fill in values, and INSERT
- [x] **Delete row(s)** — select one or more rows and delete them
- [x] **Column sorting** — click column header to sort ASC/DESC
- [x] **Column filtering** — filter input per column or a WHERE clause helper
- [ ] **Copy cell / row** — right-click to copy a cell value, or copy an entire row as JSON
- [ ] **Data export** — export table data or query results to CSV, JSON, or SQL INSERT statements

### Query Editor
- [x] Free-form SQL textarea with Ctrl+Enter to execute
- [x] Results in virtualized data grid
- [x] Row count and execution time stats
- [x] JSON/JSONB display fix
- [ ] **SQL syntax highlighting** — keyword coloring via CodeMirror or lightweight highlighter
- [ ] **Query history** — persist executed queries to `~/.config/bestgres/history/`, recall and re-run from a list
- [ ] **Saved / favorite queries** — name and save useful queries to `~/.config/bestgres/queries/`, accessible from sidebar or command palette
- [ ] **Data export** — export query results to CSV, JSON, or SQL INSERT statements

### Tab System
- [x] Multi-tab interface (table browser + query editor tabs)
- [x] Tab deduplication for table browsers
- [x] Right-click context menu: Close / Close Others / Close to the Right / Close All

### Theming
- [x] Light / dark mode toggle
- [x] Persisted in `localStorage`, respects OS `prefers-color-scheme`
- [x] Class-based dark mode with CSS variable tokens in Tailwind v4 `@theme`

### UX & Polish
- [ ] **Toast notifications** — success/failure feedback for connections, edits, exports, errors
- [ ] **Keyboard shortcuts** — Ctrl+T new query, Ctrl+W close tab, Ctrl+Tab switch tabs, Ctrl+S save edits

### Build & Packaging
- [x] Tauri v2 build producing deb and rpm bundles
- [x] AppImage support — build with `APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri build`

---

## Project Structure
```
bestgres/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── commands/           # Tauri IPC commands
│   │   │   ├── connection.rs   # Connection CRUD, pools, keychain
│   │   │   └── query.rs        # Schema, columns, query execution
│   │   ├── db/
│   │   │   └── postgres.rs     # sqlx wrappers (pool, query, introspection)
│   │   ├── models.rs           # Shared data structures (serde)
│   │   ├── lib.rs              # Tauri app setup, command registration
│   │   └── main.rs             # Entry point
│   └── Cargo.toml
├── src/                        # React frontend
│   ├── components/
│   │   ├── ConnectionDialog.tsx
│   │   ├── DataGrid.tsx        # Virtualized table
│   │   ├── QueryEditor.tsx
│   │   ├── Sidebar.tsx         # Connection + schema tree
│   │   ├── TableBrowser.tsx    # Paginated table viewer
│   │   └── TabManager.tsx      # Tab bar + context menu
│   ├── hooks/
│   │   ├── use-invoke.ts       # Generic Tauri invoke wrapper
│   │   └── use-theme.ts        # Light/dark toggle
│   ├── types.ts                # Shared TS interfaces
│   ├── globals.css             # Tailwind v4 theme tokens
│   └── App.tsx                 # Root layout + state
├── vite.config.ts
├── package.json
└── GUIDE.md
```
