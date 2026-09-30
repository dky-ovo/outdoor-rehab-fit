import catalog from "../../constants/AppTextCatalog.json";
import { appText, applyAppTextOverrides, normalizeAppTextOverrides, setAppTextOverrides, validAppText } from "../appText";

afterEach(() => setAppTextOverrides(null));
test("normal text edits preserve placeholders with their original multiplicity", () => {
  expect(validAppText("新的 %{name} 說明\n%{count}", "Hello %{count} %{name}")).toBe(true);
  expect(validAppText("没有占位符", "Hello %{name}")).toBe(false);
  expect(validAppText("%{other}", "%{name}")).toBe(false);
  expect(validAppText("%{name} %{name}", "%{name}")).toBe(false);
  expect(validAppText("%{name}", "%{name} %{name}")).toBe(false);
});
test.each([null, undefined, 123, {}, [], "", "  ", "invalid\u0000text", "invalid\u001ftext", "a".repeat(20001)])("invalid override value %p is rejected", value => {
  expect(validAppText(value, "Default")).toBe(false);
});
test("non-string source fields cannot be converted into editable content", () => {
  expect(validAppText("New value", null)).toBe(false);
  expect(validAppText("New value", {})).toBe(false);
  expect(validAppText("a".repeat(20000), "Default")).toBe(true);
  expect(validAppText("Lines\nwith\ttabs", "Default")).toBe(true);
});
test.each(["http://example.test", "javascript:alert(1)", "file:///tmp/file", "https://user:pass@example.test", "not a URL", `https://example.test/${"a".repeat(2048)}`])("unsafe or invalid reference URL %s is rejected", value => {
  expect(validAppText(value, "https://example.test", "url")).toBe(false);
});
test("HTTPS reference links are allowed without altering supplied text", () => {
  expect(validAppText("https://www.who.int/publications/example?q=1#part", "https://example.test", "url")).toBe(true);
});
test.each([null, {}, { version: 2, overrides: {} }, { version: 1, overrides: [] }, { version: 1, overrides: null }])("malformed payload %p fails closed", payload => {
  expect(() => normalizeAppTextOverrides(payload)).toThrow("invalidAppTexts");
});
test("normalization whitelists real catalog keys, each language, placeholders and safe references", () => {
  const ordinary = catalog.items.find(item => item.kind === "text" && typeof item.zh === "string" && typeof item.en === "string" && !item.zh.includes("%{"));
  const token = catalog.items.find(item => item.zh?.includes("%{"));
  const url = catalog.items.find(item => item.kind === "url");
  const oneLanguage = catalog.items.find(item => typeof item.zh === "string" && item.en === null);
  const payload = JSON.parse(JSON.stringify({ version: 1, overrides: {
    [ordinary.key]: { zh: "有效中文", en: "Valid English", untrusted: "ignored" },
    [token.key]: { zh: "删除占位符", en: token.en },
    [url.key]: { zh: "http://unsafe.test", en: "https://example.test/reference" },
    [oneLanguage.key]: { zh: "有效单语", en: "Invented field" },
    "unknown.key": { zh: "must not create" },
  } }));
  payload.overrides.__proto__ = { polluted: true };
  const result = normalizeAppTextOverrides(payload);
  expect(Object.getPrototypeOf(result)).toBeNull();
  expect(result[ordinary.key]).toEqual({ zh: "有效中文", en: "Valid English" });
  expect(result[token.key]).toEqual({ en: token.en });
  expect(result[url.key]).toEqual({ en: "https://example.test/reference" });
  expect(result[oneLanguage.key]).toEqual({ zh: "有效单语" });
  expect(result["unknown.key"]).toBeUndefined();
  expect(result.polluted).toBeUndefined();
});
test("appText selects the current language and substitutes only own provided parameters", () => {
  const defaults = { zh: "原文 %{name} %{count}", en: "Original %{name} %{count}" };
  setAppTextOverrides({ "copy.example": { zh: "新文 %{name} %{count}", en: "New %{name} %{count}" } });
  expect(appText("zh-HK", "copy.example", defaults, {name:"測試",count:0})).toBe("新文 測試 0");
  expect(appText("en-GB", "copy.example", defaults, {name:"Test"})).toBe("New Test %{count}");
  expect(appText("zh", "copy.example", defaults, Object.create({name:"inherited"}))).toBe("新文 %{name} %{count}");
  setAppTextOverrides(null);
  expect(appText("en", "copy.example", defaults, {name:"Test",count:2})).toBe("Original Test 2");
  expect(appText("en", "one-language", {zh:"只含中文"})).toBe("只含中文");
});
test("recursive application supports dictionaries, arrays and URLs without mutating defaults or structural values", () => {
  const source = { heading: "原标题", list: [{ text: "原说明", url: "https://old.test" }, "第二条"], enabled: true, count: 7, optional: null };
  const before = JSON.stringify(source);
  const overrides = { "page.heading": {zh:"新标题",en:"New title"}, "page.list.0.text": {zh:"新说明"}, "page.list.0.url": {zh:"https://new.test"}, "page.list.1": {zh:"新第二条"}, "page.count": {zh:"must not change number"} };
  expect(applyAppTextOverrides("page",source,"zh-HK",overrides)).toEqual({ heading:"新标题",list:[{text:"新说明",url:"https://new.test"},"新第二条"],enabled:true,count:7,optional:null });
  expect(applyAppTextOverrides("page",source,"en",overrides)).toEqual({ ...source, heading:"New title" });
  expect(JSON.stringify(source)).toBe(before);
  setAppTextOverrides(overrides);
  expect(applyAppTextOverrides("page",source,"zh").heading).toBe("新标题");
});
