<p align="center">
  <img src="assets/logo.png" alt="Verdi" width="200" />
</p>

# Verdi (open core)

[![CI](https://github.com/calcarazgre646/verdi/actions/workflows/ci.yml/badge.svg)](https://github.com/calcarazgre646/verdi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**No LLM knows how to read JD Edwards World correctly.** Point a raw agent at a JDE
World database and it returns confidently wrong answers, because the meaning of the
data lives in conventions nobody wrote down in the schema:

- **Dates are Julian integers.** `126166` is 2026-06-15, not a hundred-thousand of anything.
- **Decimals are implied.** A stored `125000` can mean `12.5000`; the real decimal count lives in the Data Dictionary, not the column.
- **Field names are cryptic.** Every column is a 2-char file prefix plus a data item (`ABAN8` = Address Book, Address Number).

That tacit knowledge is exactly what makes querying JDE World by hand a nightmare,
and a plain SQL connection gives an agent none of it. A confidently wrong number
from your ERP is worse than no answer.

**Verdi teaches the agent that knowledge.** It pairs skills that encode the JD
Edwards World conventions with an MCP server that gives safe, read-only SQL access
and runtime discovery of an install's layout and Data Dictionary, so the agent
reads JDE *correctly*. The SQL is the easy part. The encoded knowledge is the product.

> Controlled writes (Z-file staging, batch processing, approval gate, audit log)
> are a separate proprietary module and are not part of this open core.

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

**Read-only is enforced by the database, not by this app.** Run Verdi under an IBM
i profile with read-only (`*USE`) authority on the data library and no write
authority. That object authority is the wall: DB2 itself rejects any write,
whatever SQL arrives. The `jde_query` SELECT/WITH check is a *second layer* and a
clean early error ("Verdi only reads"), not the guarantee. See [SECURITY](docs/SECURITY.md).

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

**Use a profile that has NO write authority on the data library. That object
authority, not this app, is what makes the deployment read-only** (see
[SECURITY](docs/SECURITY.md)).

```bash
export JDE_MODE=LIVE
export JDE_HOST=your-ibmi-host
export JDE_USER=...           # profile with *USE (read) only; no *ADD/*UPD/*DLT on the library
export JDE_PASSWORD=...
export JDE_DATA_LIB=JDFDATA   # your environment's data library
# optional extra layers:
export JDE_INIT_SQL="SET TRANSACTION READ ONLY"  # best-effort session directive, run once at connect (not the guarantee)
export JDE_STRICT_DISCOVERY=on                   # require jde_describe_file before a JDE file can be queried (fails closed)
```

`JDE_INIT_SQL` runs once at connect, best-effort: a write-blocking session
directive independent of the SQL guard. `JDE_STRICT_DISCOVERY` is an opt-in mode
that refuses `jde_query` on any JDE file not yet described in the session. Both
are off by default; neither replaces the profile authority.

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
