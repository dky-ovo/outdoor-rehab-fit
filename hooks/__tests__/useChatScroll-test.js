import React from "react";
import { act, create } from "react-test-renderer";
import { Platform } from "react-native";
import { useChatScroll } from "../useChatScroll";

jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

let renderer, current, scroll, scrollToIndex, frame, cancelFrame, frames, nextFrame;
const messageIds = ["latest", "target", "older"];
function Harness(props) {
  current = useChatScroll(props);
  return null;
}
const scrollEvent = y => ({ nativeEvent: { contentOffset: { y } } });
const layoutEvent = (width, height) => ({ nativeEvent: { layout: { width, height } } });
function mount(props = {}) {
  act(() => { renderer = create(<Harness isActive historyKey="person:zh" messageIds={messageIds} {...props} />); });
  scroll = jest.fn();
  scrollToIndex = jest.fn();
  current.listRef.current = { scrollToOffset: scroll, scrollToIndex };
}
function measure({ width = 360, height = 1200, viewportHeight = 500, offset = 0 } = {}) {
  act(() => {
    current.onLayout(layoutEvent(width, viewportHeight));
    current.onContentSizeChange(width, height);
    current.onScroll(scrollEvent(offset));
  });
}

function flushFrames() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach(callback => callback(0)));
}
beforeEach(() => {
  Platform.OS = "web";
  frames = new Map(); nextFrame = 0;
  frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  cancelFrame = jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => frames.delete(id));
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = null; current = null;
  frame.mockRestore(); cancelFrame.mockRestore();
});

test("manual history reading compensates one explicit newest-end insertion without animation", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll.mock.calls).toEqual([[{ offset: 500, animated: false }]]);
  act(() => current.onContentSizeChange(360, 1600));
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("browser anchoring is not compensated twice", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.onScroll(scrollEvent(500)));
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test("at the latest edge a new insertion stays at zero rather than adding its height", () => {
  mount(); measure();
  act(() => current.beforeLatestInsert());
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll).not.toHaveBeenCalled();
  act(() => current.beforeLatestInsert());
  act(() => current.onScroll(scrollEvent(200)));
  act(() => current.onContentSizeChange(360, 1600));
  expect(scroll.mock.calls).toEqual([[{ offset: 0, animated: false }]]);
});

test("history hydration, older-row loading and text remeasurement never scroll on their own", () => {
  mount(); measure({ height: 100 });
  act(() => current.onContentSizeChange(360, 8000));
  act(() => current.onScroll(scrollEvent(700)));
  act(() => current.onContentSizeChange(360, 9200));
  act(() => current.onContentSizeChange(360, 9300));
  expect(scroll).not.toHaveBeenCalled();
});

test("multiple appends in the same render batch retain the earliest snapshot", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.onScroll(scrollEvent(400)));
  act(() => current.beforeLatestInsert());
  act(() => current.onContentSizeChange(360, 1500));
  expect(scroll.mock.calls).toEqual([[{ offset: 600, animated: false }]]);
});

