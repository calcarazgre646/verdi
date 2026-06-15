---
name: verdi-read
description: Recipes for reading JD Edwards World data via SQL (stock on hand, sales orders, A/P and A/R aging, GL balances, address book). Use when the user asks to query, report, look up, or reconcile anything in JDE World. Assumes verdi-foundations.
---

# Reading JDE World

All reads go through `jde_query` (SELECT/WITH only). Qualify files with the data
library.

## Numbers are resolved for you (do not re-interpret them)

`jde_query` resolves every column against the Data Dictionary before returning, so
you never see a raw, ambiguous JDE number:

- Julian date columns come back as ISO strings (`126166` -> `"2026-06-15"`).
- Implied-decimal columns come back as the real value (`125000` -> `12.5`).
- `columns[].resolution` shows what was applied (`julian->ISO`, `decimal(4)`, `asis`).

**Use the values in `rows` as-is. Never re-shift decimals or re-convert dates; the
tool already did.** If a cell comes back as `{ "raw": N, "unresolved": true }`, the
Data Dictionary had no entry for that column: **do NOT interpret it as a value.**
It also appears in `warnings`. Either the column is computed, or the install's DD
needs `JDE_DD_QUERY` set. Alias computed columns with an underscore (e.g.
`AS available_qty`) so they pass through untouched instead of being flagged.

## Before you query an unfamiliar file

Run `jde_describe_file` to get real column names, lengths and text. Do not guess
columns from memory; installs customize.

## Stock on hand by store

`F41021` (Item Location) holds quantities. `PQOH` on hand, `PCOM` committed.

```sql
SELECT LIITM AS item, TRIM(LIMCU) AS store,
       LIPQOH AS on_hand, LIPCOM AS committed,
       LIPQOH - LIPCOM AS available_qty   -- underscore alias: computed, opts out of DD resolution
FROM JDFDATA.F41021
WHERE LIITM = ?            -- short item number
ORDER BY store
```

Join `F4101` for the description (`IMDSC1`) and second item number (`IMLITM`).

## Open sales orders for a customer

```sql
SELECT SDDOCO AS order_no, SDLNID AS line, SDLITM AS item,
       SDUORG AS qty_ordered, SDSOQS AS qty_shipped,
       SDTRDJ AS order_julian
FROM JDFDATA.F4211
WHERE SDAN8 = ?           -- sold-to address number
  AND SDNXTR < '999'      -- not fully closed (next status)
ORDER BY SDDOCO, SDLNID
```

Translate `SDTRDJ` from Julian to ISO for display.

## A/P open vouchers (what we owe)

```sql
SELECT RPAN8 AS supplier, RPDOC AS voucher, RPDCT AS doc_type,
       RPAAP AS open_amount, RPDDJ AS due_julian
FROM JDFDATA.F0411
WHERE RPPST <> 'P'        -- pay status not Paid
ORDER BY RPDDJ
```

`RPAAP` and money fields carry implied decimals; confirm scale before summing.

## GL account balance for a period

```sql
SELECT GBAID AS account_id, GBLT AS ledger_type,
       GBAPYC AS prior_year, GBAN01 AS period_01_amount
FROM JDFDATA.F0902
WHERE GBFY = ?            -- fiscal year (2-digit)
  AND GBLT = 'AA'         -- actual amounts ledger
```

## Address book lookup

```sql
SELECT ABAN8 AS address_no, TRIM(ABALPH) AS name, ABAT1 AS search_type
FROM JDFDATA.F0101
WHERE ABALPH LIKE ?       -- e.g. 'ACME%'
```

## Reporting discipline (silent harm lives here)

A confident but wrong figure handed to a human who decides on it is real harm,
even though nothing was written. `jde_query` surfaces uncertainty in-band: when a
result has caveats it returns a `warnings` array and a `reporting` directive.
**Honor them when you speak to a human.**

- If `warnings`/`reporting` are present, **state the caveat with the figure.** Do
  not present an unresolved, aggregated-unverified, or empty result as certain.
- Trust the resolved values in `rows`; never re-convert dates or re-shift decimals.
- Never report a `{raw, unresolved:true}` cell as a number. Resolve it first.
- **Zero rows is absence, not a business zero.** Say the query matched nothing and
  check the filters (suspect `MCU`/char padding); never report `0`.
- A failed read is not zero. Surface the error; never let `?? 0` print a fake
  business number.
- When unsure whether a number is trustworthy, say so. "I am not certain, verify"
  is a valid and required answer for an ERP figure.
