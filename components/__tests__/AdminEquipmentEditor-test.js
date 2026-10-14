import React, { useState } from "react";
import renderer, { act } from "react-test-renderer";
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import AdminEquipmentEditor from "../AdminEquipmentEditor";
import AdminMediaField from "../AdminMediaField";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../AdminMediaField", () => jest.fn(() => null));

const BASE = {
  id: "equipment-1", code: "N1", nameZh: "測試器材", nameEn: "Test equipment", categories: ["muscle"],
  isActive: true, sortOrder: 4, imageUrl: "", previewSource: { uri: "https://example.test/existing.jpg" },
  gifLeftUrl: "left.gif", gifRightUrl: "right.gif", videoUrl: "shared.mp4", youtubeKey: "legacy-key",
  videoUrlZh: "", videoUrlEn: "", videoLocalesEnabled: false, tcmEnabled: true,
  ...Object.fromEntries(["details", "kinesiology", "ptTip", "otTip", "tcm", "careTip"].flatMap(prefix => [[`${prefix}Zh`, `${prefix} 中文`], [`${prefix}En`, `${prefix} English`]])),
  preservedServerField: { version: 8 },
};
let tree, draft, setDraft, props;
const byId = id => tree.root.findAll(node => node.props.testID === id)[0];
const button = id => tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === id);
const input = field => tree.root.findAllByType(TextInput).find(node => node.props.testID === `equipment-editor-${field}`);
const words = children => Array.isArray(children) ? children.map(words).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
const texts = () => tree.root.findAllByType(Text).map(node => words(node.props.children));
const press = async id => act(async () => button(id).props.onPress());
const change = async (name, value) => act(async () => input(name).props.onChangeText(value));
function Harness({ initialValue, ...editorProps }) {
  [draft, setDraft] = useState(initialValue);
  return <AdminEquipmentEditor {...editorProps} value={draft} onChange={setDraft} />;
}
async function mount(overrides = {}, initialValue = BASE) {
  props = { token: "test-token", permissions: ["app_maintenance.equipment.manage"], categories: [{ id: "muscle", nameZh: "肌肉強化", nameEn: "Strength" }], onClose: jest.fn(), onSave: jest.fn(), onDelete: jest.fn(), ...overrides };
  await act(async () => { tree = renderer.create(<Harness {...props} initialValue={initialValue} />); });
}
async function updateProps(patch) {
  props = { ...props, ...patch };
  await act(async () => tree.update(<Harness {...props} initialValue={BASE} />));
}
beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("appended videos retain their identity and language while sections retain unsaved edits", async () => {
  await mount(); await press("equipment-editor-tab-media");
  await press("equipment-editor-add-video"); await press("equipment-editor-add-video");
  const [first, second] = draft.additionalVideos;
  expect(first.id).not.toBe(second.id);
  const fields = tree.root.findAllByType(AdminMediaField);
  await act(async () => fields[5].props.onChange("/api/media/a/a.mp4"));
  expect(draft.additionalVideos.map(item => item.id)).toEqual([first.id, second.id]);
  expect(draft.additionalVideos[0]).toMatchObject({ videoUrlZh: "/api/media/a/a.mp4", videoUrlEn: "" });
  await press("equipment-editor-tab-teaching"); await press("equipment-editor-add-section");
  const section = draft.teachingSections[0];
  await change(`${section.id}-titleZh`, "家居練習"); await change(`${section.id}-bodyEn`, "At home");
  await press("equipment-editor-teaching-details"); await press(`equipment-editor-teaching-${section.id}`);
  expect(input(`${section.id}-titleZh`).props.value).toBe("家居練習");
  expect(draft.teachingSections[0].bodyEn).toBe("At home");
  await press("equipment-editor-close"); expect(button("equipment-editor-discard")).toBeTruthy();
});

test("a closed editor renders no modal and opening starts with basic information", async () => {
  await mount({}, null);
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  await act(async () => setDraft(BASE));
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  expect(input("nameZh").props.value).toBe(BASE.nameZh);
  expect(tree.root.findAllByType(AdminMediaField)).toHaveLength(0);
  expect(texts()).toContain("N1 · ID equipment-1");
});

test("tab changes retain draft fields and every bilingual teaching section", async () => {
  await mount();
  await change("nameEn", "Edited equipment");
  await change("sortOrder", "25");
  await press("equipment-editor-active");
  await press("equipment-editor-tab-teaching");
  for (const prefix of ["details", "kinesiology", "ptTip", "otTip", "tcm", "careTip"]) {
    await press(`equipment-editor-teaching-${prefix}`);
    expect(input(`${prefix}Zh`).props.value).toBe(BASE[`${prefix}Zh`]);
    expect(input(`${prefix}En`).props.value).toBe(BASE[`${prefix}En`]);
    await change(`${prefix}Zh`, `${prefix} changed`);
    await change(`${prefix}En`, `${prefix} translated`);
  }
  await press("equipment-editor-tab-basic");
  expect(input("nameEn").props.value).toBe("Edited equipment");
  expect(draft).toMatchObject({ sortOrder: "25", isActive: false, preservedServerField: BASE.preservedServerField });
  for (const prefix of ["details", "kinesiology", "ptTip", "otTip", "tcm", "careTip"]) {
    expect(draft[`${prefix}Zh`]).toBe(`${prefix} changed`);
    expect(draft[`${prefix}En`]).toBe(`${prefix} translated`);
  }
  await press("equipment-editor-save");
  expect(props.onSave).toHaveBeenCalledTimes(1);
});

