// DB2 for i access layer for JD Edwards World.
//
// Two backends:
//   - "live": real IBM i via Mapepire (@ibm/mapepire-js), loaded lazily so the
//     server can boot in DEMO without the native dep installed.
//   - "demo": deterministic in-memory fixtures so an agent can learn the tool
//     surface and the Z-file protocol with no IBM i reachable.

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface Db {
  mode: "live" | "demo" | "sqlite";
  // Read-only. The server guarantees only SELECT/WITH reach here.
  read(sql: string, params?: unknown[]): Promise<QueryResult>;
  // Write path. Used ONLY for Z-file staging and next-number reservation,
  // never for direct master-file mutation.
  write(sql: string, params?: unknown[]): Promise<QueryResult>;
  // Run a host command (SBMJOB of a JDE batch processor) via QCMDEXC.
  command(cl: string): Promise<void>;
  close(): Promise<void>;
}

export type AppConfig = ReturnType<typeof getConfig>;

export function getConfig() {
  const raw = (process.env.JDE_MODE || "DEMO").toUpperCase();
  const mode = raw === "LIVE" ? "live" : raw === "SQLITE" ? "sqlite" : "demo";
  return {
    mode,
    host: process.env.JDE_HOST || "",
    port: Number(process.env.JDE_PORT || 8076),
    user: process.env.JDE_USER || "",
    password: process.env.JDE_PASSWORD || "",
    dataLib: process.env.JDE_DATA_LIB || "JDFDATA",
    sqlitePath: process.env.JDE_SQLITE_PATH || "",
  } as const;
}

export async function createDb(): Promise<Db> {
  const cfg = getConfig();
  if (cfg.mode === "live") return createLiveDb(cfg);
  if (cfg.mode === "sqlite") return createSqliteDb(cfg);
  return createDemoDb(cfg);
}

