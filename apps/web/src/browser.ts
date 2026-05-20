import { randomUUID } from "./lib/utils";

export type BrowserTab = {
  id: string;
  url: string;
  title?: string | null;
  reloadNonce: number;
  history: string[];
  historyIndex: number;
  lastError?: string | null;
};

export type BrowserUrlParseResult = { ok: true; url: string } | { ok: false; error: string };

const EXPLICIT_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;
const ESC = String.fromCharCode(0x1b);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g");
const DEV_SERVER_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s"'<>]*)?/;

export function createBrowserTab(url = "about:blank"): BrowserTab {
  return {
    id: `browser-tab-${randomUUID()}`,
    url,
    title: null,
    reloadNonce: 0,
    history: [url],
    historyIndex: 0,
    lastError: null,
  };
}

export function normalizeBrowserDisplayUrl(url: string | null | undefined): string {
  if (!url || url === "about:blank") {
    return "";
  }
  return url;
}

export function getBrowserTabLabel(tab: Pick<BrowserTab, "title" | "url">): string {
  const title = tab.title?.trim();
  if (title) {
    return title;
  }
  if (tab.url === "about:blank") {
    return "New tab";
  }

  try {
    const parsed = new URL(tab.url);
    return parsed.host || parsed.href;
  } catch {
    return tab.url;
  }
}

export function parseSubmittedBrowserUrl(rawValue: string): BrowserUrlParseResult {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: true, url: "about:blank" };
  }

  if (trimmed === "about:blank") {
    return { ok: true, url: trimmed };
  }

  const candidate = EXPLICIT_SCHEME_PATTERN.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    return { ok: true, url: new URL(candidate).toString() };
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }
}

export function isLocalPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function detectDevServerUrl(data: string): string | null {
  const clean = data.replace(ANSI_RE, "");
  const match = clean.match(DEV_SERVER_URL_RE);
  if (!match) {
    return null;
  }
  return match[0].replace(/[),.;]+$/, "");
}
