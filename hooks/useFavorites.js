import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getCachedEquipmentCatalog, getEquipmentCatalog, loadCachedEquipmentCatalog, subscribeEquipmentCatalog } from "../utils/api";
import { getBookmarks, getCachedBookmarks, saveBookmarks, subscribeBookmarkChanges } from "../utils/bookmarks";
import { equipmentLearningFlags, getLearningProgress } from "../utils/learning";
import { mergeEquipmentCatalog } from "../utils/equipmentCatalog";
import { subscribeAccountData } from '../utils/accountSyncEvents';
import { getCurrentOwnerKey } from '../utils/userStorage';

export function useFavorites({ user, isGuest, canAccessEquipment, i18n, locale, textRevision }) {
	const scope = JSON.stringify([user?.id, user?.token, user?.assistantSessionId, user?.phone, user?.email, isGuest]);
	const scopeRef = useRef(scope); scopeRef.current = scope;
	const modelRef = useRef(null);
	if (modelRef.current?.scope !== scope) {
		const cached = getCachedBookmarks?.() ?? null;
		modelRef.current = { scope, bookmarked: cached || {}, committed: cached || {}, progress: {}, ready: cached !== null, revision: 0 };
	}
	const [state, setState] = useState(modelRef.current);
	const [remoteItems, setRemoteItems] = useState(() => getCachedEquipmentCatalog()?.items || null);
	const [catalogLoading, setCatalogLoading] = useState(true);
	const catalogRequest = useRef(null);
	const saveQueue = useRef(Promise.resolve());
	const focused = useRef(false);
	const base = useMemo(() => {
		const items = i18n.t("equipmentList", { returnObjects: true });
		return Array.isArray(items) ? items : [];
	}, [i18n, locale, textRevision]);
	const catalog = useMemo(() => mergeEquipmentCatalog(base, remoteItems || [], locale, { imageCatalogReady: remoteItems !== null }), [base, remoteItems, locale]);

	useFocusEffect(useCallback(() => {
		let active = true;
		focused.current = true;
		const current = () => active && scopeRef.current === scope;
		const publish = patch => {
			if (!current()) return;
			modelRef.current = { ...modelRef.current, ...patch };
			setState(modelRef.current);
		};
		const revision = modelRef.current.revision;
		const unsubscribeBookmarks = subscribeBookmarkChanges?.(() => {
			void saveQueue.current.then(async () => {
				const bookmarked = await getBookmarks();
				if (current()) publish({ bookmarked, committed: bookmarked, ready: true });
			}).catch(() => {});
		});
		// Only local storage gates the initial cards. Slow catalog/learning reads
		// update independently, and revisiting this account keeps its current cards.
		void saveQueue.current.then(async () => {
			if (!current()) return;
			const bookmarked = await getBookmarks();
			if (current() && modelRef.current.revision === revision) publish({ bookmarked, committed: bookmarked, ready: true });
		}).catch(() => publish({ ready: true }));
		void getLearningProgress().then(progress => publish({ progress })).catch(() => {});
		const unsubscribeLearning = subscribeAccountData(event => {
			if (event.kind === 'learning' && event.owner === getCurrentOwnerKey()) void getLearningProgress().then(progress => publish({ progress })).catch(() => {});
		});
		setCatalogLoading(true);
		let receivedFreshCatalog = false;
		const unsubscribe = subscribeEquipmentCatalog?.(result => {
			if (current() && Array.isArray(result?.items)) { receivedFreshCatalog = true; setRemoteItems(result.items); }
		});
		void loadCachedEquipmentCatalog().then(result => {
			if (current() && !receivedFreshCatalog && Array.isArray(result?.items)) setRemoteItems(result.items);
		}).catch(() => {});
		// Rapid focus changes reuse one public request instead of accumulating
		// connections. The API bounds fetch and response-body reading to 15 seconds.
		if (!catalogRequest.current) {
			const pending = getEquipmentCatalog();
			catalogRequest.current = pending;
			const clear = () => { if (catalogRequest.current === pending) catalogRequest.current = null; };
			void pending.then(clear, clear);
		}
		void catalogRequest.current.then(result => {
			if (current() && Array.isArray(result?.items)) {
				receivedFreshCatalog = true;
				setRemoteItems(result.items);
			}
		}).catch(() => {}).finally(() => { if (current()) setCatalogLoading(false); });
		return () => { active = false; focused.current = false; unsubscribe?.(); unsubscribeBookmarks?.(); unsubscribeLearning(); };
	}, [scope]));

	const toggleBookmark = useCallback(itemId => {
		const model = modelRef.current;
		if (!focused.current || model.scope !== scope || !model.ready || (isGuest && !canAccessEquipment(itemId))) return Promise.resolve(false);
		const bookmarked = { ...model.bookmarked };
		if (bookmarked[itemId]) delete bookmarked[itemId];
		else bookmarked[itemId] = true;
		const revision = model.revision + 1;
		modelRef.current = { ...model, bookmarked, revision };
		setState(modelRef.current);
		// Capture each desired snapshot, serialize writes, and never let a delayed
		// save begin in a different session. The storage helper also captures owner.
		const operation = saveQueue.current.then(async () => {
			if (scopeRef.current !== scope) return false;
			await saveBookmarks(bookmarked, { changedIds: [itemId] });
			if (scopeRef.current === scope) modelRef.current = { ...modelRef.current, committed: bookmarked };
			return true;
		}).catch(() => {
			if (scopeRef.current === scope && modelRef.current.revision === revision) {
				modelRef.current = { ...modelRef.current, bookmarked: modelRef.current.committed };
				if (focused.current) setState(modelRef.current);
			}
			return false;
		});
		saveQueue.current = operation;
		return operation;
	}, [scope, isGuest, canAccessEquipment]);

	// Scope filtering applies during render, before old focus effects clean up.
	const current = state.scope === scope ? state : modelRef.current;
	const bookmarkedItems = useMemo(() => catalog.filter(item => current.bookmarked[item.id]
		&& (!isGuest || canAccessEquipment(item.id))), [catalog, current.bookmarked, isGuest, canAccessEquipment]);
	const learning = useMemo(() => Object.fromEntries(bookmarkedItems.map(item =>
		[item.id, equipmentLearningFlags(current.progress[item.id], item, locale)])), [bookmarkedItems, current.progress, locale]);
	const pendingCustomItems = bookmarkedItems.length === 0 && catalogLoading
		&& Object.keys(current.bookmarked).some(id => current.bookmarked[id] && (!isGuest || canAccessEquipment(id)));
	return { bookmarkedItems, bookmarked: current.bookmarked, learning, loading: !current.ready || pendingCustomItems, toggleBookmark };
}
