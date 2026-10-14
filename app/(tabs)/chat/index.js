import { beginAssistantJob, pendingAssistantJobs, recheckAssistantJobs, subscribeAssistantJobs } from "../../../utils/assistantJobs";
import { subscribeAccountData } from '../../../utils/accountSyncEvents';
import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { RFValue } from "react-native-responsive-fontsize";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getCachedEquipmentCatalog, loadCachedEquipmentCatalog, getEquipmentCatalog, subscribeEquipmentCatalog, sendAssistantMessage, getAssistantRuntime } from "../../../utils/api";
import { checkedAssistantRuntime, assistantRuntimeRequest, assistantRequestHistory, isBailianRawMessage, plainBailianMessage } from "../../../utils/assistantRuntime";
import { mergeEquipmentCatalog } from "../../../utils/equipmentCatalog";
import EquipmentImage from "../../../components/EquipmentImage";
import { assistantMessagesForDisplay, localEquipmentAnswer, localEquipmentAnswerForItem, localEquipmentRecommendations, resolveEquipmentRecommendations } from "../../../utils/assistantEquipmentSearch";
import { symptomConcern, symptomGuideAnswer } from "../../../utils/assistantSymptomEvidence";
import { assistantReplyPresentation } from "../../../utils/assistantReplyPresentation";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardInset } from "../../../hooks/useKeyboardInset";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { useChatScroll } from "../../../hooks/useChatScroll";
import { openExternalMap } from "../../../utils/openExternalMap";
import AssistantReplyDetails from "../../../components/AssistantReplyDetails";
import { useAssistantReplySpeech } from "../../../hooks/useAssistantReplySpeech";
import AssistantReplySpeechControls, { AssistantReplyReadButton } from "../../../components/AssistantReplySpeechControls";
import AssistantConversationHistory from "../../../components/AssistantConversationHistory";
import AssistantMessageInput from "../../../components/AssistantMessageInput";
import AssistantKeyboardSpacer from "../../../components/AssistantKeyboardSpacer";
import AssistantJobStatus from "../../../components/AssistantJobStatus";
import { retryAccountSync } from "../../../utils/accountSyncStatus";
import { getOwnerKey } from "../../../utils/userStorage";
import { retrieveAssistantFaq, assistantFaqEmergency } from "../../../server/src/assistantFaqKnowledge";
import { assistantAppMessage } from "../../../server/src/assistantContentPolicy";
import { createAssistantSessionId, listAccountAssistantConversations, loadAssistantConversations, storeAssistantConversation, startNewAssistantConversation, deleteAssistantConversation, clearAccountAssistantConversationHistory } from "../../../utils/assistantConversations";

function initialMessage(i18n) { return { id: "welcome", sender: "ai", text: i18n.t("aiChatWelcome") }; }

function RecommendationImage({ equipment }) {
	return <EquipmentImage source={equipment.icon} imageKey={String(equipment.id)} style={styles.equipmentImage} />;
}

function restoreAssistantMessage(item) {
	const retiredImage = item.retiredImage === true || item.imageUri || item.imageData
		|| /^u-img-|^a-img-|^a-confirm-/.test(item.id) || ["equipment_image", "image_confirmation"].includes(item.action);
	if (!retiredImage) return item;
	// Retiring photo input does not erase the user's earlier questions or replies.
	// Retain only their text as read-only history; discard attachment references,
	// recognition actions and cards, and never reuse this old flow as AI context.
	return { id: item.id, sender: item.sender,
		...(typeof item.text === "string" ? { text: item.text } : {}),
		...(typeof item.reply === "string" ? { reply: item.reply } : {}),
		retiredImage: true, action: "retired_image", recommendations: [] };
}

function checkedAssistantResponse(result, runtime = null) {
	if (!result || typeof result !== "object" || Array.isArray(result) ||
		![result.text, result.reply].some(value => typeof value === "string" && value.trim())) {
		const error = new Error("deepSeekInvalidResponse");
		error.code = "deepSeekInvalidResponse";
		error.status = 502;
		throw error;
	}
	if (runtime && ((result.provider && result.provider !== runtime.provider) ||
		(runtime.provider === "bailian" && !isBailianRawMessage(result)))) {
		throw Object.assign(new Error("assistantInvalidResponse"), { code: "assistantInvalidResponse", status: 502 });
	}
	// A legacy API can send blank `text` alongside a useful `reply`. Don't let
	// whitespace or a non-string field hide the real answer during rendering.
	return { ...result, text: typeof result.text === "string" && result.text.trim() ? result.text : undefined,
		reply: typeof result.reply === "string" && result.reply.trim() ? result.reply : undefined };
}

