import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  type RightPanelTab,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { RightPanelInlineSidebar } from "../components/RightPanelInlineSidebar";
import { RightPanelTabs } from "../components/RightPanelTabs";
import { SidebarInset } from "~/components/ui/sidebar";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const panelOpen = search.diff === "1";
  const activeRightPanelTab: RightPanelTab = search.rpt ?? "diff";
  const shouldUsePanelSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const projectKey =
    threadRef && (serverThread?.projectId ?? draftThread?.projectId)
      ? `${threadRef.environmentId}:${serverThread?.projectId ?? draftThread?.projectId}`
      : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedBrowser: panelOpen && activeRightPanelTab === "browser",
    hasOpenedDiff: panelOpen && activeRightPanelTab === "diff",
  }));
  const panelMountState =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState
      : {
          threadKey: currentThreadKey,
          hasOpenedBrowser: panelOpen && activeRightPanelTab === "browser",
          hasOpenedDiff: panelOpen && activeRightPanelTab === "diff",
        };
  const hasOpenedDiff = panelMountState.hasOpenedDiff;
  const hasOpenedBrowser = panelMountState.hasOpenedBrowser;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        ...previous,
        threadKey: currentThreadKey,
        hasOpenedBrowser:
          previous.threadKey === currentThreadKey ? previous.hasOpenedBrowser : false,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);
  const markBrowserOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedBrowser) {
        return previous;
      }
      return {
        ...previous,
        threadKey: currentThreadKey,
        hasOpenedBrowser: true,
        hasOpenedDiff: previous.threadKey === currentThreadKey ? previous.hasOpenedDiff : false,
      };
    });
  }, [currentThreadKey]);
  const closePanel = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [navigate, threadRef]);
  const openPanel = useCallback(() => {
    if (!threadRef) {
      return;
    }
    if (activeRightPanelTab === "browser") {
      markBrowserOpened();
    } else {
      markDiffOpened();
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", rpt: activeRightPanelTab };
      },
    });
  }, [activeRightPanelTab, markBrowserOpened, markDiffOpened, navigate, threadRef]);

  const changeRightPanelTab = useCallback(
    (tab: RightPanelTab) => {
      if (!threadRef) {
        return;
      }
      if (tab === "browser") {
        markBrowserOpened();
      } else {
        markDiffOpened();
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        replace: true,
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return { ...rest, diff: "1", rpt: tab };
        },
      });
    },
    [markBrowserOpened, markDiffOpened, navigate, threadRef],
  );

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    if (activeRightPanelTab === "browser") {
      markBrowserOpened();
      return;
    }
    markDiffOpened();
  }, [activeRightPanelTab, markBrowserOpened, markDiffOpened, panelOpen]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = (panelOpen && activeRightPanelTab === "diff") || hasOpenedDiff;
  const shouldRenderBrowserContent =
    (panelOpen && activeRightPanelTab === "browser") || hasOpenedBrowser;

  if (!shouldUsePanelSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onBrowserPanelOpen={markBrowserOpened}
            onDiffPanelOpen={markDiffOpened}
            reserveTitleBarControlInset={!panelOpen}
            routeKind="server"
          />
        </SidebarInset>
        <RightPanelInlineSidebar
          activeTab={activeRightPanelTab}
          panelOpen={panelOpen}
          projectKey={projectKey}
          onClose={closePanel}
          onOpen={openPanel}
          onTabChange={changeRightPanelTab}
          renderBrowserContent={shouldRenderBrowserContent}
          renderDiffContent={shouldRenderDiffContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onBrowserPanelOpen={markBrowserOpened}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={panelOpen} onClose={closePanel}>
        <RightPanelTabs
          activeTab={activeRightPanelTab}
          mode="sheet"
          projectKey={projectKey}
          renderBrowser={shouldRenderBrowserContent}
          renderDiff={shouldRenderDiffContent}
          onTabChange={changeRightPanelTab}
        />
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "rpt"])],
  },
  component: ChatThreadRouteView,
});
