---
name: verdi-discovery
description: How to learn an unfamiliar JDE World install at runtime instead of assuming layouts. Use this BEFORE reading or writing on any install you have not mapped: discover files, real columns, and Data Dictionary display decimals from the system itself. Assumes verdi-foundations.
---

# Discover the install; never assume it

JDE installs are customized. File numbers are mostly standard, but exact columns,
text, and especially **display decimals** differ. Do not trust your memory of a
layout. Learn it from the live system in three cheap steps, then operate.

## Step 1: find the file

You rarely need to guess a file name. Search the catalog:

```
jde_list_files { pattern: "F42%" }   -> Sales Order family
jde_list_files { pattern: "F03%" }   -> A/R family (World A/R is F0311, not F03B11)
jde_list_files { pattern: "F%Z1" }   -> inbound interface (Z) files
```

## Step 2: get the real columns

```
jde_describe_file { file: "F4211" }
```

This returns the actual column names, types and lengths from the catalog. Use
these exact names in your SQL. Never paste column names from documentation
without confirming them here first.

## Display decimals are handled for you, not by you

The single most corrupting JDE gotcha (catalog scale is `0`, but the real decimals
live in the Data Dictionary) is resolved automatically by `jde_query`: it shifts
implied decimals and converts Julian dates before returning, and flags anything it
cannot resolve as `{raw, unresolved:true}`. You do not multiply or divide by powers
of ten. `jde_data_dictionary` is for *inspecting* a data item when you want to
understand or document it, not a step you must remember before every read.

```
jde_data_dictionary { dataItem: "UPRC" }  -> unit price, 4 display decimals (for inspection)
```

## The bootstrap rule

For any file you have not used on THIS install:
1. `jde_list_files` to confirm it exists and its exact name.
2. `jde_describe_file` to get real columns.
3. Query it with `jde_query`; trust the resolved values, and never interpret a
   `{raw, unresolved:true}` cell as a number (set `JDE_DD_QUERY` if the install's
   Data Dictionary is not the default).

This makes the plugin portable: it adapts to whatever install it connects to, and
correctness is enforced by the tool rather than relying on the agent to remember.

## Install-specific Data Dictionary

The DD spec file and its columns can vary. If `jde_data_dictionary` reports the
DD is unreachable, the operator can point it at the real spec with the env var
`JDE_DD_QUERY` (a single SELECT with one `?` bound to the data item). Confirm the
real DD shape against the install (or a free EnterpriseOne trial) once; the tools
then work unchanged.
