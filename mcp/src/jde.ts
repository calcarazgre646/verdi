// JDE World data conventions encoded as helpers.
// These are the gotchas that silently corrupt data for anyone new to World.

// Julian date: stored as CYYDDD where C = century (0 = 1900s, 1 = 2000s),
// YY = year, DDD = day-of-year. 2026-06-15 -> 126166.
export function isoToJulian(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) throw new Error(`bad ISO date: ${iso}`);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  const day = Math.floor((d.getTime() - start) / 86400000);
  const c = year >= 2000 ? 1 : 0;
  const yy = year % 100;
  return c * 100000 + yy * 1000 + day;
}

export function julianToIso(j: number | string): string {
  const n = Number(j);
  if (!n) return "";
  const c = Math.floor(n / 100000);
  const yy = Math.floor((n % 100000) / 1000);
  const ddd = n % 1000;
  const year = (c === 1 ? 2000 : 1900) + yy;
  const d = new Date(Date.UTC(year, 0, ddd));
  return d.toISOString().slice(0, 10);
}

// Many numeric fields store an implied number of decimals defined in the data
// dictionary, NOT in the column. The raw integer must be shifted to display.
export function applyImpliedDecimals(raw: number, displayDecimals: number): number {
  return raw / Math.pow(10, displayDecimals);
}

// Guard for SQL identifiers (file and column names) that get interpolated, since
// only values can be bound. Fail closed on anything outside the JDE charset.
export function assertIdentifier(name: string, label: string): string {
  if (!/^[A-Za-z0-9_]{1,30}$/.test(name)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(name)}`);
  }
  return name;
}

// Read-only guard. Only SELECT and WITH (CTE) are allowed through jde_query.
export function assertReadOnly(sql: string): void {
  const trimmed = sql.trim().replace(/^\(+/, "").toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(trimmed)) {
    throw new Error("jde_query is read-only: statement must start with SELECT or WITH");
  }
  // Block stacked statements and obvious DML/DDL smuggling.
  if (/;\s*\S/.test(sql)) throw new Error("multiple statements are not allowed");
  if (/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|CALL|GRANT|REVOKE)\b/.test(trimmed)) {
    throw new Error("DML/DDL keyword detected in a read-only query");
  }
}