test("turning Chinese medicine off preserves both languages and blocks editing until enabled", async () => {
  await mount();
  await press("equipment-editor-tab-teaching");
  await press("equipment-editor-teaching-tcm");
  await press("equipment-editor-tcmEnabled");
  expect(input("tcmZh").props.editable).toBe(false);
  expect(input("tcmEn").props.editable).toBe(false);
  await change("tcmZh", "must not replace");
  expect(draft).toMatchObject({ tcmEnabled: false, tcmZh: BASE.tcmZh, tcmEn: BASE.tcmEn });
  await press("equipment-editor-tcmEnabled");
  expect(input("tcmZh").props.editable).toBe(true);
});

test("media preserves equipment permissions, both GIFs, preview and language-video compatibility", async () => {
  await mount();
  await press("equipment-editor-tab-media");
  const fields = tree.root.findAllByType(AdminMediaField);
  expect(fields.map(node => node.props.label)).toEqual(["器材图片", "左侧动作 GIF", "右侧动作 GIF", "中文设施教学视频", "英文设施教学视频"]);
  for (const field of fields) expect(field.props).toMatchObject({ token: "test-token", permissions: ["app_maintenance.equipment.manage"], disabled: false });
  expect(fields[1].props.value).toBe("left.gif");
  expect(fields[2].props.value).toBe("right.gif");
  expect(fields[3].props.legacyValue).toBe("shared.mp4");
  expect(fields[4].props.legacyValue).toBe("shared.mp4");
  expect(tree.root.findByType(Image).props.source).toEqual(BASE.previewSource);
  await act(async () => fields[3].props.onChange("new-zh.mp4"));
  expect(draft).toMatchObject({ videoUrlZh: "new-zh.mp4", videoUrlEn: "", videoLocalesEnabled: true, videoUrl: "shared.mp4", youtubeKey: "legacy-key" });
  expect(tree.root.findAllByType(AdminMediaField)[4].props.legacyValue).toBe("");
  await act(async () => tree.root.findAllByType(AdminMediaField)[4].props.onChange("new-en.mp4"));
  await act(async () => tree.root.findAllByType(AdminMediaField)[3].props.onChange(""));
  expect(draft).toMatchObject({ videoUrlZh: "", videoUrlEn: "new-en.mp4", videoLocalesEnabled: true });
  expect(tree.root.findAllByType(AdminMediaField)[3].props.legacyValue).toBe("");
  await act(async () => tree.root.findAllByType(AdminMediaField)[0].props.onChange("replacement.jpg"));
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
  expect(draft.imageUrl).toBe("replacement.jpg");
});

test("legacy YouTube key remains a read-only compatible source until a localized video is selected", async () => {
  await mount({}, { ...BASE, videoUrl: "" });
  await press("equipment-editor-tab-media");
  expect(tree.root.findAllByType(AdminMediaField)[3].props.legacyValue).toBe("legacy-key");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

test.each(["record", "account", "closed", "saving"])("a late media picker result cannot write after %s changes", async kind => {
  await mount();
  await press("equipment-editor-tab-media");
  const lateChange = tree.root.findAllByType(AdminMediaField)[0].props.onChange;
  if (kind === "record") await act(async () => setDraft({ ...BASE, id: "equipment-2" }));
  if (kind === "account") await updateProps({ token: "different-account" });
  if (kind === "closed") await act(async () => setDraft(null));
  if (kind === "saving") await updateProps({ saving: true });
  await act(async () => lateChange("late-upload.jpg"));
  if (kind === "closed") expect(draft).toBeNull();
  else expect(draft.imageUrl).toBe("");
});

test("categories paginate with a 32 selection limit without removing other draft fields", async () => {
  const categories = Array.from({ length: 40 }, (_, i) => ({ id: `category-${i}`, nameZh: `分类 ${i}`, nameEn: `Category ${i}` }));
  await mount({ categories }, { ...BASE, categories: categories.slice(0, 32).map(item => item.id) });
  const visibleChoices = () => tree.root.findAllByType(TouchableOpacity).filter(node => String(node.props.testID).startsWith("equipment-editor-category-"));
  expect(visibleChoices()).toHaveLength(20);
  await press("equipment-category-options-pagination-next");
  expect(visibleChoices()).toHaveLength(20);
  expect(button("equipment-editor-category-category-32").props.disabled).toBe(true);
  await press("equipment-editor-category-category-32");
  expect(draft.categories).toHaveLength(32);
  await press("equipment-editor-category-category-31");
  expect(button("equipment-editor-category-category-32").props.disabled).toBe(false);
  await press("equipment-editor-category-category-32");
  expect(draft.categories).toHaveLength(32);
  expect(draft.categories).toContain("category-32");
  expect(draft.preservedServerField).toEqual(BASE.preservedServerField);
});

test("footer and visible save error remain outside the scrolling form", async () => {
  await mount({ error: "保存失败，请检查分类。" });
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.findAll(node => node.props.testID === "equipment-editor-footer")).toHaveLength(0);
  expect(scroll.findAll(node => node.props.testID === "equipment-editor-error")).toHaveLength(0);
  expect(byId("equipment-editor-error")).toBeDefined();
  expect(texts()).toContain("保存失败，请检查分类。");
  expect(StyleSheet.flatten(byId("equipment-editor-dialog").props.style)).toMatchObject({ height: "96%", minHeight: 0, overflow: "hidden" });
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  await press("equipment-editor-tab-media");
  expect(button("equipment-editor-save")).toBeDefined();
  expect(byId("equipment-editor-error")).toBeDefined();
});

test("unchanged cancel closes immediately, while an edited draft gets one in-modal confirmation", async () => {
  await mount();
  await press("equipment-editor-cancel");
  expect(props.onClose).toHaveBeenCalledTimes(1);
  props.onClose.mockClear();
  await change("nameZh", "新名称");
  await press("equipment-editor-close");
  expect(props.onClose).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  expect(texts()).toContain("有尚未保存的更改");
  expect(button("equipment-editor-save")).toBeUndefined();
  await press("equipment-editor-continue");
  expect(input("nameZh").props.value).toBe("新名称");
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  await press("equipment-editor-discard");
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onSave).not.toHaveBeenCalled();
});

