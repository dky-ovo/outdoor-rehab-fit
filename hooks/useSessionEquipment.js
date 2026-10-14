import { useEffect, useState } from "react";
import { getBookmarks, getCachedBookmarks, subscribeBookmarkChanges } from "../utils/bookmarks";
import { getSessions } from "../utils/sessions";
import { countSessionEquipment } from "../utils/sessionEquipment";

export function useSessionEquipment(token) {
	const [state, setState] = useState(() => ({ token, bookmarks: getCachedBookmarks() || {}, usage: {} }));
	useEffect(() => {
		let active = true;
		setState({ token, bookmarks: getCachedBookmarks() || {}, usage: {} });
		const loadBookmarks = () => getBookmarks().then(bookmarks => {
			if (active) setState(current => ({ ...current, token, bookmarks }));
		}).catch(() => {});
		const unsubscribe = subscribeBookmarkChanges(loadBookmarks);
		loadBookmarks();
		getSessions(token).then(sessions => {
			if (active) setState(current => ({ ...current, token, usage: countSessionEquipment(sessions) }));
		}).catch(() => {});
		return () => { active = false; unsubscribe(); };
	}, [token]);
	return state.token === token ? state : { bookmarks: {}, usage: {} };
}
