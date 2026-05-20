/* eslint-disable react/iframe-missing-sandbox -- allow-same-origin is intentional for localhost app previews and Vite HMR. */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  getBrowserTabLabel,
  isLocalPreviewUrl,
  normalizeBrowserDisplayUrl,
  parseSubmittedBrowserUrl,
  type BrowserTab,
} from "../browser";
import {
  selectBrowserPanelState,
  useBrowserPanelStore,
  type BrowserPanelKey,
} from "../browserPanelStore";
import { readLocalApi } from "../localApi";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface BrowserPanelProps {
  projectKey: BrowserPanelKey;
}

function BrowserTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: BrowserTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const label = getBrowserTabLabel(tab);
  return (
    <div
      className={cn(
        "group/browser-tab flex h-8 min-w-0 max-w-44 shrink-0 items-center gap-1 rounded-md border px-2 text-xs",
        active
          ? "border-border bg-background text-foreground shadow-xs"
          : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
        {label}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-5 opacity-60 hover:opacity-100"
        aria-label="Close browser tab"
        onClick={onClose}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

function BrowserIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

const BrowserPanel = memo(function BrowserPanel({ projectKey }: BrowserPanelProps) {
  const panelState = useBrowserPanelStore((store) =>
    selectBrowserPanelState(store.browserStateByKey, projectKey),
  );
  const addTab = useBrowserPanelStore((store) => store.addTab);
  const closeTab = useBrowserPanelStore((store) => store.closeTab);
  const setActiveTab = useBrowserPanelStore((store) => store.setActiveTab);
  const navigateTab = useBrowserPanelStore((store) => store.navigateTab);
  const goBack = useBrowserPanelStore((store) => store.goBack);
  const goForward = useBrowserPanelStore((store) => store.goForward);
  const reloadTab = useBrowserPanelStore((store) => store.reloadTab);
  const setTabTitle = useBrowserPanelStore((store) => store.setTabTitle);
  const setTabError = useBrowserPanelStore((store) => store.setTabError);
  const syncActiveTabStatus = useBrowserPanelStore((store) => store.syncActiveTabStatus);
  const activeTab =
    panelState.tabs.find((tab) => tab.id === panelState.activeTabId) ?? panelState.tabs[0] ?? null;
  const [inputValue, setInputValue] = useState(() => normalizeBrowserDisplayUrl(activeTab?.url));
  const [serverReachable, setServerReachable] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const nativeVisibleRef = useRef(false);
  const lastNativeStatusRef = useRef<{ url: string; reloadNonce: number } | null>(null);
  const nativeBrowser = typeof window !== "undefined" ? window.desktopBridge?.browser : undefined;
  const useNativeBrowser = Boolean(nativeBrowser);
  const activeTabId = activeTab?.id ?? null;
  const activeTabUrl = activeTab?.url ?? null;
  const activeTabReloadNonce = activeTab?.reloadNonce ?? 0;
  const activeTabVisible = Boolean(activeTab && activeTab.url !== "about:blank");
  nativeVisibleRef.current = activeTabVisible;

  useEffect(() => {
    setInputValue(normalizeBrowserDisplayUrl(activeTabUrl));
    setServerReachable(true);
  }, [activeTab?.id, activeTabUrl]);

  useEffect(() => {
    if (useNativeBrowser) {
      return;
    }
    if (!activeTabUrl || activeTabUrl === "about:blank" || !isLocalPreviewUrl(activeTabUrl)) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 2000);
        await fetch(activeTabUrl, {
          method: "HEAD",
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        if (!cancelled) {
          setServerReachable(true);
        }
      } catch {
        if (!cancelled) {
          setServerReachable(false);
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(checkHealth, serverReachable ? 10_000 : 2_000);
      }
    };

    timer = window.setTimeout(checkHealth, 1500);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeTabUrl, serverReachable, useNativeBrowser]);

  useEffect(() => {
    if (!nativeBrowser) {
      return;
    }
    const element = contentRef.current;
    if (!element) {
      return;
    }

    let frameId: number | null = null;
    const syncBounds = () => {
      frameId = null;
      const rect = element.getBoundingClientRect();
      void nativeBrowser
        .setBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: nativeVisibleRef.current && rect.width > 8 && rect.height > 8,
        })
        .catch(() => undefined);
    };
    const scheduleSync = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(syncBounds);
    };

    const observer = new ResizeObserver(scheduleSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleSync);
    scheduleSync();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      void nativeBrowser.hide().catch(() => undefined);
    };
  }, [nativeBrowser]);

  useEffect(() => {
    if (!nativeBrowser) {
      return;
    }
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    void nativeBrowser
      .setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        visible: activeTabVisible && rect.width > 8 && rect.height > 8,
      })
      .catch(() => undefined);
  }, [activeTabVisible, nativeBrowser]);

  useEffect(() => {
    if (!nativeBrowser?.onStatus) {
      return;
    }
    return nativeBrowser.onStatus((status) => {
      lastNativeStatusRef.current = { url: status.url, reloadNonce: activeTabReloadNonce };
      syncActiveTabStatus(projectKey, status);
    });
  }, [activeTabReloadNonce, nativeBrowser, projectKey, syncActiveTabStatus]);

  useEffect(() => {
    if (!nativeBrowser || !activeTabId || !activeTabUrl) {
      return;
    }
    const lastNativeStatus = lastNativeStatusRef.current;
    if (
      lastNativeStatus?.url === activeTabUrl &&
      lastNativeStatus.reloadNonce === activeTabReloadNonce
    ) {
      return;
    }
    void nativeBrowser
      .navigate({ url: activeTabUrl })
      .then((status) => {
        if (status.title) {
          setTabTitle(projectKey, activeTabId, status.title);
        }
        setTabError(projectKey, activeTabId, status.error ?? null);
      })
      .catch((error: unknown) => {
        setTabError(
          projectKey,
          activeTabId,
          error instanceof Error ? error.message : "Failed to load browser page.",
        );
      });
  }, [
    activeTabId,
    activeTabReloadNonce,
    activeTabUrl,
    nativeBrowser,
    projectKey,
    setTabError,
    setTabTitle,
  ]);

  const canGoBack = Boolean(activeTab && activeTab.historyIndex > 0);
  const canGoForward = Boolean(activeTab && activeTab.historyIndex < activeTab.history.length - 1);
  const iframeKey = activeTab
    ? `${activeTab.id}:${activeTab.url}:${activeTab.reloadNonce}`
    : "empty";
  const showIframe = Boolean(
    !useNativeBrowser &&
    activeTab &&
    activeTab.url !== "about:blank" &&
    (!isLocalPreviewUrl(activeTab.url) || serverReachable),
  );

  const createTab = useCallback(
    (url?: string) => {
      addTab(projectKey, url);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
    [addTab, projectKey],
  );

  const submitUrl = useCallback(() => {
    const result = parseSubmittedBrowserUrl(inputValue);
    if (!result.ok) {
      if (activeTab) {
        setTabError(projectKey, activeTab.id, result.error);
      }
      return;
    }
    if (activeTab) {
      navigateTab(projectKey, activeTab.id, result.url);
      return;
    }
    createTab(result.url);
  }, [activeTab, createTab, inputValue, navigateTab, projectKey, setTabError]);

  const openExternal = useCallback(() => {
    if (!activeTab || activeTab.url === "about:blank") {
      return;
    }
    const api = readLocalApi();
    if (api) {
      void api.shell.openExternal(activeTab.url).catch(() => undefined);
      return;
    }
    window.open(activeTab.url, "_blank", "noopener,noreferrer");
  }, [activeTab]);

  const onIframeLoad = useCallback(() => {
    if (!activeTab) {
      return;
    }
    setServerReachable(true);
    const iframe = document.querySelector<HTMLIFrameElement>(
      `[data-browser-preview-frame="${activeTab.id}"]`,
    );
    try {
      const title = iframe?.contentDocument?.title?.trim();
      if (title) {
        setTabTitle(projectKey, activeTab.id, title);
      }
      setTabError(projectKey, activeTab.id, null);
    } catch {
      setTabError(projectKey, activeTab.id, null);
    }
  }, [activeTab, projectKey, setTabError, setTabTitle]);

  const activeError = activeTab?.lastError?.trim() || null;
  const emptyState = panelState.tabs.length === 0;
  const localServerDown =
    activeTab &&
    activeTab.url !== "about:blank" &&
    isLocalPreviewUrl(activeTab.url) &&
    !serverReachable;

  const tabStrip = useMemo(
    () =>
      panelState.tabs.map((tab) => (
        <BrowserTabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeTab?.id}
          onSelect={() => setActiveTab(projectKey, tab.id)}
          onClose={() => closeTab(projectKey, tab.id)}
        />
      )),
    [activeTab?.id, closeTab, panelState.tabs, projectKey, setActiveTab],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-card text-foreground">
      <div className="flex h-10 min-h-10 items-center gap-1 border-b border-border bg-background/70 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{tabStrip}</div>
        <BrowserIconButton label="New tab" onClick={() => createTab()}>
          <PlusIcon className="size-3.5" />
        </BrowserIconButton>
      </div>
      <form
        className="flex h-10 min-h-10 items-center gap-1.5 border-b border-border bg-card px-2"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submitUrl();
        }}
      >
        <BrowserIconButton
          label="Back"
          disabled={!canGoBack}
          onClick={() => {
            if (!activeTab) return;
            goBack(projectKey, activeTab.id);
            void nativeBrowser?.back().catch(() => undefined);
          }}
        >
          <ArrowLeftIcon className="size-3.5" />
        </BrowserIconButton>
        <BrowserIconButton
          label="Forward"
          disabled={!canGoForward}
          onClick={() => {
            if (!activeTab) return;
            goForward(projectKey, activeTab.id);
            void nativeBrowser?.forward().catch(() => undefined);
          }}
        >
          <ArrowRightIcon className="size-3.5" />
        </BrowserIconButton>
        <BrowserIconButton
          label="Reload"
          disabled={!activeTab}
          onClick={() => {
            setServerReachable(true);
            if (activeTab) {
              reloadTab(projectKey, activeTab.id);
              void nativeBrowser?.reload().catch(() => undefined);
            }
          }}
        >
          <RefreshCwIcon className="size-3.5" />
        </BrowserIconButton>
        <Input
          ref={inputRef}
          size="sm"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="http://localhost:3000"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          nativeInput
        />
        <BrowserIconButton
          label="Open in browser"
          disabled={!activeTab || activeTab.url === "about:blank"}
          onClick={openExternal}
        >
          <ExternalLinkIcon className="size-3.5" />
        </BrowserIconButton>
      </form>
      <div ref={contentRef} className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {showIframe && activeTab ? (
          <iframe
            key={iframeKey}
            data-browser-preview-frame={activeTab.id}
            src={activeTab.url}
            title={getBrowserTabLabel(activeTab)}
            className="absolute inset-0 h-full w-full border-none bg-white"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-pointer-lock allow-same-origin allow-scripts"
            onLoad={onIframeLoad}
          />
        ) : null}
        {emptyState ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <GlobeIcon className="size-8 opacity-50" />
            <div>Open a browser tab to preview a local app.</div>
            <Button size="xs" variant="outline" onClick={() => createTab("http://localhost:3000")}>
              Open localhost:3000
            </Button>
          </div>
        ) : activeTab?.url === "about:blank" ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Enter a URL to preview a local app or external page.
          </div>
        ) : !useNativeBrowser && localServerDown ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <GlobeIcon className="size-8 opacity-50" />
            <div>Dev server not responding</div>
            <div className="text-xs">Reconnecting to {activeTab.url}...</div>
          </div>
        ) : null}
        {activeError ? (
          <div className="absolute right-3 bottom-3 left-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            {activeError}
          </div>
        ) : null}
      </div>
    </section>
  );
});

export default BrowserPanel;