async function createLiveDb(cfg: ReturnType<typeof getConfig>): Promise<Db> {
  // Lazy import keeps DEMO runnable without the dependency present.
  // mapepire-js is CommonJS: under ESM the class hangs off `.default`.
  const mod: any = await import("@ibm/mapepire-js");
  const Pool = mod.Pool ?? mod.default?.Pool;
  const pool = new Pool({
    creds: {
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      ignoreUnauthorized: true,
    },
    maxSize: 5,
    startingSize: 1,
  });
  await pool.init();

  const run = async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    const res: any = params?.length
      ? await pool.execute(sql, { parameters: params })
      : await pool.execute(sql);
    const data: Record<string, unknown>[] = res?.data ?? [];
    const columns = res?.metadata?.columns?.map((c: any) => c.name) ?? Object.keys(data[0] ?? {});
    return { columns, rows: data, rowCount: data.length };
  };

  return {
    mode: "live",
    read: run,
    write: run,
    async command(cl: string) {
      const escaped = cl.replace(/'/g, "''");
      await pool.execute(`CALL QSYS2.QCMDEXC('${escaped}')`);
    },
    async close() {
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite backend. A REAL database you control on your own machine, shaped like
// a JDE World install. The data library is ATTACHed under its name so the
// library-qualified SQL (JDFDATA.F4101) is byte-identical to production.
// The only thing emulated is the batch processor (no SBMJOB on SQLite): running
// a batch flips the staged Z-file rows' EDSP flag to 'Y', mirroring a post.
// ---------------------------------------------------------------------------
async function createSqliteDb(cfg: ReturnType<typeof getConfig>): Promise<Db> {
  const { DatabaseSync } = await import("node:sqlite");
  const path = cfg.sqlitePath;
  if (!path) throw new Error("JDE_MODE=SQLITE requires JDE_SQLITE_PATH (run scripts/seed-sqlite.mjs first)");
  const db = new (DatabaseSync as any)(":memory:");
  db.exec(`ATTACH DATABASE '${path.replace(/'/g, "''")}' AS ${cfg.dataLib}`);

  const cols = (rows: any[]) => (rows.length ? Object.keys(rows[0]) : []);

  const read = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    const upper = sql.toUpperCase();
    // Translate the catalog query used by jde_describe_file to a PRAGMA.
    const m = upper.match(/SYSCOLUMNS[\s\S]*TABLE_NAME\s*=\s*'([A-Z0-9_]+)'/);
    if (m) {
      const info: any[] = db.prepare(`PRAGMA ${cfg.dataLib}.table_info(${m[1]})`).all();
      const rows = info.map((c) => ({
        COLUMN_NAME: c.name,
        DATA_TYPE: c.type,
        LENGTH: null,
        NUMERIC_SCALE: null,
        COLUMN_TEXT: "",
      }));
      return { columns: cols(rows), rows, rowCount: rows.length };
    }
    // Translate the catalog query used by jde_list_files to sqlite_master.
    if (upper.includes("SYSTABLES")) {
      const rows: any[] = db
        .prepare(`SELECT name AS FILE FROM ${cfg.dataLib}.sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name`)
        .all(...params);
      return { columns: cols(rows), rows, rowCount: rows.length };
    }
    // DB2-for-i 'FETCH FIRST n ROWS ONLY' -> SQLite 'LIMIT n'.
    const portable = sql.replace(/FETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY/i, "LIMIT $1");
    const rows: any[] = db.prepare(portable).all(...params);
    return { columns: cols(rows), rows, rowCount: rows.length };
  };

  const write = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    const r: any = db.prepare(sql).run(...params);
    return { columns: [], rows: [], rowCount: Number(r.changes ?? 0) };
  };

  return {
    mode: "sqlite",
    read,
    write,
    async command(cl: string) {
      // Local emulator of the JDE batch processor: extract the batch key and
      // mark every staged Z-file row for that batch as posted (EDSP='Y').
      const m = cl.match(/'([^']+)'/);
      const batch = m?.[1];
      if (!batch) return;
      const tables: any[] = db
        .prepare(`SELECT name FROM ${cfg.dataLib}.sqlite_master WHERE type='table' AND name LIKE 'F%Z%'`)
        .all();
      for (const t of tables) {
        db.prepare(`UPDATE ${cfg.dataLib}.${t.name} SET EDSP='Y' WHERE EDBT = ?`).run(batch);
      }
    },
    async close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// DEMO backend. Tiny slice of a JDE World install with the canonical files.
// ---------------------------------------------------------------------------
function createDemoDb(cfg: ReturnType<typeof getConfig>): Db {
  const staged: Record<string, Record<string, unknown>[]> = {};
  let nextNo = 100000;

  const itemMaster = [
    { IMITM: 60001, IMLITM: "JEAN-ACM-32", IMDSC1: "Acme Slim Jean 32", IMSRP1: "ACM" },
    { IMITM: 60002, IMLITM: "JEAN-GLX-34", IMDSC1: "Globex Brooklyn Jean 34", IMSRP1: "GLX" },
  ];
  const itemLoc = [
    { LIITM: 60001, LIMCU: "  TIENDA01", LILOTN: "", LIPQOH: 4200, LIPCOM: 200 },
    { LIITM: 60002, LIMCU: "  TIENDA01", LILOTN: "", LIPQOH: 1300, LIPCOM: 50 },
  ];
  const addressBook = [
    { ABAN8: 4242, ABALPH: "Acme Distribution SA", ABAT1: "C", ABTAX: "80012345-6" },
  ];

  return {
    mode: "demo",
    async read(sql: string): Promise<QueryResult> {
      const upper = sql.toUpperCase();
      if (upper.includes("SYSCOLUMNS")) {
        // jde_describe_file canned metadata for F4101.
        const rows = [
          { COLUMN_NAME: "IMITM", DATA_TYPE: "DECIMAL", LENGTH: 8, NUMERIC_SCALE: 0, COLUMN_TEXT: "Short Item No (key)" },
          { COLUMN_NAME: "IMLITM", DATA_TYPE: "CHAR", LENGTH: 25, NUMERIC_SCALE: 0, COLUMN_TEXT: "2nd Item No" },
          { COLUMN_NAME: "IMDSC1", DATA_TYPE: "CHAR", LENGTH: 30, NUMERIC_SCALE: 0, COLUMN_TEXT: "Description" },
        ];
        return { columns: Object.keys(rows[0]), rows, rowCount: rows.length };
      }
      if (upper.includes("F0002")) {
        // Next-number read-back: hand out a moving value so the demo posts a real number.
        nextNo += 1;
        return { columns: ["NEXTNO"], rows: [{ NEXTNO: nextNo }], rowCount: 1 };
      }
      let rows: Record<string, unknown>[] = [];
      if (upper.includes("F4101")) rows = itemMaster;
      else if (upper.includes("F41021")) rows = itemLoc;
      else if (upper.includes("F0101")) rows = addressBook;
      return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length };
    },
    async write(sql: string, params: unknown[] = []): Promise<QueryResult> {
      const m = sql.toUpperCase().match(/INTO\s+\S*?(F\w+Z\d?)/);
      const file = m?.[1] ?? "UNKNOWN_ZFILE";
      (staged[file] ||= []).push({ raw: sql, params, _demo: true });
      return { columns: [], rows: [], rowCount: 1 };
    },
    async command(cl: string) {
      // In demo, "running the batch" just marks staged rows processed.
      void cl;
      for (const k of Object.keys(staged)) for (const r of staged[k]) r._processed = true;
    },
    async close() {},
  };
}
