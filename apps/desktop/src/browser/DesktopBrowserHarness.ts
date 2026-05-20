// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off anyUnknownInErrorContext:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";

import type {
  DesktopBrowserBoundsInput,
  DesktopBrowserNavigateInput,
  DesktopBrowserStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_SESSION_ID = "t3-browser-session";
const MAX_REQUEST_BYTES = 1_000_000;

interface BrowserElementSnapshot {
  readonly ref: string;
  readonly tag: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly elements: readonly BrowserElementSnapshot[];
}

interface BrowserConsoleEntry {
  readonly level: string;
  readonly message: string;
  readonly line: number;
  readonly sourceId: string;
}

interface BrowserNetworkEntry {
  readonly name: string;
  readonly initiatorType: string;
  readonly duration: number;
  readonly transferSize: number;
}

interface HarnessServerState {
  readonly token: string;
  readonly localUrl: string;
  readonly providerUrl: string;
  readonly server: NodeHttp.Server;
}

export class DesktopBrowserHarnessError extends Data.TaggedError("DesktopBrowserHarnessError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export interface DesktopBrowserHarnessShape {
  readonly start: Effect.Effect<void, DesktopBrowserHarnessError>;
  readonly setBounds: (
    input: DesktopBrowserBoundsInput,
  ) => Effect.Effect<void, DesktopBrowserHarnessError>;
  readonly hide: Effect.Effect<void, DesktopBrowserHarnessError>;
  readonly navigate: (
    input: DesktopBrowserNavigateInput,
  ) => Effect.Effect<DesktopBrowserStatus, DesktopBrowserHarnessError>;
  readonly back: Effect.Effect<DesktopBrowserStatus, DesktopBrowserHarnessError>;
  readonly forward: Effect.Effect<DesktopBrowserStatus, DesktopBrowserHarnessError>;
  readonly reload: Effect.Effect<DesktopBrowserStatus, DesktopBrowserHarnessError>;
  readonly getStatus: Effect.Effect<DesktopBrowserStatus, DesktopBrowserHarnessError>;
}

export class DesktopBrowserHarness extends Context.Service<
  DesktopBrowserHarness,
  DesktopBrowserHarnessShape
>()("t3/desktop/BrowserHarness") {}

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-browser-harness");

function isAllowedBrowserUrl(rawUrl: string): boolean {
  if (rawUrl === "about:blank") {
    return true;
  }
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBrowserUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed === "" || trimmed === "about:blank") {
    return "about:blank";
  }
  const candidate = /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
  return new URL(candidate).toString();
}

function getPrimaryNetworkHost(): string | null {
  for (const entries of Object.values(NodeOS.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

function makeStatus(
  view: Electron.WebContentsView | null,
  harness: HarnessServerState | null,
): DesktopBrowserStatus {
  const webContents = view?.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return {
      url: "about:blank",
      title: "",
      canGoBack: false,
      canGoForward: false,
      harnessUrl: harness?.providerUrl ?? null,
    };
  }

  return {
    url: webContents.getURL() || "about:blank",
    title: webContents.getTitle(),
    canGoBack: webContents.canGoBack(),
    canGoForward: webContents.canGoForward(),
    harnessUrl: harness?.providerUrl ?? null,
  };
}

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(text: string) {
  return { content: [{ type: "text", text }] };
}

async function readRequestBody(request: NodeHttp.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large.");
    }
  }
  return body;
}

