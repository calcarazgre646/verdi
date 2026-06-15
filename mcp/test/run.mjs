#!/usr/bin/env node
// Reproducible end-to-end test of the read-only open core over stdio (SQLITE).
// Verifies the read + discovery surface and that no write tools exist.
//   node test/run.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dbPath = resolve(root, "test", "jde-test.sqlite");
for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
execFileSync("node", [resolve(root, "scripts/seed-sqlite.mjs"), dbPath], { stdio: "inherit" });

let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? "PASS" : "FAIL") + " - " + label); cond ? pass++ : fail++; };

function boot(extraEnv) {
  const srv = spawn("node", [resolve(root, "dist/index.js")], {
    env: { ...process.env, JDE_MODE: "SQLITE", JDE_SQLITE_PATH: dbPath, JDE_DATA_LIB: "JDFDATA", ...extraEnv },
  });
  srv.stderr.on("data", () => {});
  let buf = "";
  const pend = [];
  srv.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      const m = JSON.parse(l);
      const p = pend.find((x) => x.id === m.id);
      if (p) { pend.splice(pend.indexOf(p), 1); p.r(m); }
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((r) => { const i = ++id; pend.push({ id: i, r }); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
  return { rpc, tool: (name, args) => rpc("tools/call", { name, arguments: args }), close: () => srv.kill() };
}
const J = (r) => JSON.parse(r.result.content[0].text);

const s = boot({});
await s.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });

// Only read + discovery tools exist; no write surface in the open core.
const names = (await s.rpc("tools/list", {})).result.tools.map((t) => t.name);
ok(names.length === 4 && names.includes("jde_query") && names.includes("jde_data_dictionary"), "exposes exactly the 4 read/discovery tools: " + names.join(", "));
ok(!names.includes("jde_stage_zfile") && !names.includes("jde_audit_log"), "no write tools present");

// discovery
ok(J(await s.tool("jde_list_files", { pattern: "F42%" })).files.includes("F4211"), "jde_list_files discovers files");
ok(J(await s.tool("jde_describe_file", { file: "F4211" })).columns.some((c) => c.COLUMN_NAME === "SDDOCO"), "jde_describe_file returns real columns");
const dd = J(await s.tool("jde_data_dictionary", { dataItem: "UPRC" }));
ok(dd.found && dd.display_decimals === 4, "jde_data_dictionary resolves display decimals (125000 -> 12.5000)");

// read + guard
ok(J(await s.tool("jde_query", { sql: "SELECT SDDOCO FROM JDFDATA.F4211 WHERE SDAN8=4242 AND SDNXTR<'999'" })).rowCount === 1, "jde_query reads open sales order");
ok((await s.tool("jde_query", { sql: "DELETE FROM JDFDATA.F4211" })).result.isError, "read-only guard blocks DELETE");

// FORCING FUNCTION: numbers come back resolved or flagged, never bare.
const q = J(await s.tool("jde_query", { sql: "SELECT SDTRDJ, SDUPRC, SDUORG + 0 AS AVAIL FROM JDFDATA.F4211 WHERE SDDOCO=501001 AND SDLNID=1" }));
const row = q.rows[0];
ok(row.SDTRDJ === "2026-06-15", "Julian date auto-resolved to ISO (126166 -> 2026-06-15): " + row.SDTRDJ);
ok(row.SDUPRC === 12.5, "implied decimals applied (125000 -> 12.5 via UPRC=4): " + row.SDUPRC);
ok(row.AVAIL && row.AVAIL.unresolved === true, "column with no DD entry is wrapped {raw,unresolved}, not a bare number: " + JSON.stringify(row.AVAIL));
ok(Array.isArray(q.warnings) && q.warnings.length > 0, "unresolved column raises a warning");
const byName = Object.fromEntries(q.columns.map((c) => [c.name, c.resolution]));
ok(byName.SDTRDJ === "julian->ISO" && byName.SDUPRC === "decimal(4)" && byName.AVAIL === "unresolved", "column provenance is reported: " + JSON.stringify(byName));

// with no DD reachable, numbers must NOT come back bare (fail safe)
const noDD = boot({ JDE_DD_QUERY: "SELECT 1 AS display_decimals, 'x' AS data_type WHERE 1=0" });
await noDD.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
const q2 = J(await noDD.tool("jde_query", { sql: "SELECT SDUPRC FROM JDFDATA.F4211 WHERE SDDOCO=501001 AND SDLNID=1" }));
ok(q2.rows[0].SDUPRC && q2.rows[0].SDUPRC.unresolved === true, "no DD configured -> numeric value flagged unresolved, never bare");
noDD.close();

// a write tool name is rejected cleanly
ok((await s.tool("jde_stage_zfile", { zfile: "F0911Z1", idempotencyKey: "x", record: { ZDAA: 1 } })).result.isError, "write tool name rejected in open core");

s.close();
console.log("\n=== " + pass + " PASS / " + fail + " FAIL ===");
process.exit(fail ? 1 : 0);
