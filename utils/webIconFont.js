import { Asset } from "expo-asset";

const fonts = new Map();
const RETRY_DELAY_MS = 2000;
const keyFor = (family, source, style) => JSON.stringify([family, source, style.fontWeight || "normal", style.fontStyle || "normal"]);
function entryFor(family, source, style) {
    const key = keyFor(family, source, style);
    if (!fonts.has(key)) fonts.set(key, { status: "idle", listeners: new Set(), retryAfter: 0 });
    return fonts.get(key);
}

export function isWebIconFontLoaded(family, source, style = {}) {
    return fonts.get(keyFor(family, source, style))?.status === "loaded";
}

export function subscribeWebIconFont(family, source, style, listener) {
    const entry = entryFor(family, source, style);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
}

// A face is shared across every icon. Successful loads remain ready on the
// very first render of a newly opened page; failed loads can recover online.
export function loadWebIconFont(family, source, style = {}) {
    if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(false);
    const entry = entryFor(family, source, style);
    if (entry.status === "loaded" || entry.status === "loading") return entry.promise;
    if (entry.retryAfter > Date.now()) return Promise.resolve(false);
    entry.status = "loading";
    entry.promise = Promise.resolve().then(async () => {
        const Face = window.FontFace || globalThis.FontFace;
        if (typeof Face !== "function" || !document.fonts?.add) return false;
        const uri = typeof source === "string" ? source : source?.uri || Asset.fromModule(source).uri;
        if (!uri) return false;
        const face = new Face(family, `url(${JSON.stringify(uri)})`, {
            display: "block", weight: String(style.fontWeight || "normal"), style: style.fontStyle || "normal",
        });
        await face.load();
        document.fonts.add(face);
        return true;
    }).catch(() => false).then(ready => {
        entry.status = ready ? "loaded" : "failed";
        entry.retryAfter = ready ? 0 : Date.now() + RETRY_DELAY_MS;
        for (const listener of entry.listeners) listener(ready);
        return ready;
    });
    return entry.promise;
}
