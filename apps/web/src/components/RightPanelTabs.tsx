import type { BrowserPanelKey } from "../browserPanelStore";
import type { RightPanelTab } from "../diffRouteSearch";
import { Suspense, lazy, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { DiffPanelHeaderSkeleton, DiffPanelLoadingState, DiffPanelShell } from "./DiffPanelShell";
import type { DiffPanelMode } from "./DiffPanelShell";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

const DiffPanel = lazy(() => import("./DiffPanel"));
const BrowserPanel = lazy(() => import("./BrowserPanel"));

function DiffLoadingFallback({ mode }: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

function BrowserLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading browser...
    </div>
  );
}

export function RightPanelTabs({
  activeTab,
  onTabChange,
  mode,
  projectKey,
  renderDiff,
  renderBrowser,
}: {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  mode: DiffPanelMode;
  projectKey: BrowserPanelKey | null;
  renderDiff: boolean;
  renderBrowser: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 min-h-10 items-center gap-1 border-b border-border bg-card px-2">
        <TabButton active={activeTab === "diff"} onClick={() => onTabChange("diff")}>
          Diff
        </TabButton>
        <TabButton active={activeTab === "browser"} onClick={() => onTabChange("browser")}>
          Browser
        </TabButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", activeTab === "diff" ? "block" : "hidden")}>
          {renderDiff ? (
            <DiffWorkerPoolProvider>
              <Suspense fallback={<DiffLoadingFallback mode={mode} />}>
                <DiffPanel mode={mode} />
              </Suspense>
            </DiffWorkerPoolProvider>
          ) : null}
        </div>
        <div className={cn("absolute inset-0", activeTab === "browser" ? "block" : "hidden")}>
          {renderBrowser && projectKey ? (
            <Suspense fallback={<BrowserLoadingFallback />}>
              <BrowserPanel projectKey={projectKey} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Browser preview is available after opening a project thread.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
