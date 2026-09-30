import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import AdminPaginatedList from "../AdminPaginatedList";
import AdminPagination from "../AdminPagination";
import { adminPageWindow } from "../../utils/adminPagination";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const all = Array.from({ length: 41 }, (_, index) => ({ id: index + 1 }));
const view = (items = all, resetKey = "first") => <AdminPaginatedList items={items} resetKey={resetKey} testID="records">{(item) => <Text key={item.id} testID="record">{item.id}</Text>}</AdminPaginatedList>;
const ids = () => tree.root.findAllByType(Text).filter((node) => node.props.testID === "record").map((node) => node.props.children);
const button = (name) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === `records-pagination-${name}`);
const next = async () => act(async () => button("next").props.onPress());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("20-item pages preserve ordering and disable boundary buttons", async () => {
	await act(async () => { tree = renderer.create(view()); });
	expect(ids()).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
	expect(button("previous").props.disabled).toBe(true);
	await next(); expect(ids()).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
	await next(); expect(ids()).toEqual([41]); expect(button("next").props.disabled).toBe(true);
	await act(async () => button("previous").props.onPress()); expect(ids()[0]).toBe(21);
});

test("search, filter or account key change resets the first page", async () => {
	await act(async () => { tree = renderer.create(view()); }); await next();
	await act(async () => tree.update(view(all, "new-search")));
	expect(ids()[0]).toBe(1); expect(button("previous").props.disabled).toBe(true);
});

test("deleting the last page item falls back without leaving an empty page", async () => {
	await act(async () => { tree = renderer.create(view()); }); await next(); await next();
	await act(async () => tree.update(view(all.slice(0, 40))));
	expect(ids()).toHaveLength(20); expect(ids()[0]).toBe(21);
	await act(async () => tree.update(view([...all.slice(0, 40), { id: 42 }])));
	expect(ids()[0]).toBe(21);
});

test("empty pages have disabled navigation and safe counts", async () => {
	await act(async () => { tree = renderer.create(view([])); });
	expect(ids()).toEqual([]); expect(button("next").props.disabled).toBe(true); expect(button("previous").props.disabled).toBe(true);
	expect(tree.root.findByType(AdminPagination).props.total).toBe(0);
});

test("a normal refresh preserves the current valid page", async () => {
	await act(async () => { tree = renderer.create(view()); }); await next();
	await act(async () => tree.update(view(all.map((item) => ({ ...item })))));
	expect(ids()[0]).toBe(21);
});

test.each([[0, 8, 20, 1], [41, 9, 20, 3], [41, -9, 20, 1], [41, 1.5, 20, 1], [41, NaN, 20, 1]])("window clamps total %s page %s", (total, page, pageSize, expected) => {
	expect(adminPageWindow(total, page, pageSize).page).toBe(expected);
});

test("invalid or overlarge page sizes cannot create unlimited pages", () => {
	expect(adminPageWindow(500, 1, Infinity).pageSize).toBe(20);
	expect(adminPageWindow(500, 1, 500).pageSize).toBe(100);
	expect(adminPageWindow(500, 1, -1).pageSize).toBe(1);
});

test.each([
	{ page: 1, disabled: false, previous: true, next: false, requested: [2] },
	{ page: 3, disabled: false, previous: false, next: true, requested: [2] },
	{ page: 2, disabled: true, previous: true, next: true, requested: [] },
	{ page: 2, disabled: false, previous: false, next: false, requested: [1, 3] },
])("disabled controls never request out-of-range or loading pages: %j", async state => {
	const change = jest.fn();
	await act(async () => { tree = renderer.create(<AdminPagination page={state.page} total={41} disabled={state.disabled} onPageChange={change} testID="records-pagination" />); });
	for (const direction of ["previous", "next"]) {
		expect(button(direction).props.disabled).toBe(state[direction]);
		expect(button(direction).props.accessibilityState.disabled).toBe(state[direction]);
		await act(async () => button(direction).props.onPress());
	}
	expect(change.mock.calls.map(call => call[0])).toEqual(state.requested);
});

test("pagination without a handler is visibly disabled rather than offering nonworking buttons", async () => {
	await act(async () => { tree = renderer.create(<AdminPagination page={2} total={60} testID="records-pagination" />); });
	expect(button("previous").props.disabled).toBe(true); expect(button("next").props.disabled).toBe(true);
	await act(async () => { button("previous").props.onPress(); button("next").props.onPress(); });
});

test.each(["zh-CN", "zh-HK", "en"])("%s page summaries and controls fit wrapping columns with accessible touch sizes", async locale => {
	await act(async () => { tree = renderer.create(<AdminPagination page={2} total={100000} onPageChange={() => {}} locale={locale} testID="records-pagination" />); });
	const summary = tree.root.findByProps({ testID: "records-pagination-summary" });
	expect(summary.props.accessibilityLiveRegion).toBe("polite");
	expect(StyleSheet.flatten(summary.props.style)).toMatchObject({ minWidth: 0, maxWidth: "100%", flexShrink: 1 });
	const controls = tree.root.findByProps({ testID: "records-pagination-buttons" });
	expect(StyleSheet.flatten(controls.props.style)).toMatchObject({ flexWrap: "wrap", minWidth: 0, maxWidth: "100%" });
	for (const direction of ["previous", "next"]) {
		expect(StyleSheet.flatten(button(direction).props.style)).toMatchObject({ minHeight: 44, minWidth: 0, maxWidth: "100%", flexShrink: 1 });
		expect(StyleSheet.flatten(button(direction).findByType(Text).props.style)).toMatchObject({ textAlign: "center", flexShrink: 1, lineHeight: 20 });
	}
});
