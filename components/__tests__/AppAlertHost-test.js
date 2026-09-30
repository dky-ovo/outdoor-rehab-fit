import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, Pressable, Text } from "react-native";
import AppAlertHost from "../AppAlertHost";
import { showAlert } from "../../utils/alert";

jest.mock("react-native", () => ({
	Modal: ({ visible, children }) => visible ? children : null,
	Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
	StyleSheet: { create: (value) => value },
	Platform: { OS: "web" },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("double tapping confirmation runs one action and preserves the next queued dialog", async () => {
	const frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
	const first = jest.fn(); const second = jest.fn();
	let tree;
	try {
		await act(async () => { tree = renderer.create(<AppAlertHost />); });
		await act(async () => {
			showAlert("", "First confirmation", [{ text: "First", onPress: first }]);
			showAlert("", "Second confirmation", [{ text: "Second", onPress: second }]);
		});
		const press = tree.root.findByType(Pressable).props.onPress;
		await act(async () => { press(); press(); });
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
		expect(tree.root.findAllByType(Text).some((node) => node.props.children === "Second confirmation")).toBe(true);
		await act(async () => { tree.root.findByType(Pressable).props.onPress(); });
		expect(second).toHaveBeenCalledTimes(1);
	} finally {
		if (tree) await act(async () => tree.unmount());
		frame.mockRestore();
	}
});

test("a web alert mounts a new portal above existing forms and keeps it for dismissal", async () => {
	const frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
	let tree;
	try {
		await act(async () => { tree = renderer.create(<AppAlertHost />); });
		const hiddenPortal = tree.root.findByType(Modal);
		await act(async () => { showAlert("Warning", "Please complete the form"); });
		const activePortal = tree.root.findByType(Modal);
		expect(activePortal).not.toBe(hiddenPortal);
		expect(activePortal.props.visible).toBe(true);
		await act(async () => { tree.root.findByType(Pressable).props.onPress(); });
		expect(tree.root.findByType(Modal)).toBe(activePortal);
		expect(activePortal.props.visible).toBe(false);
	} finally {
		if (tree) await act(async () => tree.unmount());
		frame.mockRestore();
	}
});

test("account deletion replaces stale dialogs and suppresses API catch messages until acknowledged", async () => {
	const frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 0; });
	let tree;
	try {
		await act(async () => { tree = renderer.create(<AppAlertHost />); });
		const oldAction = jest.fn();
		await act(async () => showAlert("Old action", "Discard unsaved changes?", [{ text: "Discard", onPress: oldAction }]));
		const oldPress = tree.root.findByType(Pressable).props.onPress;
		await act(async () => {
			showAlert("Account deleted", "You have been signed out.", undefined, { sessionEnded: true });
			showAlert("Server error", "This late request failed");
		});
		await act(async () => oldPress());
		expect(oldAction).not.toHaveBeenCalled();
		const text = () => tree.root.findAllByType(Text).map(node => node.props.children);
		expect(text()).toContain("Account deleted"); expect(text()).not.toContain("Old action"); expect(text()).not.toContain("Server error");
		await act(async () => tree.root.findByType(Pressable).props.onPress());
		expect(tree.root.findByType(Modal).props.visible).toBe(false);
		await act(async () => showAlert("New login", "Regular alerts work again"));
		expect(text()).toContain("New login");
		await act(async () => tree.root.findByType(Pressable).props.onPress());
	} finally { if (tree) await act(async () => tree.unmount()); frame.mockRestore(); }
});
