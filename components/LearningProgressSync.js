import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { getOwnerKey } from "../utils/userStorage";
import { subscribeLearningChanges } from "../utils/learning";
import { createLearningSync } from "../utils/learningSync";

export default function LearningProgressSync() {
	const { user, isGuest, isLoading } = useAuth();
	const owner = user ? getOwnerKey(user) : null;
	const token = !isLoading && !isGuest ? user?.token : null;
	const identity = `${owner || ""}|${token || ""}`;
	const latest = useRef(identity);
	latest.current = identity;
	useEffect(() => {
		if (!token || !owner || owner === "guest") return undefined;
		let active = !AppState.currentState || AppState.currentState === "active";
		let timer;
		const worker = createLearningSync({ owner, token, isCurrent: () => latest.current === identity });
		const flush = () => { if (active) void worker.flush(); };
		const unsubscribe = subscribeLearningChanges((changedOwner) => {
			if (changedOwner !== owner || timer || !active) return;
			// Throttle (not debounce): continuous watching still uploads periodically.
			timer = setTimeout(() => { timer = undefined; flush(); }, 15000);
		});
		const subscription = AppState.addEventListener("change", (state) => {
			active = state === "active";
			if (active) flush();
			else { clearTimeout(timer); timer = undefined; }
		});
		const retry = setInterval(flush, 60000);
		flush();
		return () => { worker.dispose(); unsubscribe(); subscription.remove(); clearInterval(retry); clearTimeout(timer); };
	}, [identity, owner, token]);
	return null;
}
