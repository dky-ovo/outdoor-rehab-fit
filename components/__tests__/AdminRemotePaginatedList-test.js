import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import AdminRemotePaginatedList from "../AdminRemotePaginatedList";
import AdminPagination from "../AdminPagination";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const first = { events: [{ id: "first" }], total: 345, page: 1, pageSize: 20, totalPages: 18 };
const second = { ...first, events: [{ id: "second" }], page: 2 };
const load = jest.fn();
const view = (initialData = first, key = "account") => <AdminRemotePaginatedList initialData={initialData} itemsKey="events" loadPage={load} resetKey={key} testID="remote">{(item) => <Text key={item.id} testID="record">{item.id}</Text>}</AdminRemotePaginatedList>;
const ids = () => tree.root.findAllByType(Text).filter((node) => node.props.testID === "record").map((node) => node.props.children);
const button = (id) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === id);
const mount = async (data = first) => act(async () => { tree = renderer.create(view(data)); });
beforeEach(() => { load.mockReset(); load.mockResolvedValue(second); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("first page is reused, next and previous pages are fetched from server", async () => {
	await mount(); expect(load).not.toHaveBeenCalled(); expect(ids()).toEqual(["first"]);
	await act(async () => button("remote-pagination-next").props.onPress());
	expect(load).toHaveBeenCalledWith(2,20); expect(ids()).toEqual(["second"]);
	load.mockResolvedValue(first);
	await act(async () => button("remote-pagination-previous").props.onPress());
	expect(load).toHaveBeenLastCalledWith(1,20); expect(ids()).toEqual(["first"]);
});

test("slow old page never overwrites new filters or refreshed initial data", async () => {
	let finish; load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
	await mount(); await act(async () => button("remote-pagination-next").props.onPress());
	expect(ids()).toEqual([]); expect(button("remote-pagination-next").props.disabled).toBe(true);
	const filtered = { ...first, total: 1, totalPages: 1, events: [{ id: "filtered" }] };
	await act(async () => tree.update(view(filtered)));
	await act(async () => finish(second));
	expect(ids()).toEqual(["filtered"]); expect(button("remote-pagination-next").props.disabled).toBe(true);
});

test("late data from a previous account is ignored", async () => {
	let finish; load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
	await mount(); await act(async () => button("remote-pagination-next").props.onPress());
	await act(async () => tree.update(view({ ...first, events: [{ id: "new-account" }] }, "new-account")));
	await act(async () => finish(second)); expect(ids()).toEqual(["new-account"]);
});

test("error hides previous rows, offers retry, and respects a clamped page from the server", async () => {
	load.mockRejectedValueOnce({ status: 403 }); await mount();
	await act(async () => button("remote-pagination-next").props.onPress()); expect(ids()).toEqual([]);
	expect(tree.root.findAllByType(Text).some((node) => String(node.props.children).includes("无权"))).toBe(true);
	load.mockResolvedValueOnce({ ...first, total: 1, totalPages: 1 });
	await act(async () => button("remote-retry").props.onPress()); expect(ids()).toEqual(["first"]);
	expect(tree.root.findByType(AdminPagination).props.page).toBe(1);
	expect(button("remote-pagination-next").props.disabled).toBe(true);
});
