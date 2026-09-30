import React from "react";
import renderer, { act } from "react-test-renderer";

let mockGetLocales;
jest.mock("expo-localization", () => ({ getLocales: () => mockGetLocales() }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock("../../utils/api", () => ({ getAppTexts: jest.fn(async () => ({ version: 1, overrides: {} })) }));
jest.mock("../../constants/Languages", () => ({ translations: { zh: { greeting: "你好" }, en: { greeting: "Hello" } } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, captured;
beforeEach(() => { jest.doMock("react", () => React); captured = null; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

async function mount() {
  let context;
  jest.isolateModules(() => { context = require("../LocaleContext"); });
  function Capture() { captured = React.useContext(context.LocaleContext); return null; }
  await act(async () => { tree = renderer.create(<context.LocaleProvider><Capture /></context.LocaleProvider>); });
}

test.each([[], null, undefined, [{}], [null]])("missing device locales %p safely use the existing Chinese default", async locales => {
  mockGetLocales = () => locales;
  await mount();
  expect(captured.locale).toBe("zh");
  expect(captured.i18n.t("greeting")).toBe("你好");
});

test("a native locale lookup exception does not prevent mounting", async () => {
  mockGetLocales = () => { throw new Error("locale service unavailable"); };
  await mount(); expect(captured.locale).toBe("zh");
});

test.each([["en", "en"], ["zh", "zh"], ["fr", "zh"]])("device language %s retains default %s and language switching", async (device, expected) => {
  mockGetLocales = () => [{ languageCode: device }];
  await mount(); expect(captured.locale).toBe(expected);
  await act(async () => captured.changeLanguage());
  expect(captured.locale).toBe(expected === "en" ? "zh" : "en");
  expect(captured.i18n.locale).toBe(captured.locale);
});
