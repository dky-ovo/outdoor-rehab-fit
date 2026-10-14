import { deleteSession, getSessions, saveSession } from "../sessions";
import { deleteServerSession, getServerSessions, saveServerSession } from "../api";
import { getUserJson, setUserJson } from "../userStorage";

let mockOwner = "participant-1";
const mockStorage = new Map();
jest.mock("../userStorage", () => ({
	getCurrentOwnerKey: () => mockOwner,
	getUserJson: jest.fn(async (key, fallback) => mockStorage.has(`${mockOwner}:${key}`) ? structuredClone(mockStorage.get(`${mockOwner}:${key}`)) : fallback),
	setUserJson: jest.fn(async (key, value) => { mockStorage.set(`${mockOwner}:${key}`, structuredClone(value)); }),
}));
jest.mock("../api", () => ({ getServerSessions: jest.fn(), saveServerSession: jest.fn(), deleteServerSession: jest.fn() }));

const original = { id: "session-1", date: "2026-09-07T01:00:00Z", durationSec: 600, journal: "original" };
beforeEach(() => {
	mockOwner = "participant-1";
	mockStorage.clear();
	jest.clearAllMocks();
	getServerSessions.mockResolvedValue({ sessions: [original] });
	saveServerSession.mockResolvedValue({ session: original });
	deleteServerSession.mockResolvedValue({});
});

test("an offline edit to an existing server record is retried instead of overwritten", async () => {
	await setUserJson("exerciseSessions", [original]);
	await setUserJson("exerciseSessionsCloudMigrated", true);
	const edited = { ...original, durationSec: 1200, journal: "edited offline" };
	saveServerSession.mockRejectedValueOnce(new Error("offline"));
	await saveSession(edited, "token");
	expect(await getSessions("token")).toEqual([edited]);
	expect(saveServerSession).toHaveBeenLastCalledWith("token", edited);
	expect(await getUserJson("exerciseSessionsPendingSync", [])).toEqual([]);
});

test("overlapping saves retain both records and a subsequent refresh retains pending data", async () => {
	const second = { ...original, id: "session-2", date: "2026-09-07T02:00:00Z" };
	await Promise.all([saveSession(original), saveSession(second)]);
	expect(await getSessions()).toEqual([second, original]);
	getServerSessions.mockResolvedValueOnce({ sessions: [] });
	expect(await getSessions("token")).toEqual([second, original]);
});

test("an in-flight account refresh cannot write the former account's records into a new account", async () => {
	let resolveFetch;
	getServerSessions.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
	const pending = getSessions("old-token");
	while (!resolveFetch) await Promise.resolve();
	mockOwner = "participant-2";
	resolveFetch({ sessions: [original] });
	await expect(pending).resolves.toEqual([]);
	expect(mockStorage.has("participant-2:exerciseSessions")).toBe(false);
});

test("deleting a locally pending record removes its pending upload and accepts numeric ids", async () => {
	await saveSession({ ...original, id: 3 });
	expect(await deleteSession("3")).toEqual([]);
	expect(await getUserJson("exerciseSessionsPendingSync", [])).toEqual([]);
});

test('one rejected offline session does not hide records downloaded from another device', async () => {
	const invalid = { ...original, id: 'offline-invalid', journal: 'kept locally' };
	const remote = { ...original, id: 'from-phone', date: '2026-10-06T01:00:00Z' };
	await saveSession(invalid);
	getServerSessions.mockResolvedValue({ sessions: [remote] });
	const failure = Object.assign(new Error('invalidSession'), { status: 400, code: 'invalidSession' });
	saveServerSession.mockRejectedValue(failure);
	await expect(getSessions('token', { strict: true })).rejects.toBe(failure);
	expect(await getSessions()).toEqual([remote, invalid]);
	expect(await getUserJson('exerciseSessionsPendingSync', [])).toEqual(['offline-invalid']);
});

test('a partially successful first migration acknowledges only uploaded sessions and retains other edits', async () => {
	const failed = { ...original, id: 'failed' }, uploaded = { ...original, id: 'uploaded' };
	await setUserJson('exerciseSessions', [failed, uploaded]);
	getServerSessions.mockResolvedValue({ sessions: [] });
	saveServerSession.mockImplementation(async (_token, value) => { if(value.id==='failed') throw Error('invalid'); return {session:value}; });
	await expect(getSessions('token', {strict:true})).rejects.toThrow('invalid');
	expect((await getSessions()).map(item=>item.id).sort()).toEqual(['failed','uploaded']);
	expect(await getUserJson('exerciseSessionsPendingSync', [])).toEqual(['failed']);
});
