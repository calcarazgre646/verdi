#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createDb, getConfig } from "./db.js";
import { readModule } from "./read.js";
import type { Ctx, ToolModule } from "./module.js";

const cfg = getConfig();

// Read-only by default. The controlled-write overlay (./write.js) is proprietary
// and optional: it loads only when present in the build AND JDE_WRITE=on.
const WRITE_ENABLED = /^(on|true|1|yes)$/i.test(process.env.JDE_WRITE || "");
const WRITE_TOOL_NAMES = ["jde_stage_zfile", "jde_run_batch", "jde_batch_status", "jde_next_number", "jde_audit_log"];

async function main() {
  const db = await createDb();
  const ctx: Ctx = { db, cfg };

  const modules: ToolModule[] = [readModule(ctx)];
  let writeLoaded = false;
  if (WRITE_ENABLED) {
    try {
      // Non-literal specifier so the open-core build (no write.ts) still compiles.
      const spec = "./write.js";
      const mod = await import(spec);
      modules.push(mod.writeModule(ctx));
      writeLoaded = true;
    } catch (e: any) {
      process.stderr.write(`[verdi] JDE_WRITE=on but write module not present (open-core build): ${e?.message ?? e}\n`);
    }
  }

  const tools = modules.flatMap((m) => m.tools);
  const handlers: Record<string, (args: any) => Promise<unknown>> = Object.assign({}, ...modules.map((m) => m.handlers));

  const server = new Server({ name: "verdi", version: "0.3.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const h = handlers[req.params.name];
      if (!h) {
        if (WRITE_TOOL_NAMES.includes(req.params.name)) {
          throw new Error(`${req.params.name} is a controlled-write tool, not available in this read-only deployment (enable JDE_WRITE and install the write module).`);
        }
        throw new Error(`unknown tool: ${req.params.name}`);
      }
      return (await h(req.params.arguments ?? {})) as any;
    } catch (e: any) {
      return { content: [{ type: "text", text: `ERROR: ${e?.message ?? e}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = writeLoaded ? "WRITE" : "READ-ONLY";
  process.stderr.write(`[verdi] MCP up in ${cfg.mode.toUpperCase()} backend, ${mode} (lib ${cfg.dataLib})\n`);
}

main().catch((e) => {
  process.stderr.write(`[verdi] fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
