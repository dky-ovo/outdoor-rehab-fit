export const AUTH_STORAGE_KEY = "authSession";
export const AUTH_INACTIVITY_LIMIT_MS = 90 * 60 * 1000;
export const REGISTERED_USERS_KEY = "registeredUsers";
export const PRESET_PASSWORD_KEY = "presetPasswordOverride";
export const RESET_CODE_KEY = "passwordResetCode";

export const AUTH_ROLES = {
	USER: "user",
	GUEST: "guest",
};

export const USER_PROFILE_ROLES = {
	PARTICIPANT: "participant",
	STAFF: "staff",
	VOLUNTEER: "volunteer",
	// Older builds stored this value. The server normalizes it to "volunteer".
	CAREGIVER: "caregiver",
};

export const PRESET_USER = {
	name: "Demo User",
	phone: "91234567",
	email: "demo@polyu.edu.hk",
	password: "outdoor2026",
	role: USER_PROFILE_ROLES.PARTICIPANT,
};

/** Offline demo verification code shown in the UI after "sending". */
export const DEMO_VERIFICATION_CODE = "123456";
export const RESET_CODE_TTL_MS = 10 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;

export function normalizePhone(phone) {
	return phone.replace(/\D/g, "").replace(/^852/, "");
}

export function normalizeEmail(email) {
	return email.trim().toLowerCase();
}

export function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone) {
	const normalized = normalizePhone(phone);
	return /^[0-9]{8}$/.test(normalized);
}

export function isEmailLogin(identifier) {
	return identifier.trim().includes("@");
}

export async function getRegisteredUsers(storage) {
	const data = await storage.getItem(REGISTERED_USERS_KEY);
	return data ? JSON.parse(data) : [];
}

async function getPresetPassword(storage) {
	const override = await storage.getItem(PRESET_PASSWORD_KEY);
	return override || PRESET_USER.password;
}

function buildUserRecord({ name, phone, email, role, password }) {
	return {
		name: name.trim(),
		phone: normalizePhone(phone),
		email: email?.trim() ? normalizeEmail(email) : "",
		role,
		password,
	};
}

export async function saveRegisteredUser(storage, userInput) {
	const users = await getRegisteredUsers(storage);
	const user = buildUserRecord(userInput);

	if (!user.name) {
		return { success: false, error: "nameRequired" };
	}

	if (!isValidPhone(user.phone)) {
		return { success: false, error: "invalidPhone" };
	}

	if (user.email && !isValidEmail(user.email)) {
		return { success: false, error: "invalidEmail" };
	}

	if (users.some((item) => item.phone === user.phone)) {
		return { success: false, error: "phoneExists" };
	}

	if (user.email && users.some((item) => item.email === user.email)) {
		return { success: false, error: "emailExists" };
	}

	users.push(user);
	await storage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
	return { success: true, user };
}

function matchesPresetUser() {
	return {
		name: PRESET_USER.name,
		phone: PRESET_USER.phone,
		email: PRESET_USER.email,
		role: PRESET_USER.role,
	};
}

function toSessionUser(user) {
	return {
		name: user.name,
		phone: user.phone,
		email: user.email || "",
		profileRole: user.role,
	};
}

export async function findAccountByIdentifier(storage, identifier) {
	const trimmedIdentifier = identifier.trim();
	if (!trimmedIdentifier) {
		return null;
	}

	const users = await getRegisteredUsers(storage);

	if (isEmailLogin(trimmedIdentifier)) {
		const email = normalizeEmail(trimmedIdentifier);
		if (!isValidEmail(email)) {
			return { error: "invalidEmail" };
		}

		if (email === PRESET_USER.email) {
			return { type: "preset", channel: "email", target: email, user: matchesPresetUser() };
		}

		const matchedUser = users.find((user) => user.email === email);
		if (matchedUser) {
			return { type: "registered", channel: "email", target: email, user: matchedUser };
		}

		return { error: "accountNotFound" };
	}

	if (!isValidPhone(trimmedIdentifier)) {
		return { error: "invalidPhone" };
	}

	const phone = normalizePhone(trimmedIdentifier);
	if (phone === PRESET_USER.phone) {
		return { type: "preset", channel: "phone", target: phone, user: matchesPresetUser() };
	}

	const matchedUser = users.find((user) => user.phone === phone);
	if (matchedUser) {
		return { type: "registered", channel: "phone", target: phone, user: matchedUser };
	}

	return { error: "accountNotFound" };
}

