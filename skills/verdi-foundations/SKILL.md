---
name: verdi-foundations
description: Core conventions for reading JD Edwards World on IBM i (file naming, Julian dates, implied decimals, key fields, fast-paths, data library). Read this FIRST before any JDE World query, and whenever a query returns numbers or dates that look wrong.
---

# JDE World foundations

JD Edwards **World** runs on IBM i (AS/400) over **DB2 for i**. Data lives in
**physical files** named `F####`. You reach them with SQL through the `verdi`
MCP. This skill encodes the conventions that silently corrupt data for anyone new.

## The five gotchas that bite everyone

1. **Julian dates (`CYYDDD`).** Almost every date column is a number, not a date.
   `C` = century (0 = 1900s, 1 = 2000s), `YY` = year, `DDD` = day of year.
   `2026-06-15` is stored as `126166`. Never compare a Julian column against an
   ISO string. Use the `jde_*` date helpers / convert in your query.
2. **Implied decimals.** Many numeric fields store an integer; the number of
   decimals lives in the **data dictionary**, not the column. A price stored as
   `12500` may mean `125.00`. Confirm display decimals before trusting a number.
3. **Field naming = 2-char file prefix + data item.** File `F0101` (Address Book)
   prefixes its columns with `AB`: `ABAN8`, `ABALPH`. The **data item** (`AN8`,
   `ALPH`) is what's stable across files. `AN8` (Address Number) is the universal
   key for any entity (customer, supplier, employee, branch).
4. **Blank vs zero.** Char keys are space-padded and case-sensitive; a "missing"
   value is often a blank string, not NULL. Trim and pad deliberately.
5. **Business Unit / branch (`MCU`) is right-justified, 12 chars.** Stores show up
   as `"  TIENDA01"`. Mismatched padding is the #1 reason a join returns nothing.

## Data library

Files are qualified by a **data library** (e.g. `JDFDATA`, production data;
separate libraries exist for each environment). The MCP injects `JDE_DATA_LIB`,
so write `SELECT * FROM JDFDATA.F4101`. Never assume the library; ask or check.

## The files you will actually use

| File | What it is | Key |
|------|-----------|-----|
| `F0002` | Next Numbers | system code `NNSY` |
| `F0101` / `F0116` | Address Book / addresses | `AN8` |
| `F0901` / `F0911` / `F0902` | Account master / ledger / balances | `AID`, account |
| `F0411` | A/P ledger (vouchers) | `AN8`, `DOC` |
| `F0311` | A/R (customer ledger) | `AN8`, `DOC` |
| `F4101` / `F4102` / `F41021` | Item master / branch / location | `ITM`, `MCU` |
| `F4201` / `F4211` | Sales order header / detail | `DOCO` |
| `F4301` / `F4311` | Purchase order header / detail | `DOCO` |
| `F0006` | Business Unit master | `MCU` |

Verify file numbers per install with `jde_describe_file` before trusting them.
World and EnterpriseOne diverge on some files (notably A/R).

## Fast-paths (green-screen menus, for human cross-reference)

When a user describes a screen, map it so you query the right file:
`G42` Sales Order Mgmt, `P4210` Sales Order Entry, `G43` Procurement,
`G09` General Accounting, `P0911` Journal Entries, `G04` Accounts Payable.
You query via SQL, **not** by driving these screens.

## Read-only

This core only **reads**: it queries master files and the catalog. `jde_query`
also refuses non-`SELECT` statements, but that string check is a convenience, not
the guarantee: read-only is enforced by running under an IBM i profile with no
write authority on the data library (see `docs/SECURITY.md`). Writing to JD
Edwards safely is handled by a separate module, not part of this open core.

## Tool map

- `jde_query` read-only SELECT
- `jde_list_files` discover which files exist
- `jde_data_dictionary` data item spec + display decimals
- `jde_describe_file` columns/types/text from the catalog