test("draft edits do not reset the baseline, but changing record or closing and reopening does", async () => {
  await mount();
  await change("nameZh", "Changed once");
  await change("nameZh", "Changed twice");
  await press("equipment-editor-cancel");
  expect(button("equipment-editor-discard")).toBeDefined();
  await act(async () => setDraft({ ...BASE, id: "different", nameZh: "Other equipment" }));
  expect(button("equipment-editor-discard")).toBeUndefined();
  await press("equipment-editor-cancel");
  expect(props.onClose).toHaveBeenCalledTimes(1);
  await change("nameZh", "Other edit");
  await act(async () => setDraft(null));
  await act(async () => setDraft({ ...BASE, id: "different", nameZh: "Reopened" }));
  await press("equipment-editor-cancel");
  expect(props.onClose).toHaveBeenCalledTimes(2);
});

test("account scope changes reset unsaved confirmation and teaching selection", async () => {
  await mount();
  await press("equipment-editor-tab-teaching");
  await press("equipment-editor-teaching-tcm");
  await change("tcmZh", "Edited note");
  await press("equipment-editor-close");
  await updateProps({ token: "different-user-token" });
  expect(button("equipment-editor-discard")).toBeUndefined();
  expect(input("nameZh")).toBeDefined();
  await press("equipment-editor-cancel");
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test("saving guards every mutation, close route and delete callback", async () => {
  await mount({ saving: true });
  expect(input("nameZh").props.editable).toBe(false);
  await change("nameZh", "must not change");
  for (const id of ["active", "category-muscle", "save", "delete", "close", "cancel"]) {
    expect(button(`equipment-editor-${id}`).props.disabled).toBe(true);
    await press(`equipment-editor-${id}`);
  }
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  await press("equipment-editor-tab-media");
  for (const field of tree.root.findAllByType(AdminMediaField)) {
    expect(field.props.disabled).toBe(true);
    await act(async () => field.props.onChange("must-not-change"));
  }
  await press("equipment-editor-tab-teaching");
  await press("equipment-editor-teaching-tcm");
  await press("equipment-editor-tcmEnabled");
  await change("tcmZh", "must not change");
  expect(draft).toEqual(BASE);
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onSave).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();
});

test("an in-progress save also disables an already displayed discard confirmation", async () => {
  await mount();
  await change("nameZh", "Changed");
  await press("equipment-editor-close");
  await updateProps({ saving: true });
  for (const id of ["continue", "discard", "close"]) {
    expect(button(`equipment-editor-${id}`).props.disabled).toBe(true);
    await press(`equipment-editor-${id}`);
  }
  expect(props.onClose).not.toHaveBeenCalled();
  expect(button("equipment-editor-discard")).toBeDefined();
});

test("delete remains a parent-owned action and new equipment has no delete button", async () => {
  await mount();
  await press("equipment-editor-delete");
  expect(props.onDelete).toHaveBeenCalledTimes(1);
  expect(draft).toEqual(BASE);
  await act(async () => setDraft({ ...BASE, id: undefined, isNew: true }));
  expect(button("equipment-editor-delete")).toBeUndefined();
});

test.each([["en", "Edit facility guide", "Bilingual teaching", "Discard changes and close"], ["zh-HK", "編輯設施教學", "雙語教學", "放棄更改並退出"]])("editor and confirmation use %s wording", async (locale, title, teachingTitle, discardTitle) => {
  await mount({ locale });
  expect(texts()).toContain(title);
  expect(texts()).toContain(teachingTitle);
  await change("nameZh", "Changed");
  await press("equipment-editor-close");
  expect(texts()).toContain(discardTitle);
});
