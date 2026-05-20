import {
  DesktopBrowserBoundsInputSchema,
  DesktopBrowserNavigateInputSchema,
  DesktopBrowserStatusSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBrowserHarness from "../../browser/DesktopBrowserHarness.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const browserSetBounds = makeIpcMethod({
  channel: IpcChannels.BROWSER_SET_BOUNDS_CHANNEL,
  payload: DesktopBrowserBoundsInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.setBounds")(function* (input) {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    yield* browser.setBounds(input);
  }),
});

export const browserHide = makeIpcMethod({
  channel: IpcChannels.BROWSER_HIDE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.hide")(function* () {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    yield* browser.hide;
  }),
});

export const browserNavigate = makeIpcMethod({
  channel: IpcChannels.BROWSER_NAVIGATE_CHANNEL,
  payload: DesktopBrowserNavigateInputSchema,
  result: DesktopBrowserStatusSchema,
  handler: Effect.fn("desktop.ipc.browser.navigate")(function* (input) {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    return yield* browser.navigate(input);
  }),
});

export const browserBack = makeIpcMethod({
  channel: IpcChannels.BROWSER_BACK_CHANNEL,
  payload: Schema.Void,
  result: DesktopBrowserStatusSchema,
  handler: Effect.fn("desktop.ipc.browser.back")(function* () {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    return yield* browser.back;
  }),
});

export const browserForward = makeIpcMethod({
  channel: IpcChannels.BROWSER_FORWARD_CHANNEL,
  payload: Schema.Void,
  result: DesktopBrowserStatusSchema,
  handler: Effect.fn("desktop.ipc.browser.forward")(function* () {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    return yield* browser.forward;
  }),
});

export const browserReload = makeIpcMethod({
  channel: IpcChannels.BROWSER_RELOAD_CHANNEL,
  payload: Schema.Void,
  result: DesktopBrowserStatusSchema,
  handler: Effect.fn("desktop.ipc.browser.reload")(function* () {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    return yield* browser.reload;
  }),
});

export const browserGetStatus = makeIpcMethod({
  channel: IpcChannels.BROWSER_GET_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopBrowserStatusSchema,
  handler: Effect.fn("desktop.ipc.browser.getStatus")(function* () {
    const browser = yield* DesktopBrowserHarness.DesktopBrowserHarness;
    return yield* browser.getStatus;
  }),
});
