import { deleteSession, getSessions, saveSession } from "../sessions";
import { deleteServerSession, getServerSessions, saveServerSession } from "../api";

let mockOwner = "participant-locked";
const mockStorage = new Map();
jest.mock("../userStorage", () => ({
	getCurrentOwnerKey: () => mockOwner,
	getUserJson: jest.fn(async (key, fallback) => mockStorage.has(`${mockOwner}:${key}`) ? structuredClone(mockStorage.get(`${mockOwner}:${key}`)) : fallback),
	setUserJson: jest.fn(async (key, value) => { mockStorage.set(`${mockOwner}:${key}`, structuredClone(value)); }),
}));
jest.mock("../api", () => ({ getServerSessions: jest.fn(), saveServerSession: jest.fn(), deleteServerSession: jest.fn() }));

const session = { id: "completed-in-background", date: "2026-09-08T08:00:00Z", durationSec: 60, journal: "after screen unlock" };
const flush = async () => { for (let turn = 0; turn < 60; turn += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
	mockOwner = "participant-locked";
	mockStorage.clear();
	jest.clearAllMocks();
	getServerSessions.mockResolvedValue({ sessions: [] });
	saveServerSession.mockResolvedValue({ session });
	deleteServerSession.mockResolvedValue({});
});

test("a slow older upload cannot clear the pending flag for a newer offline edit", async () => {
	const remote = deferred();
	saveServerSession.mockReturnValueOnce(remote.promise).mockRejectedValueOnce(new Error("offline"));
	await saveSession(session, "token", { waitForSync: false });
	await flush();
	const edited = { ...session, journal: "newest edit" };
	await saveSession(edited, "token", { waitForSync: false });
	remote.resolve({ session });
	await flush();
	expect(await getSessions()).toEqual([edited]);
	expect(mockStorage.get(`${mockOwner}:exerciseSessionsPendingSync`)).toContain(session.id);
	expect(saveServerSession.mock.calls.map((call) => call[1].journal)).toEqual([session.journal, edited.journal]);
});

test("a refresh preserves edits made while its pending upload is in flight", async () => {
	await saveSession(session);
	const remote = deferred();
	saveServerSession.mockReturnValueOnce(remote.promise).mockRejectedValueOnce(new Error("offline"));
	const refresh = getSessions("token");
	await flush();
	const edited = { ...session, journal: "edited during synchronization" };
	await saveSession(edited, "token", { waitForSync: false });
	remote.resolve({ session });
	expect(await refresh).toEqual([edited]);
	await flush();
	expect(mockStorage.get(`${mockOwner}:exerciseSessionsPendingSync`)).toContain(session.id);
	expect(await getSessions()).toEqual([edited]);
});

test("an upload rejected by the server retains its local record and pending marker", async () => {
	saveServerSession.mockRejectedValueOnce(Object.assign(new Error("unauthorized"), { status: 401 }));
	await saveSession(session, "token");
	expect(await getSessions()).toEqual([session]);
	expect(mockStorage.get(`${mockOwner}:exerciseSessionsPendingSync`)).toContain(session.id);
});

test("an incomplete server response cannot be treated as an empty authoritative history", async () => {
	await saveSession(session, "token");
	mockStorage.set(`${mockOwner}:exerciseSessionsCloudMigrated`, true);
	getServerSessions.mockResolvedValueOnce({});
	expect(await getSessions("token")).toEqual([session]);
	expect(await getSessions()).toEqual([session]);
});

test("an upload finishing after sign-out cannot clear or create another account's local records", async () => {
	const remote = deferred();
	saveServerSession.mockReturnValueOnce(remote.promise);
	await saveSession(session, "token", { waitForSync: false });
	await flush();
	mockOwner = "new-participant";
	remote.resolve({ session });
	await flush();
	expect(await getSessions()).toEqual([]);
	expect(mockStorage.has("new-participant:exerciseSessionsPendingSync")).toBe(false);
	expect(mockStorage.get("participant-locked:exerciseSessionsPendingSync")).toContain(session.id);
});

test("a failed old refresh returns the newest local record rather than its earlier snapshot", async () => {
	let rejectRemote;
	getServerSessions.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemote = reject; }));
	const refresh = getSessions("token");
	await flush();
	await saveSession(session);
	rejectRemote(new Error("connection interrupted"));
	expect(await refresh).toEqual([session]);
});

test("a pending deletion does not erase a newer edit whose subsequent upload fails", async () => {
	await saveSession(session);
	const remote = deferred();
	deleteServerSession.mockReturnValueOnce(remote.promise);
	const deleting = deleteSession(session.id, "token");
	await flush();
	const edited = { ...session, journal: "newer than delete" };
	saveServerSession.mockRejectedValueOnce(new Error("offline"));
	await saveSession(edited, "token", { waitForSync: false });
	remote.resolve({});
	await deleting;
	await flush();
	expect(await getSessions()).toEqual([edited]);
	expect(mockStorage.get(`${mockOwner}:exerciseSessionsPendingSync`)).toContain(session.id);
});

test("a stalled refresh after unlock does not block committing a completed exercise locally", async () => {
	const remote = deferred();
	getServerSessions.mockReturnValueOnce(remote.promise);
	const refresh = getSessions("token");
	await flush();
	let saved = false;
	const saving = saveSession(session, "token", { waitForSync: false }).then(() => { saved = true; });
	await flush();
	try {
		expect(saved).toBe(true);
		expect(mockStorage.get(`${mockOwner}:exerciseSessions`)).toEqual([session]);
		expect(await getSessions()).toEqual([session]);
	} finally {
		remote.resolve({ sessions: [] });
		await Promise.all([refresh, saving]);
		await flush();
	}
});

test("a stalled upload cannot keep the saved summary waiting or discard the pending local record", async () => {
	const remote = deferred();
	saveServerSession.mockReturnValueOnce(remote.promise);
	let saved = false;
	const saving = saveSession(session, "token", { waitForSync: false }).then(() => { saved = true; });
	await flush();
	try {
		expect(saved).toBe(true);
		expect(mockStorage.get(`${mockOwner}:exerciseSessionsPendingSync`)).toContain(session.id);
		expect(await getSessions()).toEqual([session]);
	} finally {
		remote.resolve({ session });
		await saving;
		await flush();
	}
});
