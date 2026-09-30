import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const HISTORY_ANCHOR = { minIndexForVisible: 0 };
const LATEST_OFFSET_TOLERANCE = 2;

// The chat list is inverted: offset zero is the latest message, regardless of
// how many older, variable-height replies have not been measured yet.
export function useChatScroll({ isActive, historyKey, messageIds = [] }) {
	const listRef = useRef(null);
	const activeRef = useRef(isActive);
	activeRef.current = isActive;
	const identityRef = useRef(historyKey);
	identityRef.current = historyKey;
	const messageIdsRef = useRef(messageIds);
	messageIdsRef.current = messageIds;
	const isWeb = Platform.OS === "web";
	const metrics = useRef({ offset: 0, contentHeight: null, contentWidth: null, viewportHeight: null, viewportWidth: null });
	const pendingInsert = useRef(null);
	const pendingReplyFocus = useRef(null);
	const replyFocusFrame = useRef(null);
	const readingHistoryRef = useRef(false);
	const [readingHistory, setReadingHistory] = useState(false);
	const cancelPendingInsert = useCallback(() => {
		pendingInsert.current = null;
		pendingReplyFocus.current = null;
		if (replyFocusFrame.current != null) cancelAnimationFrame(replyFocusFrame.current);
		replyFocusFrame.current = null;
	}, []);
	const scrollToLatest = useCallback(() => {
		cancelPendingInsert();
		if (!activeRef.current) return;
		readingHistoryRef.current = false;
		metrics.current.offset = 0;
		setReadingHistory(false);
		listRef.current?.scrollToOffset({ offset: 0, animated: false });
	}, [cancelPendingInsert]);
	useEffect(() => {
		cancelPendingInsert();
		if (isActive) scrollToLatest();
		return cancelPendingInsert;
	}, [isActive, historyKey, scrollToLatest, cancelPendingInsert]);
	const onScrollBeginDrag = useCallback(() => {
		cancelPendingInsert();
		if (activeRef.current) {
			readingHistoryRef.current = true;
			setReadingHistory(true);
		}
	}, [cancelPendingInsert]);
	const onScroll = useCallback((event) => {
		if (!activeRef.current) return;
		const offset = event?.nativeEvent?.contentOffset?.y;
		if (typeof offset !== "number" || !Number.isFinite(offset)) return;
		metrics.current.offset = Math.max(0, offset);
		readingHistoryRef.current = offset > LATEST_OFFSET_TOLERANCE;
		setReadingHistory(offset > LATEST_OFFSET_TOLERANCE);
	}, []);
	const beforeLatestInsert = useCallback(() => {
		if (!isWeb || !activeRef.current || pendingInsert.current) return;
		const snapshot = metrics.current;
		if (snapshot.contentHeight == null || snapshot.viewportHeight == null) return;
		// Called before an explicit append to the chronological message array.
		// In the inverted visual array this inserts at index zero. Coalesce a
		// React batch using the earliest snapshot, not each intermediate offset.
		pendingInsert.current = { ...snapshot, historyKey: identityRef.current,
			readingHistory: readingHistoryRef.current && snapshot.offset > LATEST_OFFSET_TOLERANCE };
	}, [isWeb]);
	const beforeContentToggle = useCallback((messageId, expanded) => {
		cancelPendingInsert();
		if (!activeRef.current || messageId == null) return;
		pendingReplyFocus.current = { messageId, expanded, historyKey: identityRef.current };
	}, [cancelPendingInsert]);
	const onReplyLayout = useCallback((messageId, expanded) => {
		const pending = pendingReplyFocus.current;
		if (!pending || pending.messageId !== messageId || pending.expanded !== expanded || replyFocusFrame.current != null) return;
		// AssistantMessageCell notifies after the virtualized Cell metrics update.
		// Defer ONE frame for the layout batch, never a timer/retry loop.
		replyFocusFrame.current = requestAnimationFrame(() => {
			replyFocusFrame.current = null;
			if (pendingReplyFocus.current !== pending) return;
			pendingReplyFocus.current = null;
			pendingInsert.current = null;
			if (!activeRef.current || pending.historyKey !== identityRef.current) return;
			const index = messageIdsRef.current.indexOf(messageId);
			if (index < 0) return;
			// In an inverted list viewPosition=1 aligns the physical TOP of this
			// reply, making the newly expanded text visible instead of leaving it
			// above the viewport. Never jump to the latest message or animate.
			listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: false });
		});
	}, []);
	const onLayout = useCallback((event) => {
		const { width, height } = event?.nativeEvent?.layout || {};
		if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return;
		if (metrics.current.viewportWidth !== width || metrics.current.viewportHeight !== height) cancelPendingInsert();
		metrics.current.viewportWidth = width;
		metrics.current.viewportHeight = height;
	}, [cancelPendingInsert]);
	const onContentSizeChange = useCallback((width, height) => {
		if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return;
		const snapshot = pendingInsert.current;
		pendingInsert.current = null;
		metrics.current.contentWidth = width;
		metrics.current.contentHeight = height;
		if (!activeRef.current || !snapshot || snapshot.historyKey !== identityRef.current ||
			snapshot.contentWidth !== width || snapshot.viewportWidth !== metrics.current.viewportWidth ||
			snapshot.viewportHeight !== metrics.current.viewportHeight) return;
		const offset = snapshot.readingHistory
			? Math.max(0, Math.min(snapshot.offset + height - snapshot.contentHeight, Math.max(0, height - snapshot.viewportHeight)))
			: 0;
		readingHistoryRef.current = offset > LATEST_OFFSET_TOLERANCE;
		setReadingHistory(readingHistoryRef.current);
		// The browser may already have anchored scrollTop. Compare against the
		// absolute target; adding the delta to the new offset would apply it twice.
		if (Math.abs(metrics.current.offset - offset) <= LATEST_OFFSET_TOLERANCE) return;
		metrics.current.offset = offset;
		listRef.current?.scrollToOffset({ offset, animated: false });
	}, []);
	return {
		listRef, scrollToLatest, onScroll, onScrollBeginDrag, beforeLatestInsert,
		beforeContentToggle, onReplyLayout,
		// The pressed row should already be measured. If it was removed or
		// unmeasured in the meantime, fail quietly without a retry scroll loop.
		onScrollToIndexFailed: cancelPendingInsert,
		onContentSizeChange: isWeb ? onContentSizeChange : undefined,
		onLayout,
		// RN-web wheel/touch movement does not synthesize onScrollBeginDrag.
		onWheel: isWeb ? cancelPendingInsert : undefined,
		onTouchMove: isWeb ? cancelPendingInsert : undefined,
		// Preserve the reader's visible row when a reply arrives while they are
		// reading history. Do not enable native automatic animated scrolling.
		maintainVisibleContentPosition: readingHistory ? HISTORY_ANCHOR : undefined,
	};
}
