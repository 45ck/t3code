import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createBrowserTab, type BrowserTab } from "./browser";

export type BrowserPanelKey = string;

export interface BrowserPanelState {
  activeTabId: string | null;
  tabs: BrowserTab[];
}

const BROWSER_PANEL_STORAGE_KEY = "t3code:browser-panel:v2";

const DEFAULT_BROWSER_PANEL_STATE: BrowserPanelState = Object.freeze({
  activeTabId: null,
  tabs: [],
});

function normalizeTab(tab: BrowserTab): BrowserTab | null {
  if (!tab.id || !tab.url) {
    return null;
  }
  const history = tab.history.length > 0 ? tab.history : [tab.url];
  const historyIndex = Math.min(Math.max(tab.historyIndex, 0), history.length - 1);
  return {
    ...tab,
    reloadNonce: Number.isFinite(tab.reloadNonce) ? tab.reloadNonce : 0,
    history,
    historyIndex,
  };
}

function normalizePanelState(state: BrowserPanelState): BrowserPanelState {
  const tabs = state.tabs.flatMap((tab) => {
    const normalized = normalizeTab(tab);
    return normalized ? [normalized] : [];
  });
  const activeTabId =
    state.activeTabId && tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : (tabs[0]?.id ?? null);
  if (tabs === state.tabs && activeTabId === state.activeTabId) {
    return state;
  }
  return { activeTabId, tabs };
}

function selectPanelState(
  stateByKey: Record<BrowserPanelKey, BrowserPanelState>,
  key: BrowserPanelKey,
): BrowserPanelState {
  return stateByKey[key] ?? DEFAULT_BROWSER_PANEL_STATE;
}

function navigateBrowserTab(tab: BrowserTab, url: string): BrowserTab {
  if (tab.url === url) {
    return { ...tab, reloadNonce: tab.reloadNonce + 1, lastError: null };
  }
  const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
  return {
    ...tab,
    url,
    title: null,
    history,
    historyIndex: history.length - 1,
    lastError: null,
  };
}

interface BrowserPanelStoreState {
  browserStateByKey: Record<BrowserPanelKey, BrowserPanelState>;
  addTab: (key: BrowserPanelKey, url?: string) => void;
  closeTab: (key: BrowserPanelKey, tabId: string) => void;
  setActiveTab: (key: BrowserPanelKey, tabId: string) => void;
  navigateTab: (key: BrowserPanelKey, tabId: string, url: string) => void;
  openUrl: (key: BrowserPanelKey, url: string) => void;
  goBack: (key: BrowserPanelKey, tabId: string) => void;
  goForward: (key: BrowserPanelKey, tabId: string) => void;
  reloadTab: (key: BrowserPanelKey, tabId: string) => void;
  setTabTitle: (key: BrowserPanelKey, tabId: string, title: string | null) => void;
  setTabError: (key: BrowserPanelKey, tabId: string, error: string | null) => void;
}

export const useBrowserPanelStore = create<BrowserPanelStoreState>()(
  persist(
    (set) => {
      const updatePanel = (
        key: BrowserPanelKey,
        updater: (state: BrowserPanelState) => BrowserPanelState,
      ) => {
        set((store) => {
          const current = selectPanelState(store.browserStateByKey, key);
          const next = normalizePanelState(updater(current));
          if (next === current) {
            return store;
          }
          return {
            browserStateByKey: {
              ...store.browserStateByKey,
              [key]: next,
            },
          };
        });
      };

      return {
        browserStateByKey: {},
        addTab: (key, url = "about:blank") => {
          updatePanel(key, (state) => {
            const tab = createBrowserTab(url);
            return { tabs: [...state.tabs, tab], activeTabId: tab.id };
          });
        },
        closeTab: (key, tabId) => {
          updatePanel(key, (state) => {
            const closedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
            const tabs = state.tabs.filter((tab) => tab.id !== tabId);
            if (tabs.length === 0) {
              return { tabs: [], activeTabId: null };
            }
            const activeTabId =
              state.activeTabId === tabId
                ? (tabs[Math.min(Math.max(closedIndex, 0), tabs.length - 1)]?.id ??
                  tabs[0]?.id ??
                  null)
                : state.activeTabId;
            return { tabs, activeTabId };
          });
        },
        setActiveTab: (key, tabId) => {
          updatePanel(key, (state) => {
            if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === tabId)) {
              return state;
            }
            return { ...state, activeTabId: tabId };
          });
        },
        navigateTab: (key, tabId, url) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) => (tab.id === tabId ? navigateBrowserTab(tab, url) : tab)),
          }));
        },
        openUrl: (key, url) => {
          updatePanel(key, (state) => {
            if (state.tabs.length === 0 || !state.activeTabId) {
              const tab = createBrowserTab(url);
              return { tabs: [tab], activeTabId: tab.id };
            }
            return {
              ...state,
              tabs: state.tabs.map((tab) =>
                tab.id === state.activeTabId ? navigateBrowserTab(tab, url) : tab,
              ),
            };
          });
        },
        goBack: (key, tabId) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) => {
              if (tab.id !== tabId || tab.historyIndex <= 0) return tab;
              const historyIndex = tab.historyIndex - 1;
              return {
                ...tab,
                url: tab.history[historyIndex] ?? tab.url,
                historyIndex,
                lastError: null,
              };
            }),
          }));
        },
        goForward: (key, tabId) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) => {
              if (tab.id !== tabId || tab.historyIndex >= tab.history.length - 1) return tab;
              const historyIndex = tab.historyIndex + 1;
              return {
                ...tab,
                url: tab.history[historyIndex] ?? tab.url,
                historyIndex,
                lastError: null,
              };
            }),
          }));
        },
        reloadTab: (key, tabId) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? { ...tab, reloadNonce: tab.reloadNonce + 1, lastError: null }
                : tab,
            ),
          }));
        },
        setTabTitle: (key, tabId, title) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
          }));
        },
        setTabError: (key, tabId, error) => {
          updatePanel(key, (state) => ({
            ...state,
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, lastError: error } : tab)),
          }));
        },
      };
    },
    {
      name: BROWSER_PANEL_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ browserStateByKey: state.browserStateByKey }),
    },
  ),
);

export function selectBrowserPanelState(
  browserStateByKey: Record<BrowserPanelKey, BrowserPanelState>,
  key: BrowserPanelKey,
): BrowserPanelState {
  return selectPanelState(browserStateByKey, key);
}
