// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { expandHomePath } from "../pathExpansion.ts";

const CONFIG_BLOCK_START = "# BEGIN T3 Code Browser Harness";
const CONFIG_BLOCK_END = "# END T3 Code Browser Harness";
const CONFIG_BLOCK_RE = new RegExp(
  `\\n?${CONFIG_BLOCK_START}[\\s\\S]*?${CONFIG_BLOCK_END}\\n?`,
  "g",
);

export interface BrowserMcpConfig {
  readonly url: string;
  readonly token: string | null;
}

function readBrowserMcpConfigFromEnv(): BrowserMcpConfig | null {
  const url = process.env.T3CODE_BROWSER_MCP_URL?.trim();
  if (!url) {
    return null;
  }
  return {
    url,
    token: process.env.T3CODE_BROWSER_MCP_TOKEN?.trim() || null,
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexBrowserMcpBlock(config: BrowserMcpConfig): string {
  return [
    CONFIG_BLOCK_START,
    "[mcp_servers.t3_browser]",
    `url = ${tomlString(config.url)}`,
    "enabled = true",
    'default_tools_approval_mode = "prompt"',
    "startup_timeout_sec = 10",
    "tool_timeout_sec = 45",
    CONFIG_BLOCK_END,
    "",
  ].join("\n");
}

function resolveCodexHome(homePath: string | undefined): string {
  const configured = homePath?.trim();
  if (configured) {
    return expandHomePath(configured);
  }
  return process.env.CODEX_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".codex");
}

export const ensureCodexBrowserMcpConfig = (homePath: string | undefined): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      const config = readBrowserMcpConfigFromEnv();
      if (!config) {
        return;
      }

      const home = resolveCodexHome(homePath);
      await NodeFS.mkdir(home, { recursive: true });
      const configPath = NodePath.join(home, "config.toml");
      const current = await NodeFS.readFile(configPath, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return "";
        }
        throw error;
      });
      const next = `${current.replace(CONFIG_BLOCK_RE, "").trimEnd()}\n\n${codexBrowserMcpBlock(config)}`;
      if (next !== current) {
        await NodeFS.writeFile(configPath, next, "utf8");
      }
    },
    catch: () => undefined,
  }).pipe(Effect.ignore);

export function mergeOpenCodeBrowserMcpConfig(rawConfig: string | undefined): string {
  const browserConfig = readBrowserMcpConfigFromEnv();
  let base: Record<string, unknown> = {};
  if (rawConfig && rawConfig.trim().length > 0) {
    try {
      base = JSON.parse(rawConfig) as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  if (!browserConfig) {
    return JSON.stringify(base);
  }

  return JSON.stringify({
    ...base,
    mcp: {
      ...((base.mcp && typeof base.mcp === "object" ? base.mcp : {}) as Record<string, unknown>),
      t3_browser: {
        type: "remote",
        url: browserConfig.url,
        enabled: true,
        timeout: 45_000,
        ...(browserConfig.token
          ? {
              headers: {
                Authorization: `Bearer ${browserConfig.token}`,
              },
            }
          : {}),
      },
    },
  });
}
