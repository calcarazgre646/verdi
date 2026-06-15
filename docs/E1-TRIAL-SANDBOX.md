# Free JDE sandbox for validation (EnterpriseOne 9.2 Trial Edition)

You cannot get a free JD Edwards **World** instance (World needs IBM i + a
license). But Oracle ships a **free EnterpriseOne 9.2 Trial Edition** you can
stand up yourself, with zero involvement from any client. This doc explains what
it is good for, what it is not, and how to use it to harden this plugin.

## What it validates (and what it does NOT)

EnterpriseOne (E1) is **not** World. E1 is web/Java on a relational DB; World is
green-screen on IBM i / DB2 for i. They share heritage, so the trial is a strong
**proxy for the data model**, not a replica of World.

| Validates with the E1 trial | Still needs a real World box |
|---|---|
| File numbers and the data-item model (`AN8`, `ITM`, ...) | World-only files and IBM i specifics |
| A **real Data Dictionary** (display decimals, types) | DB2-for-i transport (Mapepire / jt400) |
| Z-file / inbound interface concepts | World's exact Z-file field contracts |
| Reads/writes against genuine JDE tables | The proprietary batch processor programs |

Note the known divergence: World A/R is `F0311`, E1 is `F03B11`. Treat the trial
as "mostly right", confirm World deltas against the public World docs.

## Prerequisites

- An Oracle Cloud (OCI) account. New accounts get free credits (enough for a
  short-lived trial VM). AWS Marketplace has an equivalent image.
- The trial deploys a compute instance running the E1 stack plus its database
  (Oracle Database by default), with the **Pristine (PS920)** environment.

## Stand it up

1. In the OCI Marketplace, search **"JD Edwards EnterpriseOne Trial Edition"** and
   launch the stack (Resource Manager one-click deploy). Follow Oracle's workshop
   PDF for the current screens (UI changes over time):
   - https://www.oracle.com/a/ocom/docs/corporate/jd-edwards-oci-trial-edition-workshop.pdf
   - https://www.oracle.com/webfolder/technetwork/tutorials/jdedwards/test/Revision_06/jde_enterpriseone_9.2_trial.html
2. After provisioning you get the E1 web client URL and the DB connection details
   (host, port 1521, service, schema). Keep the DB credentials: that is what we
   use, not the web UI.

## Use it to harden this plugin

You do NOT need the MCP to talk to the trial live. The highest-value use is to
**extract ground truth** from it once:

1. **Export the Data Dictionary** so `jde_data_dictionary` matches reality. Query
   the trial's DD spec table and capture, per data item: description, type, size,
   and **display decimals**. Map that SELECT into `JDE_DD_QUERY` and rebuild the
   SQLite fixtures from the real shape.
2. **Confirm real file layouts** for the files you will operate (`F4211`, `F0911`,
   the `*Z1` interfaces). Replace the toy fixture columns with the real ones.
3. **Validate the Z-file write path** against a real interface table: stage a
   record, run the matching E1 UBE, read the processed/error flags. This proves
   the four-step protocol against genuine JDE, short of World's IBM i.

### Optional: point the MCP at the trial live

The trial DB is **Oracle Database**, not DB2 for i, so a live connection needs an
Oracle backend (`oracledb`) instead of Mapepire. The tool surface, guards and
skills are unchanged; only `mcp/src/db.ts` gains a third live driver. Ask for the
`oracledb` backend if you want a live end-to-end against the trial.

## The honest boundary

The trial closes the gap on the **data model, the Data Dictionary, and the
write-via-interface logic**. It does not close the last mile that is World-only:
DB2-for-i transport and the proprietary World batch programs. Those are validated
only against a real World install, which in practice arrives at the client.
Everything reachable without the client, this plugin can now prove.
