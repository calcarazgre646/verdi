// Read + discovery module (open core). SELECT-only access to JDE World physical
// files plus catalog / data-dictionary discovery. No mutation happens here.
import { assertReadOnly } from "./jde.js";
import { text, type Ctx, type ToolModule } from "./module.js";

export function readModule(ctx: Ctx): ToolModule {
  const { db, cfg } = ctx;

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
      const r = await db.read(args.sql, args.params);
      return text({ mode: db.mode, rowCount: r.rowCount, columns: r.columns, rows: r.rows });
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
      return text({ file, library: cfg.dataLib, columns: r.rows });
    },
  };

  return { tools, handlers };
}