export default function AiChatbox() {
	useAndroidBackTarget("/(tabs)");
	const headerHeight = useHeaderHeight(); const insets = useSafeAreaInsets(); const keyboard = useKeyboardInset({ nativeAndroid: true });
	const [keyboardHistoryInset, setKeyboardHistoryInset] = useState(0);
	const { user, isGuest, isUser, isLoading } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext);
	const requestGeneration = useRef(0); const sending = useRef(false);
	const activeSubmission = useRef(null);
	const mounted = useRef(true); const startingConversation = useRef(false);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const messageSequence = useRef(0);
	const nextMessageId = prefix => `${prefix}-${Date.now()}-${++messageSequence.current}`;
	const isFocused = useIsFocused(); const focusedRef = useRef(isFocused); focusedRef.current = isFocused;
	const historyReady = useRef(false);
	const historyIdentity = user?.id || user?.phone || user?.email || (isGuest ? "guest-local" : "anonymous");
	const [runtime, setRuntime] = useState(null);
	const [runtimeError, setRuntimeError] = useState(null);
	const [runtimeNotice, setRuntimeNotice] = useState(false);
	const runtimeRef = useRef(null);
	const runtimeSequence = useRef(0);
	const runtimeSession = `${historyIdentity}:${user?.token || ""}`;
	const runtimeSessionRef = useRef(runtimeSession); runtimeSessionRef.current = runtimeSession;
	const retainedDraft = useRef(null);
	const draftRef = useRef("");
	const refreshRuntime = useCallback(async () => {
		const sequence = ++runtimeSequence.current;
		let next;
		try { next = checkedAssistantRuntime(await getAssistantRuntime(user.token)); }
		catch (error) {
			if (!mounted.current || runtimeSessionRef.current !== runtimeSession || sequence !== runtimeSequence.current) return null;
			throw error;
		}
		if (!mounted.current || runtimeSessionRef.current !== runtimeSession || sequence !== runtimeSequence.current) return null;
		const previous = runtimeRef.current;
		if (previous && previous.provider !== next.provider) {
			retainedDraft.current = { session: runtimeSession, provider: next.provider, text: draftRef.current };
			requestGeneration.current += 1;
			setRuntimeNotice(true);
		}
		runtimeRef.current = next;
		setRuntime(next); setRuntimeError(null);
		return next;
	}, [runtimeSession, user?.token]);
	useEffect(() => {
		runtimeSequence.current += 1; runtimeRef.current = null;
		setRuntime(null); setRuntimeError(null); setRuntimeNotice(false); retainedDraft.current = null;
	}, [runtimeSession]);
	useEffect(() => {
		if (!isFocused || isLoading || !isUser || !user?.token) return;
		let active = true;
		const refresh = () => { void refreshRuntime().catch(error => {
			if (active && runtimeSessionRef.current === runtimeSession) setRuntimeError(error?.code || "assistantRuntimeUnavailable");
		}); };
		refresh();
		const listener = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
		return () => { active = false; listener.remove(); };
	}, [isFocused, isLoading, isUser, runtimeSession, refreshRuntime]);
	const provider = runtime?.provider || "deepseek";
	// AuthProvider persists a fresh non-secret ID for every new login. A legacy
	// context without that field gets a memory-only scope, never a token key.
	const authSessionId = useMemo(() => user?.assistantSessionId || createAssistantSessionId(), [historyIdentity, user?.assistantSessionId, user?.loginAt]);
	const conversationScope = useMemo(() => ({ owner: String(historyIdentity), locale, authSessionId, provider }), [historyIdentity, locale, authSessionId, provider]);
	const scopeKey = JSON.stringify(conversationScope);
	const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
	const [conversationId, setConversationId] = useState(null);
	const currentConversation = useRef(conversationId); currentConversation.current = conversationId;
	// A full archive can initially leave a usable in-memory chat. After deleting
	// history, attach its storage ID without resetting that chat/draft/request.
	const persistedConversation = useRef(null);
	const [loadedScope, setLoadedScope] = useState(null);
	const [conversationHistory, setConversationHistory] = useState([]);
	const [accountHistory, setAccountHistory] = useState([]);
	const [historyVisible, setHistoryVisible] = useState(false);
	const [historyStarting, setHistoryStarting] = useState(false);
	const [historyError, setHistoryError] = useState(null);
	const [historyReadError, setHistoryReadError] = useState(null);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyDeleting, setHistoryDeleting] = useState(false);
	const [historyDeleteError, setHistoryDeleteError] = useState(null);
	const [historySaveRevision, setHistorySaveRevision] = useState(0);
	const historyMutation = useRef(null);
	const historyRevision = useRef(0);
	const historyKey = `${scopeKey}:${conversationId || "loading"}`;
	const conversationLoaded = Boolean(runtime) && loadedScope === scopeKey;
	useEffect(() => {
		requestGeneration.current += 1; activeSubmission.current = null; sending.current = false; setBusy(false); setPendingTask(null);
		const retained = retainedDraft.current;
		setText(retained?.session === runtimeSession && retained.provider === provider ? retained.text : "");
		// Loading the new provider archive changes historyKey once more. Keep the
		// draft until its conversation is ready, then ordinary New chat clears it.
		if (conversationLoaded) retainedDraft.current = null;
		return () => { requestGeneration.current += 1; };
	}, [historyKey, user?.token]);
	const [messages, setMessages] = useState([initialMessage(i18n)]); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
	draftRef.current = text;
	const [pendingTask, setPendingTask] = useState(null);
	const visibleMessages = useRef(messages); visibleMessages.current = messages;
	const submittedSpeech = useRef(new Map());
	const speechEnabled = isFocused && !isLoading && isUser && !!user?.token && !historyVisible && conversationLoaded;
	const speechScope = `${historyKey}:${user?.token || ""}`;
	const changeDraft = value => setText(value);
	// Replies can be read aloud, but this screen never starts recording. Legacy
	// voiceRequest route parameters are intentionally ignored after input retirement.
	const replySpeech = useAssistantReplySpeech({ locale, enabled: speechEnabled });
	const speechRef = useRef(replySpeech); speechRef.current = replySpeech;
	const pendingReplySpeech = useRef(null);
	const stopReplySpeech = useCallback(() => {
		pendingReplySpeech.current = null;
		void speechRef.current.stop();
	}, []);
	useEffect(() => {
		stopReplySpeech();
		return stopReplySpeech;
	}, [speechScope, isFocused, stopReplySpeech]);
	const [selectedReply, setSelectedReply] = useState(null);
	useEffect(() => { setSelectedReply(null); }, [historyKey, user?.token, isFocused]);
	const [catalog, setCatalog] = useState(() => {
		const cached = getCachedEquipmentCatalog();
		return mergeEquipmentCatalog(i18n.t("equipmentList", { returnObjects: true }) || [], cached?.items || [], locale, { imageCatalogReady: Boolean(cached) });
	});
	const displayMessages = useMemo(() => {
		if (provider === "bailian") return messages.map(plainBailianMessage);
		const activeMessages = assistantMessagesForDisplay(messages.filter(item => !item.retiredImage), catalog, locale);
		const currentById = new Map(activeMessages.map(item => [item.id, item]));
		return messages.map(item => item.retiredImage ? assistantAppMessage(item) : currentById.get(item.id) || item);
	}, [messages, catalog, locale, provider]);
	const messagePresentations = useMemo(() => {
		let replyIndex = 0;
		return new Map(displayMessages.map((item) => {
			const equipmentCards = item.confirmationAnswered === "no" ? [] : resolveEquipmentRecommendations(item.recommendations, catalog, locale);
			const presentation = provider === "bailian" || item.retiredImage
				? { fullText: item.text || item.reply || "", previewText: item.text || item.reply || "", canExpand: false }
				: assistantReplyPresentation(item, equipmentCards, locale, replyIndex);
			if (presentation.introVariant != null) replyIndex += 1;
			return [item.id, { equipmentCards, presentation }];
		}));
	}, [displayMessages, catalog, locale, provider]);
	useEffect(() => {
		const pending = pendingReplySpeech.current;
		if (!pending) return;
		const visibleText = messagePresentations.get(pending.id)?.presentation.previewText;
		if (typeof visibleText !== "string") return;
		// Only replies delivered during this visit are eligible. Restored history,
		// returning from a guide, and catalog/presentation updates never enqueue speech.
		pendingReplySpeech.current = null;
		if (pending.scope !== speechScope || !speechEnabled || !focusedRef.current || !replySpeech.autoRead || !visibleText.trim()) return;
		void speechRef.current.read(pending.id, visibleText);
	}, [messagePresentations, speechScope, speechEnabled, replySpeech.autoRead]);
	const readReply = (messageId, visibleText) => {
		if (!speechEnabled || typeof visibleText !== "string" || !visibleText.trim()) return;
		pendingReplySpeech.current = null;
		void speechRef.current.read(messageId, visibleText);
	};
	// Reverse only the visual list. Persistence and AI context stay chronological.
	const listMessages = useMemo(() => [...displayMessages].reverse(), [displayMessages]);
	const messageIds = useMemo(() => listMessages.map(item => item.id), [listMessages]);
	const chatScroll = useChatScroll({ isActive: isFocused && !isLoading && isUser && !!user?.token, historyKey, messageIds });
	// The detail reader is outside the inverted list. Opening it never changes
	// a message height, scroll anchor, stored reply or model conversation context.
	const selectedPresentation = selectedReply && isFocused && selectedReply.historyKey === historyKey && selectedReply.token === user?.token
		? messagePresentations.get(selectedReply.messageId)?.presentation : null;
	const replyDetail = selectedPresentation ? { messageId: selectedReply.messageId, text: selectedPresentation.fullText } : null;
	const appendMessage = (message) => {
		chatScroll.beforeLatestInsert();
		if (message.sender === "ai" && !["error", "auth_error"].includes(message.action) && speechEnabled && focusedRef.current) {
			pendingReplySpeech.current = { id: message.id, scope: speechScope };
		}
		setMessages((current) => [...current, message]);
	};
	useEffect(() => {
		let active = true;
		historyReady.current = false;
		setLoadedScope(null); setConversationId(null); setConversationHistory([]); setHistoryVisible(false); setHistoryError(null); setHistoryStarting(false);
		persistedConversation.current = null;
		setHistoryReadError(null); setHistoryLoading(false); startingConversation.current = false;
		historyMutation.current = null; historyRevision.current += 1; setHistoryDeleting(false); setHistoryDeleteError(null);
		setMessages([initialMessage(i18n)]);
		if (!runtime || isLoading || !isUser || !user?.token) return () => { active = false; };
		const base = i18n.t("equipmentList", { returnObjects: true }) || [];
		const cached = getCachedEquipmentCatalog();
		setCatalog(mergeEquipmentCatalog(base, cached?.items || [], locale, { imageCatalogReady: Boolean(cached) }));
		let receivedFreshCatalog = false;
		const unsubscribe = subscribeEquipmentCatalog?.(result => {
			if (active && Array.isArray(result?.items)) { receivedFreshCatalog = true; setCatalog(mergeEquipmentCatalog(base, result.items, locale)); }
		});
		void loadCachedEquipmentCatalog().then(result => {
			if (active && !receivedFreshCatalog && Array.isArray(result?.items)) setCatalog(mergeEquipmentCatalog(base, result.items, locale));
		}).catch(() => {});
		getEquipmentCatalog().then((result) => {
			if (active && Array.isArray(result?.items)) { receivedFreshCatalog = true; setCatalog(mergeEquipmentCatalog(base, result.items, locale)); }
		}).catch(() => {});
		loadAssistantConversations(conversationScope).then((stored) => {
			if (!active) return;
			historyReady.current = true;
			persistedConversation.current = stored.conversationId;
			setConversationId(stored.conversationId);
			setMessages([initialMessage(i18n), ...stored.messages.map(restoreAssistantMessage)]);
			setConversationHistory(stored.history); setLoadedScope(scopeKey);
		}).catch(error => {
			if (!active) return;
			// Never replace unreadable storage with an empty archive. A temporary
			// in-memory chat remains usable, with an explicit save warning.
			setConversationId(createAssistantSessionId()); setLoadedScope(scopeKey);
			setHistoryError(error?.code || "assistantHistoryUnavailable");
		});
		return () => { active = false; unsubscribe?.(); };
	}, [scopeKey, i18n, isLoading, isUser, locale, Boolean(runtime)]);
	useEffect(() => {
		if (!historyReady.current || !conversationLoaded || !conversationId || historyDeleting) return;
		const revision = historyRevision.current;
		const serializable = messages.filter(item => item.id !== "welcome");
		storeAssistantConversation({ ...conversationScope, conversationId: persistedConversation.current || conversationId, messages: serializable }).then(stored => {
			if (mounted.current && currentScope.current === scopeKey && currentConversation.current === conversationId && historyRevision.current === revision) {
				setConversationHistory(stored.history); setHistoryError(null);
			}
		}).catch(error => {
			if (!mounted.current || currentScope.current !== scopeKey || currentConversation.current !== conversationId || historyRevision.current !== revision) return;
			historyReady.current = false; setHistoryError(error?.code || "assistantHistoryUnavailable");
		});
	}, [scopeKey, conversationId, conversationLoaded, messages, historyDeleting, historySaveRevision]);
	useEffect(() => {
        if (!conversationLoaded || !conversationId || !user?.token) return;
        let active = true, refreshSequence = 0;
        const refresh = async () => {
            const sequence = ++refreshSequence;
            const tasks = await pendingAssistantJobs(conversationScope.owner);
            if (!active || sequence !== refreshSequence || currentScope.current !== scopeKey || currentConversation.current !== conversationId) return;
            const task = tasks.find(item => item.conversationId === (persistedConversation.current || conversationId) && item.scope.locale === locale && (item.scope.provider || "deepseek") === provider);
            const submission = activeSubmission.current;
            const submitting = submission?.scope === scopeKey && submission.conversationId === conversationId;
            setPendingTask(task || (submitting ? { stage: 'submitting', createdAt: submission.createdAt } : null));
            // A remote-history notification can arrive before the durable POST
            // starts (for example while location permission is pending).
            // Its empty outbox must not release this request's send lock.
            sending.current = Boolean(task || submitting); setBusy(Boolean(task || submitting));
            const stored = await loadAssistantConversations(conversationScope);
            if (!active || sequence !== refreshSequence || currentScope.current !== scopeKey || currentConversation.current !== conversationId) return;
            if (stored.conversationId !== conversationId) {
                if (!historyReady.current || !persistedConversation.current) return;
                // Another device deleted this history. Use the fresh local
                // composer without recreating the deleted conversation.
                persistedConversation.current = stored.conversationId;
                setConversationId(stored.conversationId); setMessages([initialMessage(i18n), ...stored.messages.map(restoreAssistantMessage)]);
                setConversationHistory(stored.history); sending.current = false; setBusy(false);
                return;
            }
            if (!historyMutation.current && !startingConversation.current) {
                const newest = stored.messages.at(-1);
                if (newest?.sender === 'ai' && !visibleMessages.current.some(x => x.id === newest.id)) {
                    chatScroll.beforeLatestInsert();
                    if (newest.action === 'error') {
                        const question = [...stored.messages].reverse().find(x => x.sender === 'user')?.text;
                        if (question) {
                            draftRef.current = draftRef.current.trim() ? draftRef.current : question;
                            setText(current => current.trim() ? current : question);
                        }
                        if (newest.errorCode === 'assistantProviderChanged') void refreshRuntime().catch(error => setRuntimeError(error?.code || 'assistantRuntimeUnavailable'));
                    } else if (focusedRef.current && speechEnabled && submittedSpeech.current.get([...stored.messages].reverse().find(x => x.sender === 'user')?.id) === user?.token) pendingReplySpeech.current = { id: newest.id, scope: speechScope };
                }
                setMessages([initialMessage(i18n), ...stored.messages.map(restoreAssistantMessage)]);
                setConversationHistory(stored.history);
            }
        };
        const unsubscribe = subscribeAssistantJobs(owner => { if (owner === conversationScope.owner) void refresh().catch(() => {}); });
        const unsubscribeCloud = subscribeAccountData(event => { if (event.remote && event.kind === 'assistant' && event.owner === conversationScope.owner) void refresh().catch(() => {}); });
        void refresh().catch(() => {});
        return () => { active = false; unsubscribe(); unsubscribeCloud(); };
    }, [scopeKey, conversationId, conversationLoaded, user?.token]);
	const persistedId = persistedConversation.current || conversationId;
	useEffect(() => {
		if (!historyVisible || !conversationLoaded) return;
		let active = true;
		const revision = historyRevision.current;
		listAccountAssistantConversations({ owner: conversationScope.owner, provider, exclude: { locale, provider, conversationId: persistedId } }).then(result => {
			if (active && currentScope.current === scopeKey && historyRevision.current === revision) setAccountHistory(result.history);
		}).catch(error => { if (active && currentScope.current === scopeKey) setHistoryReadError(error?.code || 'assistantHistoryUnavailable'); });
		return () => { active = false; };
	}, [historyVisible, conversationLoaded, conversationHistory, scopeKey, persistedId]);
	const historyForReading = useMemo(() => accountHistory.filter(item => !(item.sourceId === persistedId && item.locale === locale)).map(conversation => {
		const rawProvider = conversation.provider === "bailian";
		const restored = conversation.messages.map(restoreAssistantMessage).map(item => rawProvider || isBailianRawMessage(item) ? plainBailianMessage(item) : assistantAppMessage(item));
		const historyLocale = conversation.locale || locale;
		// Legacy records lack evidence metadata. Keep their original text for
		// review; do not generate a fresh recommendation from a historical query.
		if (conversation.legacy) return { ...conversation, messages: restored.map(item => ({ id: item.id, sender: item.sender, text: item.text || item.reply || "" })) };
		const checked = rawProvider ? restored : assistantMessagesForDisplay(restored.filter(item => !item.retiredImage), catalog, historyLocale);
		const byId = new Map(checked.map(item => [item.id, item]));
		return { ...conversation, messages: restored.map(original => {
			const item = byId.get(original.id) || original;
			const cards = resolveEquipmentRecommendations(item.recommendations, catalog, historyLocale);
			return { id: item.id, sender: item.sender, model: item.model, text: rawProvider || original.retiredImage ? original.text || original.reply : assistantReplyPresentation(item, cards, historyLocale).fullText };
		}) };
	}), [accountHistory, persistedId, catalog, locale]);
	const startNewChat = async () => {
		if (!conversationLoaded || startingConversation.current || historyMutation.current || !historyReady.current || !isUser || !user?.token) return;
		const capturedScope = scopeKey;
		startingConversation.current = true;
		requestGeneration.current += 1; activeSubmission.current = null; sending.current = false; setBusy(false); setPendingTask(null); stopReplySpeech(); setSelectedReply(null); setHistoryStarting(true);
		try {
			// Flush the current visible conversation before archiving, including
			// a question whose network request was just cancelled by New chat.
			await storeAssistantConversation({ ...conversationScope, conversationId: persistedConversation.current || conversationId, messages: messages.filter(item => item.id !== "welcome") });
			if (!mounted.current || currentScope.current !== capturedScope) return;
			const stored = await startNewAssistantConversation(conversationScope);
			if (!mounted.current || currentScope.current !== capturedScope) return;
			historyReady.current = true; persistedConversation.current = stored.conversationId; setHistoryError(null); setText(""); setConversationId(stored.conversationId);
			setMessages([initialMessage(i18n)]); setConversationHistory(stored.history); setHistoryVisible(false);
		} catch (error) {
			if (mounted.current && currentScope.current === capturedScope) setHistoryError(error?.code || "assistantHistoryUnavailable");
		} finally { if (mounted.current && currentScope.current === capturedScope) { startingConversation.current = false; setHistoryStarting(false); } }
	};
	const openHistory = async () => {
		Keyboard.dismiss(); stopReplySpeech(); setSelectedReply(null); setHistoryVisible(true); setHistoryLoading(true); setHistoryReadError(null); setHistoryDeleteError(null);
		retryAccountSync(getOwnerKey(user));
		const capturedScope = scopeKey;
		const revision = historyRevision.current;
		try {
			const result = await listAccountAssistantConversations({ owner: conversationScope.owner, provider, exclude: { locale, provider, conversationId: persistedId } });
			if (mounted.current && currentScope.current === capturedScope && historyRevision.current === revision) setAccountHistory(result.history);
		} catch (error) {
			if (mounted.current && currentScope.current === capturedScope && historyRevision.current === revision) setHistoryReadError(error?.code || "assistantHistoryUnavailable");
		} finally { if (mounted.current && currentScope.current === capturedScope) setHistoryLoading(false); }
	};
	const removeHistory = async (id = null) => {
		if (!mounted.current || currentScope.current !== scopeKey || !conversationLoaded || historyMutation.current || startingConversation.current ||
			historyLoading || historyReadError || isLoading || !isUser || !user?.token || !historyForReading.length) return false;
		const selected = id === null ? null : historyForReading.find(item => item.id === id);
		if (id !== null && (!selected || selected.canDelete === false)) return false;
		const operation = { scope: scopeKey };
		historyMutation.current = operation; historyRevision.current += 1;
		setHistoryDeleting(true); setHistoryDeleteError(null);
		try {
			if (id === null) await clearAccountAssistantConversationHistory(conversationScope);
			else await deleteAssistantConversation({ ...conversationScope, locale: selected.locale, conversationId: selected.sourceId });
			const result = await listAccountAssistantConversations({ owner: conversationScope.owner, provider, exclude: { locale, provider, conversationId: persistedId } });
			if (!mounted.current || currentScope.current !== operation.scope || historyMutation.current !== operation) return false;
			setAccountHistory(result.history);
			if (!persistedConversation.current) {
				try {
					let recovered = await loadAssistantConversations(conversationScope);
					if (!mounted.current || currentScope.current !== operation.scope || historyMutation.current !== operation) return true;
					// A transient initial read error may have hidden an existing,
					// non-empty active chat. Archive it instead of overwriting its
					// messages with this visit's temporary chat or AI context.
					if (recovered.messages.length) recovered = await startNewAssistantConversation(conversationScope);
					if (!mounted.current || currentScope.current !== operation.scope || historyMutation.current !== operation) return true;
					persistedConversation.current = recovered.conversationId;
					setConversationHistory(recovered.history);
				} catch (error) {
					if (mounted.current && currentScope.current === operation.scope && historyMutation.current === operation)
						setHistoryError(error?.code || "assistantHistoryUnavailable");
					return true; // Deletion succeeded; only the current save still needs recovery.
				}
			}
			// Freeing archive space can recover a failed save. The persistence
			// effect retries the latest visible messages when deletion finishes;
			// it never replaces the active messages with an archived snapshot.
			historyReady.current = true;
			setHistorySaveRevision(value => value + 1);
			return true;
		} catch (error) {
			if (mounted.current && currentScope.current === operation.scope && historyMutation.current === operation)
				setHistoryDeleteError(error?.code || "assistantHistoryDeleteFailed");
			return false;
		} finally {
			if (mounted.current && currentScope.current === operation.scope && historyMutation.current === operation) {
				historyMutation.current = null; setHistoryDeleting(false);
			}
		}
	};
	const obtainDeviceLocation = async () => {
		if (Platform.OS === "web") return new Promise((resolve) => {
			if (!globalThis.navigator?.geolocation) return resolve({});
			globalThis.navigator.geolocation.getCurrentPosition(
				(position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
				() => resolve({}),
				{ timeout: 6000, maximumAge: 300000 },
			);
		});

		// Build 14 does not contain ExpoLocation. Checking the optional native
		// module before evaluating expo-location keeps that OTA runtime safe; a
		// subsequent native build automatically enables foreground positioning.
		if (!requireOptionalNativeModule("ExpoLocation")) return {};
		try {
			const Location = await import("expo-location");
			let permission = await Location.getForegroundPermissionsAsync();
			if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
			if (!permission.granted) return {};
			const position = await Promise.race([
				Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
				new Promise((resolve) => setTimeout(() => resolve(null), 7000)),
			]);
			const latitude = Number(position?.coords?.latitude); const longitude = Number(position?.coords?.longitude);
			return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {};
		} catch {
			return {};
		}
	};
	const send = async () => {
		const query = text.trim(); if (!query || sending.current || isLoading || !isUser || !user?.token || !runtime || !conversationLoaded || historyStarting || historyVisible) return;
		stopReplySpeech();
		chatScroll.scrollToLatest();
		sending.current = true; const generation = requestGeneration.current;
		const submission = { scope: scopeKey, conversationId, createdAt: Date.now() };
		activeSubmission.current = submission;
		const stillCurrent = () => mounted.current && generation === requestGeneration.current && currentScope.current === scopeKey && currentConversation.current === conversationId && runtimeSessionRef.current === runtimeSession;
		const userMessageId = nextMessageId("job-question");
		setPendingTask({ stage: 'submitting', createdAt: submission.createdAt }); setBusy(true);
		let fallbackRecommendations = [];
		let questionAppended = false;
		try {
			// Check immediately before sending, including before any on-device
			// answer. A changed mode switches archives and keeps the draft; it
			// never silently posts the old provider's context to the new provider.
			const activeRuntime = await refreshRuntime();
			if (!activeRuntime || !stillCurrent() || activeRuntime.provider !== provider) return;
			setRuntimeNotice(false);
			const history = assistantRequestHistory(provider === "bailian" ? messages : displayMessages, provider);
			submittedSpeech.current.set(userMessageId, user.token);
			appendMessage({ id: userMessageId, sender: "user", text: query, provider }); changeDraft("");
			questionAppended = true;
			// Local lookups can also fail on unexpected data. Keep them inside the
			// same recovery path so the send lock is always released.
			// FAQ retrieval stays in the existing authenticated server/job flow.
			// Only urgent notices and direct guide lookups are answered on-device.
			const appMode = activeRuntime.provider === "deepseek";
			const concern = appMode ? symptomConcern(query, history) : null;
			const faq = appMode ? retrieveAssistantFaq(query, { history }) : null;
			const localAnswer = !appMode ? null : concern?.urgent ? symptomGuideAnswer(query, catalog, locale, history)
				: assistantFaqEmergency(query, locale) || (!concern && !faq ? localEquipmentAnswer(query, catalog, locale) : null);
			if (localAnswer) {
				appendMessage({ ...checkedAssistantResponse(localAnswer), id: nextMessageId("a-local"), sender: "ai", provider });
				return;
			}
			fallbackRecommendations = !appMode || faq ? [] : localEquipmentRecommendations(query, catalog, locale, history);
			const position = appMode && !faq && /(附近|最近|周邊|周边|位置|地點|地点|公園|公园|\b(?:nearby|nearest|where|location|park)\b)/i.test(query) ? await obtainDeviceLocation() : {};
			if (!stillCurrent()) return;
			const request = { message: query, history, locale, ...position, ...assistantRuntimeRequest(activeRuntime) };
            // A full/corrupt local archive already displays a save warning.
            // Keep its temporary conversation usable without pretending a task
            // that cannot be persisted will survive closing the application.
            if (!historyReady.current) {
                const result = checkedAssistantResponse(await sendAssistantMessage(request, user.token), activeRuntime);
                if (stillCurrent()) appendMessage({ ...result, id: nextMessageId('a'), sender: 'ai' });
                return;
            }
            await beginAssistantJob({ scope: conversationScope, conversationId: persistedConversation.current || conversationId,
                userMessageId, token: user.token, request });

		} catch (error) {
			if (!stillCurrent()) return;
			if (!questionAppended) { setRuntimeError(error?.code || "assistantRuntimeUnavailable"); return; }
			if (error?.code === "assistantProviderChanged") {
				draftRef.current = draftRef.current.trim() ? draftRef.current : query; setText(current => current.trim() ? current : query);
				setRuntimeNotice(true);
				await refreshRuntime().catch(failure => setRuntimeError(failure?.code || "assistantRuntimeUnavailable"));
				return;
			}
			const networkFailure = error?.code === "networkError" || (!error?.code && !error?.status);
			if (networkFailure && fallbackRecommendations.length) {
				appendMessage({
					id: nextMessageId("a"), sender: "ai", provider, action: "equipment", source: "app_recommendation", knowledgeSource: "facility_guide",
					reply: appText(locale, "inline.assistant.iSelectedTheseReferenceItemsFromTheIn", {"zh":"我先根據APP內的設施分類，為您篩選以下參考器材。請先閱讀設施教學，並按自身情況慢慢進行。","en":"I selected these reference items from the in-app Facility Guide categories. Please read the guide and start gently."}),
					recommendations: fallbackRecommendations,
				});
			} else {
				const failure = assistantFailure(error);
				appendMessage({ id: nextMessageId("a"), sender: "ai", reply: failure.reply, action: failure.action, recommendations: [] });
				// The question also remains in the conversation. Restore it for
				// retry only when this would not overwrite a newer typed draft.
				setText(current => current.trim() ? current : query);
			}
		}
		finally {
            if (activeSubmission.current === submission) activeSubmission.current = null;
            if (stillCurrent()) {
            const tasks = await pendingAssistantJobs(conversationScope.owner).catch(() => []);
            if (stillCurrent()) {
                const task = tasks.find(item => item.conversationId === (persistedConversation.current || conversationId) && item.scope.locale === locale && (item.scope.provider || "deepseek") === provider);
                setPendingTask(task || null); sending.current = Boolean(task); setBusy(Boolean(task));
            }
        } }
	};
	const openEquipment = (item) => router.push({ pathname: "/outdoor/detail", params: { id: String(item.id), name: item.name, from: "ai" } });
	const openMap = async (facility) => {
		if (!facility) return router.push("/location");
		const name = locale === "zh" ? facility.nameZh || facility.nameEn : facility.nameEn || facility.nameZh;
		try { await openExternalMap({ ...facility, label: name }); } catch { router.push("/location"); }
	};
	const assistantFailure = (error) => {
		if (error?.code === "assistantClientUpdateRequired") return { reply: locale === "en" ? "Please update the app before using this AI service." : "請先更新 App，再使用此 AI 服務。", action: "error" };
		if (error?.code === "assistantInvalidResponse") return { reply: locale === "en" ? "No complete reply was received. Please try again." : "未收到完整回覆，請重新發送。", action: "error" };
		if (error?.code === "assistantTimeout") return { reply: appText(locale, "inline.assistant.theReplyTimedOutYourQuestionIsStill", {"zh":"回覆等候逾時，您的問題仍保留在對話中，請稍後重新發送。","en":"The reply timed out. Your question is still in this conversation. Please try sending it again."}), action: "error" };
		if (error?.code === "deepSeekInvalidResponse") return { reply: appText(locale, "inline.assistant.noCompleteReplyWasReceivedYourQuestionIs", {"zh":"未收到完整回覆，您的問題仍保留在對話中，請重新發送。","en":"No complete reply was received. Your question is still in this conversation. Please try sending it again."}), action: "error" };
		if (error?.status === 401 || error?.code === "unauthorized") return { reply: i18n.t("assistantSessionExpired"), action: "auth_error" };
		if (error?.code === "deepSeekNotConfigured") return { reply: appText(locale, "inline.assistant.serviceNotReady", { zh: "AI 助手暫未能使用，請聯絡項目人員。", en: "The AI assistant is not ready yet. Please contact programme staff." }), action: "error" };
		if (error?.status === 429 || error?.code === "assistantRateLimited") return { reply: i18n.t("assistantRateLimited"), action: "error" };
		return { reply: appText(locale, "inline.assistant.serviceTemporarilyUnavailable", { zh: "AI 助手暫時未能回答，您的問題已保留，請檢查網絡或稍後再試。", en: "The AI assistant could not answer right now. Your question is saved; please check your connection or try again later." }), action: "error" };
	};
	const renderMessage = ({ item }) => {
		const { equipmentCards, presentation } = messagePresentations.get(item.id);
		const openReply = () => {
			Keyboard.dismiss();
			setSelectedReply({ messageId: item.id, historyKey, token: user?.token });
		};
		const expandLabel = appText(locale, "inline.assistant.viewDetails", {"zh":"查看詳細說明","en":"View details"});
		const canOpenEquipment = !item.confirmationRequired || item.confirmationAnswered === "yes";
		const hasMeasuredDistance = item.facility?.distanceKm != null && String(item.facility.distanceKm).trim() !== "" && Number.isFinite(Number(item.facility.distanceKm));
		return (
			<View testID={`assistant-message-row-${item.id}`} style={[styles.row, item.sender === "user" && styles.userRow]}>
				{item.sender === "ai" && <View style={styles.botIcon}><MaterialCommunityIcons name="robot-happy-outline" size={23} color="#840B1C" /></View>}
				<View style={[styles.bubble, item.sender === "user" ? styles.userBubble : styles.aiBubble]}>
					<Text testID={`assistant-reply-${item.id}`} style={[styles.message, item.sender === "user" && styles.userText]}>{presentation.previewText}</Text>
					{item.sender === "ai" && item.id !== "welcome" && !item.retiredImage && !["error", "auth_error"].includes(item.action) && <AssistantReplyReadButton locale={locale} messageId={item.id} text={presentation.previewText} speech={replySpeech} disabled={busy} onRead={readReply} />}
					{presentation.canExpand && <TouchableOpacity testID={`assistant-expand-${item.id}`} onPress={openReply} accessibilityRole="button" accessibilityLabel={expandLabel} accessibilityHint={appText(locale, "inline.assistant.opensTheFullExplanationInASeparateReader", {"zh":"開啟獨立頁面閱讀完整說明","en":"Opens the full explanation in a separate reader"})} style={replyStyles.toggle}>
						<Text style={replyStyles.toggleText}>{expandLabel}</Text><Ionicons name="chevron-forward" size={21} color="#840B1C" />
					</TouchableOpacity>}
					{equipmentCards.map((equipment) => {
						// Explanations and precautions belong to the article above.
						const content = <>{equipment.icon ? <RecommendationImage key={equipment.id} equipment={equipment} /> : <View style={styles.equipmentImagePlaceholder}><MaterialCommunityIcons name="weight-lifter" size={25} color="#840B1C" /></View>}<View style={{ flex: 1 }}>
							<Text style={styles.equipmentName}>{equipment.name}</Text>
							{canOpenEquipment && <Text style={styles.linkText}>{i18n.t("openFacilityGuide")} ›</Text>}
						</View></>;
						return canOpenEquipment
							? <TouchableOpacity testID={`assistant-equipment-${item.id}-${equipment.id}`} key={equipment.id} style={styles.equipmentCard} onPress={() => openEquipment(equipment)}>{content}</TouchableOpacity>
							: <View testID={`assistant-equipment-${item.id}-${equipment.id}`} key={equipment.id} style={styles.equipmentCard}>{content}</View>;
					})}
					{item.action === "facility" && <TouchableOpacity style={styles.actionButton} onPress={() => openMap(item.facility)}><Ionicons name={item.facility ? "navigate" : "location"} size={19} color="#fff" /><Text style={styles.actionText}>{item.facility ? i18n.t(hasMeasuredDistance ? "openNearestInMaps" : "openThisInMaps") : i18n.t("openFacilityLocations")}</Text></TouchableOpacity>}
					{item.action === "auth_error" && <TouchableOpacity style={styles.actionButton} onPress={() => router.push({ pathname: "/login", params: { from: "settings" } })}><Ionicons name="log-in-outline" size={19} color="#fff" /><Text style={styles.actionText}>{i18n.t("login")}</Text></TouchableOpacity>}
				</View>
			</View>
		);
	};
	if (isLoading) return <View style={styles.restricted}><ActivityIndicator size="large" color="#840B1C" /></View>;
	if (!isUser || !user?.token) return <View style={styles.restricted}><Ionicons name="lock-closed" size={54} color="#840B1C" /><Text style={styles.restrictedTitle}>{isGuest ? (appText(locale, "inline.assistant.aiAssistantIsUnavailableInGuestMode", {"zh":"訪客模式暫不可使用 AI 助手","en":"AI Assistant is unavailable in Guest mode"})) : i18n.t("guestBlockedTitle")}</Text><Text style={styles.restrictedText}>{appText(locale, "inline.assistant.signInWithAParticipantOrProfessionalAccount", {"zh":"登入研究參與者或專業人員帳戶後即可使用。","en":"Sign in with a participant or professional account to continue."})}</Text><TouchableOpacity style={styles.restrictedButton} onPress={() => router.push({ pathname: "/login", params: { from: "settings" } })}><Text style={styles.restrictedButtonText}>{i18n.t("login")}</Text></TouchableOpacity></View>;
	const KeyboardContainer = Platform.OS === "android" ? View : KeyboardAvoidingView;
	return <View ref={keyboard.containerRef} onLayout={keyboard.onLayout} style={styles.page} collapsable={false}>
	<KeyboardContainer style={[styles.page, Platform.OS === "web" && { paddingBottom: keyboard.inset }]} {...(Platform.OS === "ios" ? { behavior: "padding", keyboardVerticalOffset: headerHeight } : {})}>
		<AssistantReplyDetails detail={replyDetail} locale={locale} onClose={() => setSelectedReply(null)} />
		<AssistantConversationHistory visible={historyVisible && conversationLoaded} locale={locale} conversations={historyForReading} loading={historyLoading} error={historyReadError}
			deleting={historyDeleting} deleteError={historyDeleteError} onDelete={id => removeHistory(id)} onClearAll={() => removeHistory()} onClose={() => setHistoryVisible(false)} />
		<View style={conversationStyles.toolbar}>
			<TouchableOpacity testID="assistant-new-conversation" accessibilityRole="button" accessibilityLabel={appText(locale, "inline.assistant.newChat", {"zh":"新對話","en":"New chat"})} disabled={!conversationLoaded || historyStarting || historyDeleting || !historyReady.current} style={conversationStyles.button} onPress={startNewChat}>
				<Ionicons name="add-circle-outline" size={22} color="#840B1C" /><Text style={conversationStyles.buttonText}>{appText(locale, "inline.assistant.newChat", {"zh":"新對話","en":"New chat"})}</Text>
			</TouchableOpacity>
			<TouchableOpacity testID="assistant-conversation-history" accessibilityRole="button" accessibilityLabel={appText(locale, "inline.assistant.chatHistory", {"zh":"歷史對話","en":"Chat history"})} disabled={!conversationLoaded || historyStarting} style={conversationStyles.button} onPress={openHistory}>
				<Ionicons name="time-outline" size={22} color="#840B1C" /><Text style={conversationStyles.buttonText}>{appText(locale, "inline.assistant.chatHistory", {"zh":"歷史對話","en":"Chat history"})}</Text>
			</TouchableOpacity>
		</View>
		{runtimeNotice && <Text testID="assistant-provider-changed" accessibilityLiveRegion="polite" style={conversationStyles.error}>{locale === "en" ? "The AI service changed. Its conversations are kept separately. Your draft is ready; press Send to continue here." : "AI 服務已切換，兩邊的對話會分開保留。草稿已保留，按發送即可在這裡繼續。"}</Text>}
		{runtimeError && <TouchableOpacity testID="assistant-runtime-retry" accessibilityRole="button" style={conversationStyles.runtimeError} onPress={() => { void refreshRuntime().catch(error => setRuntimeError(error?.code || "assistantRuntimeUnavailable")); }}><Text style={conversationStyles.error}>{locale === "en" ? "Unable to confirm the current AI service. Tap to reconnect before sending." : "暫時未能確認目前的 AI 服務，請按此重新連接後再發送。"}</Text></TouchableOpacity>}
		{historyError && <Text testID="assistant-history-save-error" accessibilityLiveRegion="polite" style={conversationStyles.error}>{appText(locale, "inline.assistant.chatHistoryCouldNotBeSavedExistingHistory", {"zh":"暫時未能儲存對話，原有歷史未被覆蓋。如需保留這段對話，請先不要關閉此頁。","en":"Chat history could not be saved. Existing history has not been replaced. Please keep this page open if you need this conversation."})}</Text>}
		<View style={styles.notice}><MaterialCommunityIcons name="shield-check" size={20} color="#840B1C" /><Text style={styles.noticeText}>{i18n.t("aiMedicalNotice")}</Text></View>
		<AssistantKeyboardSpacer active={isFocused} bottomInset={insets.bottom} onInsetChange={setKeyboardHistoryInset}>
		{conversationLoaded ? <FlatList ref={chatScroll.listRef} testID="assistant-message-list" style={{ flex: 1 }} inverted removeClippedSubviews={Platform.OS === "android" ? false : undefined} onScroll={chatScroll.onScroll} onScrollBeginDrag={chatScroll.onScrollBeginDrag} onContentSizeChange={chatScroll.onContentSizeChange} onLayout={chatScroll.onLayout} onWheel={chatScroll.onWheel} onTouchMove={chatScroll.onTouchMove} scrollEventThrottle={32} maintainVisibleContentPosition={chatScroll.maintainVisibleContentPosition} keyboardDismissMode="on-drag" data={listMessages} keyExtractor={(item) => item.id} contentContainerStyle={[styles.list, { paddingTop: 24, paddingBottom: 15 + (Platform.OS === "android" ? keyboardHistoryInset : 0) }]} keyboardShouldPersistTaps="handled" renderItem={renderMessage} ListHeaderComponent={busy ? <AssistantJobStatus task={pendingTask} locale={locale} thinkingLabel={i18n.t("aiChatThinking")} onRecheck={() => recheckAssistantJobs({ owner: conversationScope.owner, token: user.token })} onLogin={() => router.push({ pathname: "/login", params: { from: "settings" } })} /> : null} /> : <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator color="#840B1C" /></View>}
		<AssistantReplySpeechControls locale={locale} speech={replySpeech} />
		<View style={[styles.inputBar, { paddingBottom: Platform.OS === "android" ? Math.max(10, insets.bottom) : keyboard.visible ? 10 : Math.max(10, insets.bottom) }]}>
			<AssistantMessageInput testID="assistant-message-input" editable={conversationLoaded && !historyStarting} value={text} onChangeText={changeDraft} maxLength={600} placeholder={i18n.t("aiChatPlaceholder")} />
			<TouchableOpacity testID="assistant-send" accessibilityRole="button" accessibilityLabel={appText(locale, "inline.assistant.sendMessage", {"zh":"發送問題","en":"Send message"})} style={[styles.send, (!text.trim() || busy || !conversationLoaded || historyStarting) && styles.disabled]} onPress={send} disabled={!text.trim() || busy || !conversationLoaded || historyStarting}><Ionicons name="send" size={21} color="#fff" /></TouchableOpacity>
		</View>
		</AssistantKeyboardSpacer>
	</KeyboardContainer></View>;
}

