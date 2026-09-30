let alertHandler = null;
let nextAlertId = 1;
const pendingAlerts = [];
let exclusiveAlertId = null;
export const dismissAppAlert = id => { if (exclusiveAlertId === id) exclusiveAlertId = null; };

export const setAppAlertHandler = (handler) => {
	alertHandler = handler;
	while (alertHandler && pendingAlerts.length) {
		alertHandler(pendingAlerts.shift());
	}
	return () => {
		if (alertHandler === handler) alertHandler = null;
	};
};

export const showAlert = (title, message, buttons, options = {}) => {
	if (exclusiveAlertId !== null && !options.sessionEnded) return;
	const payload = {
		id: nextAlertId++,
		title: title || "",
		message: message || "",
		buttons: buttons?.length ? buttons : [{ text: "OK" }],
		...(options.sessionEnded ? { replaceAll: true } : {}),
	};
	if (options.sessionEnded) { exclusiveAlertId = payload.id; pendingAlerts.length = 0; }
	if (alertHandler) alertHandler(payload);
	else pendingAlerts.push(payload);
};
