// Shared tool-module contract. A ToolModule bundles MCP tool definitions with
// their handlers so the server can compose several modules (read core +
// optional write overlay) without knowing their internals.
import type { Db, AppConfig } from "./db.js";

export interface Ctx {
  db: Db;
  cfg: AppConfig;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolModule {
  tools: ToolDef[];
  handlers: Record<string, (args: any) => Promise<unknown>>;
}

export function text(obj: unknown) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
