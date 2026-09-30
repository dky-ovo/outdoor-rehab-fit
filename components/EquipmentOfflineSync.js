import { useContext, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { AuthContext } from "../contexts/AuthContext";
import { getBookmarks, subscribeBookmarkChanges } from "../utils/bookmarks";
import { getEquipmentCatalog, loadCachedEquipmentCatalog, subscribeEquipmentCatalog } from "../utils/api";
import { hydrateEquipmentImages, syncEquipmentImages, cancelEquipmentImageSync } from "../utils/equipmentOfflineImages";

const CLOUD_CHECK_INTERVAL_MS = 60000;
const IMAGE_RETRY_DELAYS_MS = [5000, 20000];

/** Public image downloads run independently of authentication and page loading. */
export default function EquipmentOfflineSync() {
	const { user, isLoading, isGuest } = useContext(AuthContext) || {};
	const enabled = !isLoading && Boolean(user);
	const scope = JSON.stringify([user?.id, user?.token, user?.assistantSessionId, Boolean(isGuest ?? user?.isGuest ?? (user?.role === "guest"))]);
	const currentScope = useRef(null);
	// Invalidate old async work during render, before passive-effect cleanup runs.
	currentScope.current = enabled ? scope : null;

	useEffect(() => {
		void Promise.resolve().then(() => hydrateEquipmentImages()).catch(() => {});
	}, []);

	useEffect(() => {
		if (!enabled) return () => cancelEquipmentImageSync();
		let active = true;
		let foreground = !AppState.currentState || AppState.currentState === "active";
		let catalog = null, freshRevision = 0;
		let bookmarks = {}, bookmarksReady = false, localRead = 0;
		let lastSyncedCatalog = null, lastSyncedBookmarks = null;
		let cloudPending = false, lastCloudCheck = null;
		let syncGeneration = 0, retryTimer = null;
		const current = () => active && currentScope.current === scope;
		const canDownload = () => current() && foreground;
		const resetRetry = () => {
			syncGeneration += 1;
			clearTimeout(retryTimer);
			retryTimer = null;
		};
		const runPlan = (generation, planCatalog, planBookmarks, retry = 0) => {
			const stillCurrent = () => canDownload() && generation === syncGeneration
				&& catalog === planCatalog && bookmarks === planBookmarks;
			if (!stillCurrent()) return;
			try {
				void Promise.resolve(syncEquipmentImages(planCatalog, { bookmarks: planBookmarks })).then(result => {
					if (!stillCurrent() || result?.status !== "complete" || !Number.isSafeInteger(result.failed)
						|| result.failed <= 0 || retry >= IMAGE_RETRY_DELAYS_MS.length) return;
					retryTimer = setTimeout(() => {
						retryTimer = null;
						runPlan(generation, planCatalog, planBookmarks, retry + 1);
					}, IMAGE_RETRY_DELAYS_MS[retry]);
				}).catch(() => {});
			} catch { /* Image caching cannot prevent use of the app. */ }
		};
		const sync = () => {
			if (!canDownload() || !bookmarksReady || !catalog) return;
			if (catalog === lastSyncedCatalog && bookmarks === lastSyncedBookmarks) return;
			resetRetry();
			lastSyncedCatalog = catalog; lastSyncedBookmarks = bookmarks;
			runPlan(syncGeneration, catalog, bookmarks);
		};
		const receive = (value, fresh) => {
			if (!current() || !Array.isArray(value?.items)) return;
			if (!fresh && freshRevision !== 0) return;
			if (fresh) freshRevision += 1;
			catalog = value;
			sync();
		};
		const loadLocal = () => {
			const reading = ++localRead;
			bookmarksReady = false;
			void Promise.resolve().then(() => current() ? getBookmarks() : {}).catch(() => ({})).then(value => {
				if (!current() || reading !== localRead) return;
				bookmarks = value && typeof value === "object" && !Array.isArray(value) ? value : {};
				bookmarksReady = true;
				sync();
			});
			void Promise.resolve().then(() => current() ? loadCachedEquipmentCatalog() : null).then(value => {
				if (reading === localRead) receive(value, false);
			}).catch(() => {});
		};
		const checkCloud = () => {
			if (!canDownload() || cloudPending || (lastCloudCheck !== null && Date.now() - lastCloudCheck < CLOUD_CHECK_INTERVAL_MS)) return;
			cloudPending = true;
			lastCloudCheck = Date.now();
			const revisionAtStart = freshRevision;
			void Promise.resolve().then(() => current() ? getEquipmentCatalog({ forceRefresh: true }) : null).then(value => {
				// A subscriber may already have delivered this request, or a newer one.
				if (freshRevision === revisionAtStart || catalog === value) receive(value, true);
			}).catch(() => {}).finally(() => { cloudPending = false; });
		};
		const unsubscribe = subscribeEquipmentCatalog(value => receive(value, true));
		const unsubscribeBookmarks = subscribeBookmarkChanges?.(() => { if (canDownload()) loadLocal(); });
		const listener = AppState.addEventListener("change", state => {
			if (!current()) return;
			const wasForeground = foreground;
			foreground = state === "active";
			if (!foreground) {
				resetRetry();
				cancelEquipmentImageSync();
				lastSyncedCatalog = null; lastSyncedBookmarks = null;
			} else if (!wasForeground) {
				loadLocal();
				checkCloud();
			}
		});
		loadLocal();
		checkCloud();
		return () => {
			active = false;
			resetRetry();
			unsubscribe?.();
			unsubscribeBookmarks?.();
			listener?.remove();
			cancelEquipmentImageSync();
		};
	}, [enabled, scope]);

	return null;
}