test.each(["onScrollBeginDrag", "onWheel", "onTouchMove", "beforeContentToggle"])("new user input cancels queued compensation: %s", event => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current[event]());
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test.each([[360, 300], [400, 500]])("viewport resize to %s by %s cancels compensation instead of snapping", (width, height) => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.onLayout(layoutEvent(width, height)));
  act(() => current.onContentSizeChange(width, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test("content width change also cancels an append snapshot", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.onContentSizeChange(380, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test.each([
  { isActive: false, historyKey: "person:zh" },
  { isActive: true, historyKey: "other-person:zh" },
  { isActive: true, historyKey: "person:en" },
])("focus/account/language lifecycle changes clear queued work: %p", next => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  const oldContentHandler = current.onContentSizeChange;
  act(() => renderer.update(<Harness {...next} />));
  scroll.mockClear();
  act(() => oldContentHandler(360, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test("returning to focus scrolls once to latest without reviving stale append work", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => renderer.update(<Harness isActive={false} historyKey="person:zh" />));
  act(() => renderer.update(<Harness isActive historyKey="person:zh" />));
  expect(scroll.mock.calls).toEqual([[{ offset: 0, animated: false }]]);
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("explicit send/scroll-to-latest cancels an older history snapshot", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  act(() => current.scrollToLatest());
  act(() => current.onContentSizeChange(360, 1400));
  expect(scroll.mock.calls).toEqual([[{ offset: 0, animated: false }]]);
});

test("unmount cancels queued compensation and no timers or animation frames are created", () => {
  mount(); measure({ offset: 300 });
  act(() => current.beforeLatestInsert());
  const oldContentHandler = current.onContentSizeChange;
  act(() => renderer.unmount()); renderer = null;
  act(() => oldContentHandler(360, 1400));
  expect(scroll).not.toHaveBeenCalled();
});

test("unknown initial metrics cannot create compensation from a history restore", () => {
  mount();
  act(() => current.beforeLatestInsert());
  act(() => current.onLayout(layoutEvent(360, 500)));
  act(() => current.onContentSizeChange(360, 6000));
  expect(scroll).not.toHaveBeenCalled();
});

test.each(["android", "ios"])("%s preserves native anchoring without Web append compensation", os => {
  Platform.OS = os; mount();
  expect(current.onContentSizeChange).toBeUndefined();
  expect(typeof current.onLayout).toBe("function");
  expect(current.onWheel).toBeUndefined();
  expect(current.onTouchMove).toBeUndefined();
  expect(current.maintainVisibleContentPosition).toBeUndefined();
  act(() => current.beforeLatestInsert());
  act(() => current.onScrollBeginDrag());
  expect(current.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  act(() => current.onScroll(scrollEvent(200)));
  expect(current.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  act(() => current.scrollToLatest());
  expect(current.maintainVisibleContentPosition).toBeUndefined();
  expect(scroll.mock.calls).toEqual([[{ offset: 0, animated: false }]]);
});

test.each(["android", "ios", "web"])("%s reveals an explicitly toggled reply only after its new layout and one frame", os => {
  Platform.OS = os; mount();
  act(() => current.beforeContentToggle("target"));
  expect(frame).not.toHaveBeenCalled();
  act(() => current.onReplyLayout("older"));
  expect(frame).not.toHaveBeenCalled();
  act(() => current.onReplyLayout("target"));
  act(() => current.onReplyLayout("target"));
  expect(frame).toHaveBeenCalledTimes(1);
  expect(scrollToIndex).not.toHaveBeenCalled();
  flushFrames();
  expect(scrollToIndex.mock.calls).toEqual([[{ index: 1, viewPosition: 1, animated: false }]]);
  act(() => current.onReplyLayout("target"));
  flushFrames();
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
  expect(scroll).not.toHaveBeenCalled();
});

test("latest reply expansion uses its row top, never scroll-to-bottom", () => {
  mount();
  act(() => current.beforeContentToggle("latest"));
  act(() => current.onReplyLayout("latest"));
  flushFrames();
  expect(scrollToIndex.mock.calls).toEqual([[{ index: 0, viewPosition: 1, animated: false }]]);
  expect(scroll).not.toHaveBeenCalled();
});

test("a stale collapsed-row layout cannot reveal the reply before expanded content is measured", () => {
  mount();
  act(() => current.beforeContentToggle("target", true));
  act(() => current.onReplyLayout("target", false));
  expect(frame).not.toHaveBeenCalled();
  act(() => current.onReplyLayout("target", true));
  flushFrames();
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
  act(() => current.beforeContentToggle("target", false));
  act(() => current.onReplyLayout("target", true));
  flushFrames();
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
  act(() => current.onReplyLayout("target", false));
  flushFrames();
  expect(scrollToIndex).toHaveBeenCalledTimes(2);
});

test("late newest-end insertion resolves the target ID against the latest list index", () => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => renderer.update(<Harness isActive historyKey="person:zh" messageIds={["late-ai", ...messageIds]} />));
  flushFrames();
  expect(scrollToIndex.mock.calls).toEqual([[{ index: 2, viewPosition: 1, animated: false }]]);
  expect(scroll).not.toHaveBeenCalled();
});

test("removed target, unknown target and unrelated layout cannot reveal a different row", () => {
  mount();
  act(() => current.onReplyLayout("target"));
  expect(frame).not.toHaveBeenCalled();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => renderer.update(<Harness isActive historyKey="person:zh" messageIds={["latest", "older"]} />));
  flushFrames();
  act(() => current.beforeContentToggle("missing"));
  act(() => current.onReplyLayout("missing"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

test.each(["onScrollBeginDrag", "onWheel", "onTouchMove"])("user gesture %s cancels a pending reveal and its measured frame", event => {
  mount();
  for (const measured of [false, true]) {
    act(() => current.beforeContentToggle("target"));
    if (measured) act(() => current.onReplyLayout("target"));
    act(() => current[event]());
    act(() => current.onReplyLayout("target"));
    flushFrames();
  }
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

test.each([
  { isActive: false, historyKey: "person:zh" },
  { isActive: true, historyKey: "other-person:zh" },
  { isActive: true, historyKey: "person:en" },
])("focus/account/language change cancels queued reply reveal: %p", next => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  const oldLayout = current.onReplyLayout;
  act(() => renderer.update(<Harness {...next} messageIds={messageIds} />));
  scroll.mockClear();
  act(() => oldLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

test("explicit send cancels reveal even if the old row reports its new layout later", () => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => current.scrollToLatest());
  act(() => current.onReplyLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll.mock.calls).toEqual([[{ offset: 0, animated: false }]]);
});

test.each(["android", "ios", "web"])("%s viewport change cancels a reveal rather than fighting keyboard or rotation", os => {
  Platform.OS = os; mount();
  act(() => current.onLayout(layoutEvent(360, 500)));
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => current.onLayout(layoutEvent(360, 300)));
  act(() => current.onReplyLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

test("an unmeasured-index failure cancels reveal without retries or fallback jumps", () => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => current.onScrollToIndexFailed({ index: 1, highestMeasuredFrameIndex: 0, averageItemLength: 100 }));
  act(() => current.onReplyLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test("rapid toggles replace the pending target rather than revealing stale content", () => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  act(() => current.beforeContentToggle("older"));
  act(() => current.onReplyLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  act(() => current.onReplyLayout("older"));
  flushFrames();
  expect(scrollToIndex.mock.calls).toEqual([[{ index: 2, viewPosition: 1, animated: false }]]);
});

test("unmount cancels a scheduled reply reveal and ignores late layout events", () => {
  mount();
  act(() => current.beforeContentToggle("target"));
  act(() => current.onReplyLayout("target"));
  const oldLayout = current.onReplyLayout;
  act(() => renderer.unmount()); renderer = null;
  act(() => oldLayout("target"));
  flushFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
