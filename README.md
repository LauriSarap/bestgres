# Bestgres

A fast, minimal PostgreSQL client built with Tauri v2, React, and Rust.

## Features

**Connections** — Add, edit, remove connections with keychain password storage. Auto-saved to `~/.config/bestgres/`. Health indicator per connection. Multi-database support with pool reuse.

**Schema browser** — Sidebar tree (Connection > Database > Tables/Views). Table structure view with columns, indexes, constraints, and foreign keys.

**Table browser** — Paginated data view with virtualized scrolling. Inline cell editing, row insert/delete, column sorting and filtering. Right-click to copy cell or row as JSON.

**Query editor** — SQL editor with syntax highlighting, Ctrl+Enter to run. Query history and saved/favorite queries persisted to disk.

**Tabs** — Multi-tab interface with deduplication. Right-click context menu (Close, Close Others, Close All). Keyboard shortcuts: Ctrl+T (new query), Ctrl+W (close tab), Ctrl+Tab (switch).

**General** — Light/dark theme with OS detection. Toast notifications for all actions. Builds to deb, rpm, and AppImage.

## Stack

| Layer    | Tech |
|----------|------|
| Framework | Tauri v2 |
| Backend  | Rust, sqlx, tokio |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Data grid | TanStack Table + react-virtual |
| Icons    | Lucide React |

## Development

```bash
npm install
npm run tauri dev       # dev mode
npm run tauri build     # production build (deb, rpm, appimage)
```

## Project Structure

```
src-tauri/src/
├── commands/
│   ├── connection.rs   # Connection CRUD, pools, keychain
│   ├── query.rs        # Schema, columns, query execution, cell updates
│   └── history.rs      # Query history + saved queries (filesystem)
├── db/
│   └── postgres.rs     # sqlx wrappers, introspection, SQL builders
├── models.rs           # Shared data structures
├── lib.rs              # Tauri setup, command registration
└── main.rs

src/
├── components/
│   ├── Sidebar.tsx           # Connection + schema tree
│   ├── TabManager.tsx        # Tab bar + tab content routing
│   ├── TableBrowser.tsx      # Paginated table viewer + editing
│   ├── TableStructureView.tsx# DDL/structure inspector
│   ├── QueryEditor.tsx       # SQL editor + results + history panel
│   ├── SqlEditor.tsx         # Syntax-highlighted textarea
│   ├── DataGrid.tsx          # Virtualized data grid (TanStack)
│   ├── EditableCell.tsx      # Inline cell editor
│   ├── ConnectionDialog.tsx  # Add/edit connection form
│   └── Toast.tsx             # Toast notification system
├── hooks/
│   ├── use-invoke.ts         # Tauri invoke wrapper
│   └── use-theme.ts          # Light/dark toggle
├── types.ts
├── globals.css
└── App.tsx
```