function sendJson(
  response: NodeHttp.ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

const snapshotScript = String.raw`
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const labelFor = (element) => {
    const aria = element.getAttribute("aria-label") || element.getAttribute("title") || "";
    const placeholder = element.getAttribute("placeholder") || "";
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    const value = "value" in element ? String(element.value || "") : "";
    return (aria || placeholder || text || value || element.tagName.toLowerCase()).slice(0, 160);
  };
  const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role='button'],[onclick]"))
    .filter(visible)
    .slice(0, 200);
  const elements = nodes.map((element, index) => {
    const rect = element.getBoundingClientRect();
    return {
      ref: "e" + (index + 1),
      tag: element.tagName.toLowerCase(),
      label: labelFor(element),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  });
  return {
    url: window.location.href,
    title: document.title || "",
    text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 12000),
    elements,
  };
})()
`;

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runtimeScope = yield* Scope.Scope;
  const viewRef = yield* Ref.make<Electron.WebContentsView | null>(null);
  const boundsRef = yield* Ref.make<DesktopBrowserBoundsInput | null>(null);
  const harnessRef = yield* Ref.make<HarnessServerState | null>(null);
  const lastElementsRef = yield* Ref.make<readonly BrowserElementSnapshot[]>([]);
  const consoleEntriesRef = yield* Ref.make<readonly BrowserConsoleEntry[]>([]);

  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const ensureView = Effect.fn("desktop.browser.ensureView")(function* () {
    const existing = yield* Ref.get(viewRef);
    if (existing && !existing.webContents.isDestroyed()) {
      return existing;
    }

    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window)) {
      return yield* new DesktopBrowserHarnessError({
        operation: "ensureView",
        detail: "No main window is available.",
      });
    }

    const view = new Electron.WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedBrowserUrl(url)) {
        void view.webContents.loadURL(url);
      }
      return { action: "deny" };
    });
    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      void runPromise(
        logWarning("browser page failed to load", {
          errorCode,
          errorDescription,
          url: validatedURL,
        }),
      );
    });
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      void runPromise(
        Ref.update(consoleEntriesRef, (entries) =>
          [
            ...entries,
            {
              level: String(level),
              message,
              line,
              sourceId,
            },
          ].slice(-200),
        ),
      );
    });
    window.value.contentView.addChildView(view);
    yield* Ref.set(viewRef, view);

    const bounds = yield* Ref.get(boundsRef);
    if (bounds) {
      view.setBounds(bounds.visible ? bounds : { ...bounds, width: 0, height: 0 });
    }

    return view;
  });

  const setBounds = Effect.fn("desktop.browser.setBounds")(function* (
    input: DesktopBrowserBoundsInput,
  ) {
    const clean = {
      x: Math.max(0, Math.round(input.x)),
      y: Math.max(0, Math.round(input.y)),
      width: Math.max(0, Math.round(input.width)),
      height: Math.max(0, Math.round(input.height)),
      visible: input.visible && input.width > 8 && input.height > 8,
    };
    yield* Ref.set(boundsRef, clean);
    const view = yield* ensureView();
    view.setBounds(clean.visible ? clean : { ...clean, width: 0, height: 0 });
  });

  const hide = Effect.gen(function* () {
    const bounds = yield* Ref.get(boundsRef);
    const next = { ...(bounds ?? { x: 0, y: 0, width: 0, height: 0 }), visible: false };
    yield* Ref.set(boundsRef, next);
    const view = yield* Ref.get(viewRef);
    if (view && !view.webContents.isDestroyed()) {
      view.setBounds({ ...next, width: 0, height: 0 });
    }
  });

  const getStatus = Effect.gen(function* () {
    return makeStatus(yield* Ref.get(viewRef), yield* Ref.get(harnessRef));
  });

  const navigate = Effect.fn("desktop.browser.navigate")(function* (
    input: DesktopBrowserNavigateInput,
  ) {
    const url = normalizeBrowserUrl(input.url);
    if (!isAllowedBrowserUrl(url)) {
      return yield* new DesktopBrowserHarnessError({
        operation: "navigate",
        detail: `Unsupported browser URL: ${input.url}`,
      });
    }
    const view = yield* ensureView();
    if (url === "about:blank") {
      view.webContents.loadURL(url);
    } else {
      yield* Effect.promise(() => view.webContents.loadURL(url).catch(() => undefined));
    }
    return yield* getStatus;
  });

  const back = Effect.gen(function* () {
    const view = yield* ensureView();
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
    return yield* getStatus;
  });

  const forward = Effect.gen(function* () {
    const view = yield* ensureView();
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
    return yield* getStatus;
  });

  const reload = Effect.gen(function* () {
    const view = yield* ensureView();
    view.webContents.reload();
    return yield* getStatus;
  });

  const snapshot = Effect.gen(function* () {
    const view = yield* ensureView();
    const result = yield* Effect.tryPromise({
      try: () => view.webContents.executeJavaScript(snapshotScript, true) as Promise<PageSnapshot>,
      catch: (cause) =>
        new DesktopBrowserHarnessError({
          operation: "snapshot",
          detail: "Failed to read browser page snapshot.",
          cause,
        }),
    });
    yield* Ref.set(lastElementsRef, result.elements);
    return result;
  });

  const consoleEntries = Effect.gen(function* () {
    return yield* Ref.get(consoleEntriesRef);
  });

  const networkEntries = Effect.gen(function* () {
    const view = yield* ensureView();
    return yield* Effect.tryPromise({
      try: () =>
        view.webContents.executeJavaScript(
          `performance.getEntriesByType("resource").slice(-200).map((entry) => ({
            name: entry.name,
            initiatorType: entry.initiatorType || "",
            duration: Math.round(entry.duration),
            transferSize: Number(entry.transferSize || 0),
          }))`,
          true,
        ) as Promise<BrowserNetworkEntry[]>,
      catch: (cause) =>
        new DesktopBrowserHarnessError({
          operation: "network",
          detail: "Failed to read browser network entries.",
          cause,
        }),
    });
  });

  const click = Effect.fn("desktop.browser.click")(function* (input: {
    readonly ref?: string;
    readonly x?: number;
    readonly y?: number;
  }) {
    const view = yield* ensureView();
    let x = input.x;
    let y = input.y;
    if (input.ref) {
      const element = (yield* Ref.get(lastElementsRef)).find(
        (candidate) => candidate.ref === input.ref,
      );
      if (!element) {
        return yield* new DesktopBrowserHarnessError({
          operation: "click",
          detail: `Unknown browser element ref: ${input.ref}`,
        });
      }
      x = element.x;
      y = element.y;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      return yield* new DesktopBrowserHarnessError({
        operation: "click",
        detail: "browser_click requires x/y coordinates or a ref from browser_snapshot.",
      });
    }
    view.webContents.sendInputEvent({ type: "mouseMove", x, y });
    view.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    view.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    return yield* getStatus;
  });

  const typeText = Effect.fn("desktop.browser.typeText")(function* (input: {
    readonly text: string;
    readonly ref?: string;
  }) {
    if (input.ref) {
      yield* click({ ref: input.ref });
    }
    const view = yield* ensureView();
    view.webContents.insertText(input.text);
    return yield* getStatus;
  });

  const pressKey = Effect.fn("desktop.browser.pressKey")(function* (input: {
    readonly key: string;
  }) {
    const view = yield* ensureView();
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: input.key });
    view.webContents.sendInputEvent({ type: "keyUp", keyCode: input.key });
    return yield* getStatus;
  });

  const callTool = Effect.fn("desktop.browser.callTool")(function* (name: string, args: unknown) {
    const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    switch (name) {
      case "browser_open":
        return toolText(JSON.stringify(yield* navigate({ url: String(input.url ?? "") }), null, 2));
      case "browser_snapshot": {
        const page = yield* snapshot;
        const elements = page.elements
          .map(
            (element) =>
              `${element.ref}: <${element.tag}> ${element.label} (${element.x}, ${element.y})`,
          )
          .join("\n");
        return toolText(
          [`URL: ${page.url}`, `Title: ${page.title}`, "", page.text, "", "Elements:", elements]
            .join("\n")
            .trim(),
        );
      }
      case "browser_click":
        return toolText(
          JSON.stringify(
            yield* click({
              ...(typeof input.ref === "string" ? { ref: input.ref } : {}),
              ...(typeof input.x === "number" ? { x: input.x } : {}),
              ...(typeof input.y === "number" ? { y: input.y } : {}),
            }),
            null,
            2,
          ),
        );
      case "browser_type":
        return toolText(
          JSON.stringify(
            yield* typeText({
              text: String(input.text ?? ""),
              ...(typeof input.ref === "string" ? { ref: input.ref } : {}),
            }),
            null,
            2,
          ),
        );
      case "browser_press_key":
        return toolText(
          JSON.stringify(yield* pressKey({ key: String(input.key ?? "Enter") }), null, 2),
        );
      case "browser_screenshot": {
        const view = yield* ensureView();
        const image: Electron.NativeImage = yield* Effect.tryPromise({
          try: () => view.webContents.capturePage(),
          catch: (cause) =>
            new DesktopBrowserHarnessError({
              operation: "screenshot",
              detail: "Failed to capture browser screenshot.",
              cause,
            }),
        });
        return {
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: image.toPNG().toString("base64"),
            },
          ],
        };
      }
      case "browser_console": {
        const entries = yield* consoleEntries;
        return toolText(
          entries
            .map((entry) => `[${entry.level}] ${entry.message} (${entry.sourceId}:${entry.line})`)
            .join("\n") || "No console messages captured.",
        );
      }
      case "browser_network": {
        const entries = yield* networkEntries;
        return toolText(
          entries
            .map(
              (entry) =>
                `${entry.initiatorType || "resource"} ${entry.name} ${entry.duration}ms ${entry.transferSize}b`,
            )
            .join("\n") || "No network resource entries captured.",
        );
      }
      default:
        return yield* new DesktopBrowserHarnessError({
          operation: "mcpToolCall",
          detail: `Unknown browser tool: ${name}`,
        });
    }
  });

  const handleMcpRequest = Effect.fn("desktop.browser.handleMcpRequest")(function* (
    payload: Record<string, unknown>,
  ) {
    const id = payload.id;
    if (payload.method === "initialize") {
      return jsonRpcResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "t3-browser-harness", version: "0.1.0" },
      });
    }
    if (payload.method === "notifications/initialized") {
      return null;
    }
    if (payload.method === "tools/list") {
      return jsonRpcResponse(id, {
        tools: [
          {
            name: "browser_open",
            description: "Open a URL in the T3 desktop browser panel.",
            inputSchema: {
              type: "object",
              properties: { url: { type: "string" } },
              required: ["url"],
            },
          },
          {
            name: "browser_snapshot",
            description: "Read the current page title, text, and clickable element refs.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "browser_click",
            description: "Click an element ref from browser_snapshot or explicit x/y coordinates.",
            inputSchema: {
              type: "object",
              properties: {
                ref: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
              },
            },
          },
          {
            name: "browser_type",
            description:
              "Type text into the focused element, optionally clicking an element ref first.",
            inputSchema: {
              type: "object",
              properties: { ref: { type: "string" }, text: { type: "string" } },
              required: ["text"],
            },
          },
          {
            name: "browser_press_key",
            description: "Press a key in the browser page, for example Enter or Tab.",
            inputSchema: {
              type: "object",
              properties: { key: { type: "string" } },
              required: ["key"],
            },
          },
          {
            name: "browser_screenshot",
            description: "Capture a PNG screenshot of the current browser page.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "browser_console",
            description: "Read recent console messages captured from the browser page.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "browser_network",
            description: "Read recent browser resource timing entries for the page.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    }
    if (payload.method === "tools/call") {
      const params =
        payload.params && typeof payload.params === "object"
          ? (payload.params as Record<string, unknown>)
          : {};
      const result = yield* callTool(String(params.name ?? ""), params.arguments);
      return jsonRpcResponse(id, result);
    }
    return jsonRpcError(id, -32601, `Unsupported MCP method: ${String(payload.method ?? "")}`);
  });

  const start = Effect.gen(function* () {
    const existing = yield* Ref.get(harnessRef);
    if (existing) {
      return;
    }

    const token = NodeCrypto.randomBytes(24).toString("hex");
    const server = NodeHttp.createServer((request, response) => {
      void runPromise(
        Effect.gen(function* () {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (request.method === "OPTIONS") {
            response.writeHead(204, {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "POST, OPTIONS",
              "access-control-allow-headers": "content-type, authorization, mcp-session-id",
            });
            response.end();
            return;
          }
          if (request.method !== "POST" || url.pathname !== "/mcp") {
            sendJson(response, 404, { error: "Not found" });
            return;
          }
          const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
          if (url.searchParams.get("token") !== token && bearer !== token) {
            sendJson(response, 401, { error: "Unauthorized" });
            return;
          }

          const body = yield* Effect.tryPromise({
            try: () => readRequestBody(request),
            catch: (cause) =>
              new DesktopBrowserHarnessError({
                operation: "readRequest",
                detail: "Failed to read MCP request body.",
                cause,
              }),
          });
          const payload = JSON.parse(body);
          if (!payload || typeof payload !== "object") {
            sendJson(response, 400, jsonRpcError(null, -32600, "Invalid JSON-RPC request."));
            return;
          }
          const result = yield* handleMcpRequest(payload);
          if (result === null) {
            response.writeHead(202, { "mcp-session-id": MCP_SESSION_ID });
            response.end();
            return;
          }
          sendJson(response, 200, result, { "mcp-session-id": MCP_SESSION_ID });
        }).pipe(
          Effect.catch((error: DesktopBrowserHarnessError) =>
            Effect.sync(() => sendJson(response, 500, jsonRpcError(null, -32000, error.message))),
          ),
        ),
      );
    });

    const address = yield* Effect.tryPromise({
      try: () =>
        new Promise<{ port: number }>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "0.0.0.0", () => {
            const address = server.address();
            if (address && typeof address === "object") {
              resolve({ port: address.port });
              return;
            }
            reject(new Error("Browser harness server did not report a TCP port."));
          });
        }),
      catch: (cause) =>
        new DesktopBrowserHarnessError({
          operation: "start",
          detail: "Failed to start browser harness server.",
          cause,
        }),
    });

    const host = getPrimaryNetworkHost();
    const localUrl = `http://127.0.0.1:${address.port}/mcp?token=${token}`;
    const providerUrl = `http://${host ?? "127.0.0.1"}:${address.port}/mcp?token=${token}`;
    const state = { token, localUrl, providerUrl, server };
    yield* Ref.set(harnessRef, state);
    process.env.T3CODE_BROWSER_MCP_URL = providerUrl;
    process.env.T3CODE_BROWSER_MCP_LOCAL_URL = localUrl;
    process.env.T3CODE_BROWSER_MCP_TOKEN = token;
    yield* Scope.addFinalizer(
      runtimeScope,
      Effect.sync(() => server.close()),
    );
    yield* logInfo("browser harness started", { localUrl, providerUrl });
  });

  return DesktopBrowserHarness.of({
    start,
    setBounds,
    hide,
    navigate,
    back,
    forward,
    reload,
    getStatus,
  });
});

export const layer = Layer.effect(DesktopBrowserHarness, make);
