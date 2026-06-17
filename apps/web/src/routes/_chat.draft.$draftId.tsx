import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { RightPanelInlineSidebar } from "../components/RightPanelInlineSidebar";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { RightPanelTabs } from "../components/RightPanelTabs";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const search = Route.useSearch();
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );
  const shouldUsePanelSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const panelOpen = search.diff === "1" && search.rpt === "browser";
  const projectKey = draftSession
    ? scopedProjectKey(scopeProjectRef(draftSession.environmentId, draftSession.projectId))
    : null;
  const closePanel = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: undefined };
      },
    });
  }, [draftId, navigate]);
  const openBrowserPanel = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", rpt: "browser" };
      },
    });
  }, [draftId, navigate]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  if (!shouldUsePanelSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            threadId={draftSession.threadId}
            onBrowserPanelOpen={openBrowserPanel}
            reserveTitleBarControlInset={!panelOpen}
            routeKind="draft"
          />
        </SidebarInset>
        <RightPanelInlineSidebar
          activeTab="browser"
          panelOpen={panelOpen}
          projectKey={projectKey}
          renderBrowserContent={panelOpen}
          renderDiffContent={false}
          showDiffTab={false}
          onClose={closePanel}
          onOpen={openBrowserPanel}
          onTabChange={openBrowserPanel}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          onBrowserPanelOpen={openBrowserPanel}
          routeKind="draft"
        />
      </SidebarInset>
      <RightPanelSheet open={panelOpen} onClose={closePanel}>
        <RightPanelTabs
          activeTab="browser"
          mode="sheet"
          projectKey={projectKey}
          renderBrowser={panelOpen}
          renderDiff={false}
          showDiffTab={false}
          onTabChange={openBrowserPanel}
        />
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "rpt"])],
  },
  component: DraftChatThreadRouteView,
});
