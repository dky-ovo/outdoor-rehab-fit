import React from 'react';
import { act, create } from 'react-test-renderer';
import { Platform } from 'react-native';
import { useKeyboardInset } from '../useKeyboardInset';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, state, viewport, doc, win, events, bottom, originalWindow, originalDocument, os;
function Probe() { state = useKeyboardInset(); return null; }
beforeEach(() => {
  os = Platform.OS; Platform.OS = 'web'; events = {}; bottom = 800;
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  viewport = { height: 800, width: 400, offsetTop: 0, scale: 1, addEventListener: (name, callback) => { events[name] = callback; }, removeEventListener: jest.fn() };
  doc = { activeElement: null, addEventListener: (name, callback) => { events[name] = callback; }, removeEventListener: jest.fn() };
  win = { visualViewport: viewport, innerHeight: 800, innerWidth: 400, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount()); tree = null; Platform.OS = os;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
});
const mount = async () => { await act(async () => { tree = create(<Probe />); }); state.containerRef.current = { getBoundingClientRect: () => ({ bottom }) }; };
test('mobile browser lifts only the part covered by the visual viewport', async () => {
  await mount(); doc.activeElement = { tagName: 'TEXTAREA' }; viewport.height = 500;
  await act(async () => events.resize()); expect(state.visible).toBe(true); expect(state.inset).toBe(300);
  viewport.offsetTop = 70; await act(async () => events.scroll()); expect(state.inset).toBe(230);
  bottom = 570; await act(async () => state.onLayout()); expect(state.inset).toBe(0);
  doc.activeElement = null; await act(async () => events.focusout()); expect(state.visible).toBe(false);
});
test('layout resize is not double-compensated and toolbar or zoom changes do not become a keyboard', async () => {
  await mount(); doc.activeElement = { tagName: 'TEXTAREA' }; viewport.height = 750;
  await act(async () => events.resize()); expect(state.visible).toBe(false);
  viewport.height = 500; win.innerHeight = 500; bottom = 500;
  await act(async () => events.resize()); expect(state.visible).toBe(true); expect(state.inset).toBe(0);
  viewport.scale = 1.5; bottom = 800;
  await act(async () => events.resize()); expect(state.visible).toBe(false); expect(state.inset).toBe(0);
});
