# Bestgres

Minimalist PostgreSQL Explorer built with Tauri v2, React, and TypeScript.

## Stack

- **Framework:** Tauri v2
- **Backend:** Rust + sqlx (async Postgres) + tokio
- **Frontend:** React + Vite + TypeScript + Tailwind CSS v4
- **UI Components:** shadcn/ui (Radix UI based)
- **Data Grid:** TanStack Table with virtualization
- **Icons:** Lucide React

## Development

```bash
# Install dependencies
npm install

# Run in development mode (starts both Vite dev server and Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

## Troubleshooting

**proc-macro error in IDE** (`Cannot create expander for libtauri_macros-*.so`):

1. Fix build: `npm run tauri:clean` then `npm run tauri dev`
2. Fix IDE (rust-analyzer): `Ctrl+Shift+P` → **"rust-analyzer: Restart Server"** (or **"Developer: Reload Window"**)

## Project Structure

```
bestgres/
├── src-tauri/               # Rust Backend
│   ├── src/
│   │   ├── commands/        # Tauri IPC commands (query.rs, connection.rs)
│   │   ├── db/              # Postgres logic (sqlx wrappers)
│   │   ├── models.rs        # Shared data structures
│   │   └── main.rs          # App entry
│   └── Cargo.toml
├── src/                     # React Frontend
│   ├── components/
│   │   ├── ui/              # shadcn primitives
│   │   ├── Sidebar.tsx      # Schema & Connection tree
│   │   ├── TabManager.tsx   # Multi-tab logic
│   │   └── DataGrid.tsx     # Virtualized table view
│   ├── hooks/               # Custom hooks for DB interaction
│   ├── lib/                 # Utilities (cn, etc.)
│   └── App.tsx              # Main Layout
└── package.json
```
