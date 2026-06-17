import { useCallback, type CSSProperties } from "react";

import type { BrowserPanelKey } from "../browserPanelStore";
import type { RightPanelTab } from "../diffRouteSearch";
import { RIGHT_PANEL_INLINE_SIDEBAR_WIDTH_STORAGE_KEY } from "../rightPanelLayout";
import { RightPanelTabs } from "./RightPanelTabs";
import type { DiffPanelMode } from "./DiffPanelShell";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DIFF_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const DIFF_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

export function RightPanelInlineSidebar(props: {
  panelOpen: boolean;
  activeTab: RightPanelTab;
  projectKey: BrowserPanelKey | null;
  onClose: () => void;
  onOpen: () => void;
  onTabChange: (tab: RightPanelTab) => void;
  renderBrowserContent: boolean;
  renderDiffContent: boolean;
  mode?: DiffPanelMode;
  showDiffTab?: boolean;
  showBrowserTab?: boolean;
}) {
  const {
    panelOpen,
    activeTab,
    projectKey,
    onClose,
    onOpen,
    onTabChange,
    renderBrowserContent,
    renderDiffContent,
    mode = "sidebar",
    showDiffTab,
    showBrowserTab,
  } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={panelOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: DIFF_INLINE_SIDEBAR_MAX_WIDTH,
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: RIGHT_PANEL_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <RightPanelTabs
          activeTab={activeTab}
          mode={mode}
          projectKey={projectKey}
          renderBrowser={renderBrowserContent}
          renderDiff={renderDiffContent}
          {...(showBrowserTab === undefined ? {} : { showBrowserTab })}
          {...(showDiffTab === undefined ? {} : { showDiffTab })}
          onTabChange={onTabChange}
        />
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
}
