// FILE: LocaleContext.js
import React, { createContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18n } from "i18n-js";
import { translations } from "../constants/Languages";
import { getLocales } from "expo-localization";
import { getAppTexts } from "../utils/api";
import { applyAppTextOverrides, normalizeAppTextOverrides, setAppTextOverrides } from "../utils/appText";
import { saveAccountLanguage } from '../utils/accountPreferences';

// Some device locale providers can return an empty list or fail during startup.
// Keep the existing Chinese default instead of preventing the app from mounting.
let deviceLanguage;
try { deviceLanguage = getLocales()?.[0]?.languageCode; } catch { /* Use the default below. */ }
// Initialize I18n with the translations
const i18n = new I18n(translations);
// if not en/zh, then zh
i18n.locale = deviceLanguage === "en" ? "en" : "zh";

export const LocaleContext = createContext();

export const LocaleProvider = ({ children }) => {
	const [locale, setLocale] = useState(i18n.locale);
	const [overrides, setOverrides] = useState({});
	const localized = useRef(null);
	const overridesSignature = useRef('[]');
	if (!localized.current) {
		localized.current = new I18n(translations);
		localized.current.locale = locale;
	}
	useEffect(() => {
		let active = true, remoteApplied = false, inFlight = false, lastRefresh = 0;
		const accept = payload => {
			const clean = normalizeAppTextOverrides(payload);
			if (!active) return;
			setAppTextOverrides(clean);
			const signature = JSON.stringify(Object.keys(clean).sort().map(key => [key, clean[key].zh ?? null, clean[key].en ?? null]));
			if (signature === overridesSignature.current) return;
			overridesSignature.current = signature;
			// Keep this instance stable: chat and journal effects depend on i18n.
			// Replacing it for a text refresh would reload their user-owned drafts.
			// Store full bundled-plus-override dictionaries so reset-to-defaults
			// also replaces previously customized strings, rather than merging only
			// the remaining custom entries and accidentally retaining removed text.
			localized.current.store({ zh: applyAppTextOverrides('copy', translations.zh, 'zh', clean), en: applyAppTextOverrides('copy', translations.en, 'en', clean) });
			setOverrides(clean);
		};
		AsyncStorage.getItem('outdoor-fit-app-texts-v1').then(raw => { if (active && !remoteApplied && raw) accept(JSON.parse(raw)); }).catch(() => {});
		const refresh = async () => {
			if (inFlight || Date.now() - lastRefresh < 30000) return;
			inFlight = true; lastRefresh = Date.now();
			try { const result = await getAppTexts(); if (!active) return; accept(result); remoteApplied = true; await AsyncStorage.setItem('outdoor-fit-app-texts-v1', JSON.stringify({ version: 1, overrides: normalizeAppTextOverrides(result) })); }
			catch { /* Offline / older servers keep the last valid text and bundled defaults. */ }
			finally { inFlight = false; }
		};
		refresh();
		const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
		return () => { active = false; subscription?.remove(); };
	}, []);
	const applyAccountLanguage = (newLocale) => {
		if (!['zh', 'en'].includes(newLocale)) return;
		i18n.locale = newLocale;
		localized.current.locale = newLocale;
		setLocale(newLocale);
	};
	const changeLanguage = () => {
		const next = locale === 'en' ? 'zh' : 'en'; applyAccountLanguage(next);
		void saveAccountLanguage(next).catch(() => {});
	};

	return <LocaleContext.Provider value={{ i18n: localized.current, locale, changeLanguage, applyAccountLanguage, textRevision: overrides }}>{children}</LocaleContext.Provider>;
};