const replyStyles = StyleSheet.create({
	toggle: { minHeight: 52, marginTop: 12, paddingVertical: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, backgroundColor: "#F7E9EC", borderWidth: 1, borderColor: "#E8D5D9" },
	toggleText: { flexShrink: 1, fontSize: Math.max(18, RFValue(13)), lineHeight: Math.max(26, RFValue(19)), fontWeight: "700", color: "#840B1C" },
});

const conversationStyles = StyleSheet.create({
	toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: "#fff", paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#EEE8E9" },
	button: { minHeight: 48, maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 6, paddingVertical: 8 },
	buttonText: { flexShrink: 1, fontSize: Math.max(16, RFValue(11)), color: "#840B1C", fontWeight: "600" },
	runtimeError: { minHeight: 48 },
	error: { fontSize: 14, lineHeight: 21, color: "#8E361D", paddingHorizontal: 16, paddingVertical: 9, backgroundColor: "#FFF5E6" },
});

const styles=StyleSheet.create({page:{flex:1,backgroundColor:"#F5F1EA"},notice:{flexDirection:"row",alignItems:"flex-start",gap:8,backgroundColor:"#FFF5E6",borderBottomWidth:1,borderBottomColor:"#F3D4A4",paddingHorizontal:15,paddingVertical:11},noticeText:{flex:1,fontSize:RFValue(10),lineHeight:RFValue(15),color:"#6A4A1B"},list:{padding:15,paddingBottom:24},row:{flexDirection:"row",alignItems:"flex-start",marginBottom:13,maxWidth:"93%"},userRow:{alignSelf:"flex-end",justifyContent:"flex-end"},botIcon:{width:38,height:38,borderRadius:19,alignItems:"center",justifyContent:"center",backgroundColor:"#fff",marginRight:8,borderWidth:1,borderColor:"#E8D9DC"},bubble:{borderRadius:16,padding:13},aiBubble:{flex:1,backgroundColor:"#fff",borderTopLeftRadius:4},userBubble:{flexShrink:1,backgroundColor:"#840B1C",borderTopRightRadius:4},localSource:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",gap:5,borderRadius:11,backgroundColor:"#F7E9EC",paddingHorizontal:8,paddingVertical:4,marginBottom:8},localSourceText:{fontSize:RFValue(9),fontWeight:"800",color:"#840B1C"},message:{fontSize:RFValue(13),lineHeight:RFValue(20),color:"#292929"},userText:{color:"#fff"},equipmentCard:{flexDirection:"row",alignItems:"center",gap:10,marginTop:11,borderWidth:1,borderColor:"#E4DADC",borderRadius:12,padding:9,backgroundColor:"#FCFAFA"},equipmentImage:{width:66,height:58,borderRadius:8,resizeMode:"cover"},equipmentImagePlaceholder:{width:66,height:58,borderRadius:8,alignItems:"center",justifyContent:"center",backgroundColor:"#F5EDEF"},equipmentName:{fontSize:RFValue(12),fontWeight:"800",color:"#222"},reason:{fontSize:RFValue(11),lineHeight:RFValue(17),color:"#555",marginTop:5},linkText:{fontSize:RFValue(10),fontWeight:"700",color:"#840B1C",marginTop:5},actionButton:{minHeight:45,marginTop:12,borderRadius:10,backgroundColor:"#840B1C",flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center",paddingHorizontal:12},actionText:{fontSize:RFValue(11),fontWeight:"800",color:"#fff"},thinking:{flexDirection:"row",gap:9,alignItems:"center",padding:12},thinkingText:{fontSize:RFValue(11),color:"#666"},inputBar:{flexDirection:"row",alignItems:"flex-end",gap:9,padding:10,backgroundColor:"#fff",borderTopWidth:1,borderTopColor:"#E5E5E5"},input:{flex:1,minHeight:48,maxHeight:128,borderWidth:1,borderColor:"#D8D8D8",borderRadius:23,paddingHorizontal:16,paddingVertical:11,fontSize:RFValue(13),backgroundColor:"#FAFAFA"},send:{width:48,height:48,borderRadius:24,alignItems:"center",justifyContent:"center",backgroundColor:"#840B1C"},disabled:{opacity:.45},restricted:{flex:1,alignItems:"center",justifyContent:"center",padding:30,backgroundColor:"#fff"},restrictedTitle:{fontSize:RFValue(18),fontWeight:"900",color:"#840B1C",textAlign:"center",marginTop:16},restrictedText:{fontSize:RFValue(13),lineHeight:RFValue(20),color:"#666",textAlign:"center",marginTop:8},restrictedButton:{minHeight:48,borderRadius:24,backgroundColor:"#840B1C",paddingHorizontal:26,alignItems:"center",justifyContent:"center",marginTop:20},restrictedButtonText:{color:"#fff",fontWeight:"800"}});
