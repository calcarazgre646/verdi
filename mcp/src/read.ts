// Read + discovery module (open core). SELECT-only access to JDE World physical
// files plus catalog / data-dictionary discovery. No mutation happens here.
import { assertReadOnly, julianToIso } from "./jde.js";
import { text, type Ctx, type ToolModule } from "./module.js";

export function readModule(ctx: Ctx): ToolModule {
  const { db, cfg } = ctx;

  // Optional strict discovery mode (opt-in, not the happy path): require
  // jde_describe_file before a JDE file can be queried. Session state lives for
  // the server's lifetime. The check fails CLOSED: an unconfirmed file is refused.
  const STRICT = /^(on|true|1|yes)$/i.test(process.env.JDE_STRICT_DISCOVERY || "");
  const described = new Set<string>();
  const jdeFilesIn = (sql: string) => {
    const out = new Set<string>();
    for (const m of (sql || "").toUpperCase().matchAll(/\bF\d[0-9A-Z]{2,}\b/g)) out.add(m[0]);
    return [...out];
  };

  // Data Dictionary spec for a data item (display decimals + date flag).
  // Same source as jde_data_dictionary so JDE_DD_QUERY overrides apply uniformly.
  const ddQuery = () =>
    process.env.JDE_DD_QUERY ||
    `SELECT DTAI AS data_item, DTDESC AS description, DTDT AS data_type, ` +
      `DTDS AS size, DTDD AS display_decimals FROM ${cfg.dataLib}.F9210 WHERE DTAI = ?`;

  // A JDE physical column is uppercase, no underscore (2-char prefix + data item).
  // Computed/aggregate columns should be aliased with an underscore (AS total_qty)
  // or a short name to opt out of resolution.
  const isJdeField = (n: string) => /^[A-Z][A-Z0-9]{2,}$/.test(n);

  // Resolve a raw result set against the Data Dictionary so the agent never
  // receives a bare, ambiguous JDE number. Correctness is forced by the tool:
  // Julian dates become ISO, implied decimals are applied, and any numeric column
  // we cannot resolve is wrapped as {raw, unresolved:true} (never a plain number).
  async function resolveResult(r: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number }, sql: string) {
    const cache = new Map<string, { found: boolean; decimals: number; isDate: boolean }>();
    const specOf = async (di: string) => {
      if (cache.has(di)) return cache.get(di)!;
      let spec = { found: false, decimals: 0, isDate: false };
      try {
        const dd = await db.read(ddQuery(), [di]);
        if (dd.rowCount) {
          const row: any = dd.rows[0];
          const dt = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
          spec = {
            found: true,
            decimals: Number(row.display_decimals ?? row.DISPLAY_DECIMALS ?? 0) || 0,
            isDate: /date|julian/.test(dt),
          };
        }
      } catch {
        /* DD unreachable -> treat as not found (fail safe: numbers get flagged) */
      }
      cache.set(di, spec);
      return spec;
    };

    const specs: Record<string, { di: string; found: boolean; decimals: number; isDate: boolean }> = {};
    for (const name of r.columns) {
      const di = name.length > 2 ? name.slice(2) : name;
      const s = await specOf(di);
      specs[name] = { di, ...s };
    }

    const wrapped = new Set<string>();
    const rows = r.rows.map((row) => {
      const o: Record<string, unknown> = {};
      for (const name of r.columns) {
        const v = row[name];
        const s = specs[name];
        const empty = v === null || v === undefined || v === "";
        if (s.found && s.isDate) o[name] = empty ? v : julianToIso(Number(v));
        else if (s.found && s.decimals > 0) o[name] = empty ? v : Number(v) / Math.pow(10, s.decimals);
        else if (s.found) o[name] = v; // 0-decimal numeric or code: as stored
        else if (isJdeField(name) && typeof v === "number" && Number.isInteger(v)) {
          o[name] = { raw: v, unresolved: true };
          wrapped.add(name);
        } else o[name] = v; // text or non-JDE/computed column: pass through
      }
      return o;
    });

    const columns = r.columns.map((name) => {
      const s = specs[name];
      let resolution: string;
      if (s.found && s.isDate) resolution = "julian->ISO";
      else if (s.found && s.decimals > 0) resolution = `decimal(${s.decimals})`;
      else if (s.found) resolution = "asis";
      else if (wrapped.has(name)) resolution = "unresolved";
      else resolution = "asis";
      return { name, dataItem: s.di, resolution };
    });

    // Read-side safety: the equivalent of the write tier's approval gate is
    // surfacing uncertainty so the agent cannot hand a human a confident-but-wrong
    // figure. We can flag the risk in-band; we cannot force the agent's wording.
    const warnings: string[] = [];
    if (wrapped.size) {
      warnings.push(
        `Unresolved column(s): ${[...wrapped].join(", ")}. Returned as {raw, unresolved:true} and MUST NOT be reported as values. Resolve the data item or set JDE_DD_QUERY; alias computed columns with an underscore (e.g. AS total_qty) to opt out.`
      );
    }
    if (r.rowCount === 0) {
      warnings.push(
        "Zero rows returned. This is ABSENCE of data, not a business zero. Do not report 0 as a figure; say the query matched nothing and check the filters."
      );
    }
    if (/\b(SUM|AVG)\s*\(/i.test(sql || "")) {
      warnings.push(
        "Aggregate (SUM/AVG) computed in SQL over stored values. Verify the decimal scale before reporting: columns can carry different implied decimals, and summing across them is meaningless. Prefer resolving per-row, then aggregating."
      );
    }
    const out: Record<string, unknown> = { mode: db.mode, rowCount: r.rowCount, columns, rows };
    if (warnings.length) {
      out.warnings = warnings;
      out.reporting =
        "Before giving any of these figures to a human, surface the caveat. Never present an unresolved, aggregated-unverified, or empty result as a certain number.";
    }
    return out;
  }

  const tools = [
    {
      name: "jde_query",
      description:
        "Run a read-only SQL SELECT against DB2 for i (JDE World physical files). " +
        "Remember: dates are Julian (CYYDDD), many numerics carry implied decimals. " +
        "Qualify files with the data library, e.g. SELECT * FROM JDFDATA.F4101.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "A single SELECT or WITH statement." },
          params: { type: "array", description: "Optional positional bind params.", items: {} },
        },
        required: ["sql"],
      },
    },
    {
      name: "jde_list_files",
      description:
        "Discover which physical files exist in the data library. Filter by name pattern (SQL LIKE, e.g. 'F42%' for Sales) before assuming any file name. Use this FIRST on an unfamiliar install.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "SQL LIKE pattern over the file name, e.g. 'F41%'. Default '%'." },
        },
      },
    },
    {
      name: "jde_data_dictionary",
      description:
        "Look up a JDE data item in the Data Dictionary: description, type, size and DISPLAY DECIMALS. " +
        "Critical for numbers: a stored integer (e.g. 125000) means 12.5000 when the item has 4 display decimals. " +
        "Always check before interpreting or summing a numeric field.",
      inputSchema: {
        type: "object",
        properties: {
          dataItem: { type: "string", description: "Data item code, e.g. 'AA' (amount), 'UPRC' (unit price), 'AN8'." },
        },
        required: ["dataItem"],
      },
    },
    {
      name: "jde_describe_file",
      description:
        "Describe a JDE World physical file: columns, types, lengths and text from the catalog. " +
        "Use before querying an unfamiliar file (F0101 Address Book, F4101 Item Master, F4211 Sales Order Detail, F0911 Account Ledger, ...).",
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", description: "File name, e.g. F4101." } },
        required: ["file"],
      },
    },
  ];

  const handlers = {
    async jde_query(args: any) {
      assertReadOnly(args.sql);
      if (STRICT) {
        const missing = jdeFilesIn(args.sql).filter((f) => !described.has(f));
        if (missing.length) {
          throw new Error(
            `strict discovery: call jde_describe_file for ${missing.join(", ")} before querying (so layouts and decimals are confirmed, not assumed).`
          );
        }
      }
      const r = await db.read(args.sql, args.params);
      // Force correctness: numbers come back DD-resolved or flagged, never bare,
      // plus read-side caveats (empty result, SQL aggregates) so a human is never
      // handed a confident-but-wrong figure.
      return text(await resolveResult(r, args.sql));
    },
    async jde_list_files(args: any) {
      const pattern = String(args.pattern ?? "%");
      const sql =
        `SELECT TABLE_NAME AS FILE FROM QSYS2.SYSTABLES ` +
        `WHERE TABLE_SCHEMA = '${cfg.dataLib}' AND TABLE_NAME LIKE ? ` +
        `ORDER BY TABLE_NAME FETCH FIRST 500 ROWS ONLY`;
      const r = await db.read(sql, [pattern]);
      return text({ library: cfg.dataLib, pattern, count: r.rowCount, files: r.rows.map((x: any) => x.FILE) });
    },
    async jde_data_dictionary(args: any) {
      const item = String(args.dataItem).toUpperCase().replace(/[^A-Z0-9]/g, "");
      // The DD spec file/columns vary by install. Override the whole query with
      // env JDE_DD_QUERY (one '?' bound to the data item). Default is a
      // documented convention to be mapped on a live install / the E1 trial.
      const sql =
        process.env.JDE_DD_QUERY ||
        `SELECT DTAI AS data_item, DTDESC AS description, DTDT AS data_type, ` +
          `DTDS AS size, DTDD AS display_decimals FROM ${cfg.dataLib}.F9210 WHERE DTAI = ?`;
      try {
        const r = await db.read(sql, [item]);
        if (!r.rowCount) return text({ dataItem: item, found: false, note: "not in data dictionary" });
        const spec: any = r.rows[0];
        return text({
          dataItem: item,
          found: true,
          ...spec,
          hint:
            Number(spec.display_decimals ?? spec.DISPLAY_DECIMALS ?? 0) > 0
              ? `stored integer / 10^${spec.display_decimals} = display value`
              : "no implied decimals",
        });
      } catch (e: any) {
        return text({ dataItem: item, found: false, error: String(e?.message ?? e), note: "DD file/columns not reachable; set JDE_DD_QUERY for this install" });
      }
    },
    async jde_describe_file(args: any) {
      const file = String(args.file).toUpperCase().replace(/[^A-Z0-9_]/g, "");
      const sql =
        `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, COLUMN_TEXT ` +
        `FROM QSYS2.SYSCOLUMNS WHERE TABLE_NAME = '${file}' AND TABLE_SCHEMA = '${cfg.dataLib}' ` +
        `ORDER BY ORDINAL_POSITION`;
      const r = await db.read(sql);
      described.add(file); // satisfies strict discovery for subsequent jde_query
      return text({ file, library: cfg.dataLib, columns: r.rows });
    },
  };

  return { tools, handlers };
}
