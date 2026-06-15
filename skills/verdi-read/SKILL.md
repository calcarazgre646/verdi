---
name: verdi-read
description: Recipes for reading JD Edwards World data via SQL (stock on hand, sales orders, A/P and A/R aging, GL balances, address book). Use when the user asks to query, report, look up, or reconcile anything in JDE World. Assumes verdi-foundations.
---

# Reading JDE World

All reads go through `jde_query` (SELECT/WITH only). Qualify files with the data
library. Convert Julian dates and watch implied decimals (see foundations).

## Before you query an unfamiliar file

Run `jde_describe_file` to get real column names, lengths and text. Do not guess
columns from memory; installs customize.

## Stock on hand by store

`F41021` (Item Location) holds quantities. `PQOH` on hand, `PCOM` committed.

```sql
SELECT LIITM AS item, TRIM(LIMCU) AS store,
       LIPQOH AS on_hand, LIPCOM AS committed,
       LIPQOH - LIPCOM AS available
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

## Reporting discipline

- Convert every Julian column you show a human.
- Apply implied decimals before summing or comparing money/quantities.
- If a join returns zero rows, suspect `MCU`/char padding first.
- A failed read is not zero. Surface the error; never let `?? 0` print a fake
  business number.
