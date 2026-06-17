import { assert, describe, it } from "@effect/vitest";

import { mergeOpenCodeBrowserMcpConfig } from "./browserMcpConfig.ts";

const ORIGINAL_ENV = {
  T3CODE_BROWSER_MCP_URL: process.env.T3CODE_BROWSER_MCP_URL,
  T3CODE_BROWSER_MCP_TOKEN: process.env.T3CODE_BROWSER_MCP_TOKEN,
};

function withBrowserMcpEnv<A>(fn: () => A): A {
  process.env.T3CODE_BROWSER_MCP_URL = "http://127.0.0.1:49152/mcp?token=query-token";
  process.env.T3CODE_BROWSER_MCP_TOKEN = "header-token";
  try {
    return fn();
  } finally {
    process.env.T3CODE_BROWSER_MCP_URL = ORIGINAL_ENV.T3CODE_BROWSER_MCP_URL;
    process.env.T3CODE_BROWSER_MCP_TOKEN = ORIGINAL_ENV.T3CODE_BROWSER_MCP_TOKEN;
  }
}

describe("browser MCP config", () => {
  it("preserves existing OpenCode config while adding the browser MCP server", () =>
    withBrowserMcpEnv(() => {
      const merged = JSON.parse(
        mergeOpenCodeBrowserMcpConfig(`{
          // local model/provider config must survive injection
          "provider": {
            "local": { "npm": "@ai-sdk/openai-compatible" },
          },
          "model": {
            "local/llama": { "name": "Local Llama" },
          },
        }`),
      );

      assert.equal(merged.provider.local.npm, "@ai-sdk/openai-compatible");
      assert.equal(merged.model["local/llama"].name, "Local Llama");
      assert.equal(merged.mcp.t3_browser.type, "remote");
      assert.equal(merged.mcp.t3_browser.url, "http://127.0.0.1:49152/mcp?token=query-token");
      assert.equal(merged.mcp.t3_browser.headers.Authorization, "Bearer header-token");
    }));

  it("does not overwrite an invalid OPENCODE_CONFIG_CONTENT value", () =>
    withBrowserMcpEnv(() => {
      const raw = "{ not json";
      assert.equal(mergeOpenCodeBrowserMcpConfig(raw), raw);
    }));
});