export async function sendDemoVerificationCode(storage, identifier) {
	const account = await findAccountByIdentifier(storage, identifier);
	if (!account || account.error) {
		return { success: false, error: account?.error || "accountNotFound" };
	}

	const payload = {
		code: DEMO_VERIFICATION_CODE,
		identifier: account.target,
		channel: account.channel,
		type: account.type,
		expiresAt: Date.now() + RESET_CODE_TTL_MS,
	};

	await storage.setItem(RESET_CODE_KEY, JSON.stringify(payload));

	return {
		success: true,
		demoCode: DEMO_VERIFICATION_CODE,
		channel: account.channel,
		target: account.target,
	};
}

export async function resetPasswordWithCode(storage, identifier, code, newPassword, confirmPassword) {
	if (!identifier?.trim() || !code?.trim() || !newPassword || !confirmPassword) {
		return { success: false, error: "resetRequired" };
	}

	if (newPassword.length < MIN_PASSWORD_LENGTH) {
		return { success: false, error: "passwordTooShort" };
	}

	if (newPassword !== confirmPassword) {
		return { success: false, error: "passwordMismatch" };
	}

	const account = await findAccountByIdentifier(storage, identifier);
	if (!account || account.error) {
		return { success: false, error: account?.error || "accountNotFound" };
	}

	const stored = await storage.getItem(RESET_CODE_KEY);
	if (!stored) {
		return { success: false, error: "codeExpired" };
	}

	const payload = JSON.parse(stored);
	if (Date.now() > payload.expiresAt) {
		await storage.removeItem(RESET_CODE_KEY);
		return { success: false, error: "codeExpired" };
	}

	if (payload.identifier !== account.target || payload.code !== code.trim()) {
		return { success: false, error: "invalidCode" };
	}

	if (account.type === "preset") {
		await storage.setItem(PRESET_PASSWORD_KEY, newPassword);
	} else {
		const users = await getRegisteredUsers(storage);
		const updatedUsers = users.map((user) => {
			if (account.channel === "email" && user.email === account.target) {
				return { ...user, password: newPassword };
			}
			if (account.channel === "phone" && user.phone === account.target) {
				return { ...user, password: newPassword };
			}
			return user;
		});
		await storage.setItem(REGISTERED_USERS_KEY, JSON.stringify(updatedUsers));
	}

	await storage.removeItem(RESET_CODE_KEY);
	return { success: true };
}

export async function validateCredentials(storage, identifier, password) {
	const trimmedIdentifier = identifier.trim();

	if (!trimmedIdentifier || !password) {
		return { valid: false, error: "loginRequired" };
	}

	const loginByEmail = isEmailLogin(trimmedIdentifier);
	const presetPassword = await getPresetPassword(storage);

	if (loginByEmail) {
		const email = normalizeEmail(trimmedIdentifier);
		if (!isValidEmail(email)) {
			return { valid: false, error: "invalidEmail" };
		}

		if (email === PRESET_USER.email && password === presetPassword) {
			return { valid: true, user: matchesPresetUser() };
		}

		const users = await getRegisteredUsers(storage);
		const matchedUser = users.find((user) => user.email === email && user.password === password);

		if (matchedUser) {
			return { valid: true, user: toSessionUser(matchedUser) };
		}

		const emailRegistered = users.some((user) => user.email === email) || email === PRESET_USER.email;
		if (!emailRegistered) {
			return { valid: false, error: "emailNotRegistered" };
		}

		return { valid: false, error: "invalidCredentials" };
	}

	const phone = normalizePhone(trimmedIdentifier);

	if (!isValidPhone(phone)) {
		return { valid: false, error: "invalidPhone" };
	}

	if (phone === PRESET_USER.phone && password === presetPassword) {
		return { valid: true, user: matchesPresetUser() };
	}

	const users = await getRegisteredUsers(storage);
	const matchedUser = users.find((user) => user.phone === phone && user.password === password);

	if (matchedUser) {
		return { valid: true, user: toSessionUser(matchedUser) };
	}

	return { valid: false, error: "invalidCredentials" };
}
