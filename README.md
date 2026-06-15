<p align="center">
  <img src="assets/logo.svg" alt="Verdi" width="120" height="120" />
</p>

# Verdi (open core)

**Verdi** is an MCP server for **JD Edwards World** (IBM i / DB2 for i).

[![CI](https://github.com/calcarazgre646/verdi/actions/workflows/ci.yml/badge.svg)](https://github.com/calcarazgre646/verdi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

A Claude Code plugin and MCP server that teaches any agent to **read and explore
JD Edwards World** (IBM i / DB2 for i): query physical files via SQL and discover
an install's layout and Data Dictionary at runtime. Read-only and safe by design.

> Controlled writes (Z-file staging, batch processing, approval gate, audit log)
> are a separate proprietary module and are **not** part of this open core. See
> "Controlled writes" below.

## What's inside

```
.claude-plugin/plugin.json   plugin manifest + MCP server registration
mcp/                         MCP server over DB2 for i (Mapepire)
skills/
  verdi-foundations/     conventions every agent must know
  verdi-discovery/       learn an unfamiliar install at runtime (no hardcoded layouts)
  verdi-read/            SQL recipes by domain
docs/
  E1-TRIAL-SANDBOX.md        stand up a free JDE sandbox to validate, no client needed
```

## MCP tools

| Tool | Purpose |
|------|---------|
| `jde_query` | read-only SELECT against physical files (SELECT/WITH only) |
| `jde_list_files` | discover which files exist (catalog search) |
| `jde_data_dictionary` | data item spec + DISPLAY decimals |
| `jde_describe_file` | columns/types/text from the catalog |

The server is read-only: `jde_query` rejects anything but `SELECT`/`WITH`.

## Setup

```bash
cd mcp
npm install
npm run build
npm test          # 7/7 against a real local SQLite DB, no IBM i needed
```

### DEMO mode (no IBM i needed)

```bash
JDE_MODE=DEMO node mcp/dist/index.js
```

### SQLITE mode (real DB, self-test)

Prove the engine on your own machine against a real database shaped like a JDE
World data library. The library is ATTACHed under its name, so the SQL is
byte-identical to production (`JDFDATA.F4101`).

```bash
node mcp/scripts/seed-sqlite.mjs jdfdata.sqlite
JDE_MODE=SQLITE JDE_SQLITE_PATH=jdfdata.sqlite JDE_DATA_LIB=JDFDATA node mcp/dist/index.js
```

### LIVE mode (real IBM i)

Requires a reachable Mapepire daemon on the IBM i (default port 8076).

```bash
export JDE_MODE=LIVE
export JDE_HOST=your-ibmi-host
export JDE_USER=...           # a profile with read authority on the data library
export JDE_PASSWORD=...
export JDE_DATA_LIB=JDFDATA   # your environment's data library
```

## Key JDE World conventions (see skills/)

- **Julian dates** (`CYYDDD`): most date columns are numbers; `126166` is 2026-06-15.
- **Implied decimals**: a column's scale is often 0; the real display decimals live
  in the Data Dictionary. Use `jde_data_dictionary` before trusting a number.
- **Field naming**: 2-char file prefix + data item (`ABAN8` -> data item `AN8`).
- **Discover, do not assume**: `jde_list_files` -> `jde_describe_file` ->
  `jde_data_dictionary` before querying an unfamiliar install.

## Controlled writes (proprietary add-on)

This open core is read-only. Writing to JDE World safely (via inbound Z-file
interface tables, with idempotency, a payload-bound approval gate, and an
immutable audit log) is provided by a separate proprietary module that mounts
onto this core. Contact Carlos Alcaraz Gregor for the controlled-write module.

## License

Apache License 2.0. Copyright 2026 Carlos Alcaraz Gregor. See `LICENSE` and `NOTICE`.
