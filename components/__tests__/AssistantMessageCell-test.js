import React, { useEffect } from "react";
import renderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import AssistantMessageCell, { AssistantReplyLayoutContext } from "../AssistantMessageCell";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tree;
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

test("the virtualized parent records the exact layout before the reply reveal is notified", () => {
  const order = [];
  const event = { nativeEvent: { layout: { x: 0, y: 420, width: 360, height: 1200 } } };
  const onLayout = jest.fn(value => { expect(value).toBe(event); order.push("parent-measured"); });
  const onReplyMeasured = jest.fn(id => { expect(id).toBe("message-one"); order.push("reply-ready"); });
  act(() => { tree = renderer.create(
    <AssistantReplyLayoutContext.Provider value={onReplyMeasured}>
      <AssistantMessageCell item={{ id: "message-one" }} onLayout={onLayout}><Text>Expanded explanation</Text></AssistantMessageCell>
    </AssistantReplyLayoutContext.Provider>,
  ); });
  act(() => tree.root.findByType(View).props.onLayout(event));
  expect(order).toEqual(["parent-measured", "reply-ready"]);
  expect(onLayout).toHaveBeenCalledTimes(1);
  expect(onReplyMeasured).toHaveBeenCalledTimes(1);
});

test("the cell preserves inversion styles, focus handling and all its children", () => {
  const style = [{ flexDirection: "column-reverse" }, { transform: [{ scaleY: -1 }] }];
  const onFocusCapture = jest.fn();
  act(() => { tree = renderer.create(
    <AssistantMessageCell item={{ id: "reply" }} style={style} onFocusCapture={onFocusCapture}>
      <Text>Explanation</Text><Text>Equipment card</Text>
    </AssistantMessageCell>,
  ); });
  const cell = tree.root.findByType(View);
  expect(cell.props.testID).toBe("assistant-message-cell-reply");
  expect(cell.props.style).toBe(style);
  expect(cell.props.onFocusCapture).toBe(onFocusCapture);
  expect(cell.findAllByType(Text).map(node => node.props.children)).toEqual(["Explanation", "Equipment card"]);
});

test("a standalone cell with optional callbacks absent still renders and measures safely", () => {
  act(() => { tree = renderer.create(<AssistantMessageCell item={{ id: "standalone" }}><Text>Reply</Text></AssistantMessageCell>); });
  expect(() => act(() => tree.root.findByType(View).props.onLayout({ nativeEvent: { layout: { height: 60 } } }))).not.toThrow();
  expect(tree.root.findByType(Text).props.children).toBe("Reply");
});

test("changing the reply-layout context uses the current callback without remounting the row", () => {
  const mounted = jest.fn();
  const unmounted = jest.fn();
  function Child() {
    useEffect(() => { mounted(); return unmounted; }, []);
    return <Text>Persistent reply</Text>;
  }
  const first = jest.fn(); const second = jest.fn();
  const screen = callback => <AssistantReplyLayoutContext.Provider value={callback}>
    <AssistantMessageCell item={{ id: "persistent" }}><Child /></AssistantMessageCell>
  </AssistantReplyLayoutContext.Provider>;
  act(() => { tree = renderer.create(screen(first)); });
  act(() => tree.update(screen(second)));
  act(() => tree.root.findByType(View).props.onLayout({ nativeEvent: { layout: { height: 700 } } }));
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("persistent");
});

test("a failed parent measurement cannot schedule a reveal using stale metrics", () => {
  const onLayout = () => { throw new Error("measurement failed"); };
  const onReplyMeasured = jest.fn();
  act(() => { tree = renderer.create(
    <AssistantReplyLayoutContext.Provider value={onReplyMeasured}>
      <AssistantMessageCell item={{ id: "unmeasured" }} onLayout={onLayout}><Text>Reply</Text></AssistantMessageCell>
    </AssistantReplyLayoutContext.Provider>,
  ); });
  expect(() => tree.root.findByType(View).props.onLayout({ nativeEvent: { layout: {} } })).toThrow("measurement failed");
  expect(onReplyMeasured).not.toHaveBeenCalled();
});
