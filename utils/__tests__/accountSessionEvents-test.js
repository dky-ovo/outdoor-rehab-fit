import { activateAccountSession, captureAccountSession, clearAccountSession, reportAccountDeleted, subscribeAccountDeleted } from "../accountSessionEvents";
import { getCurrentUser, getServerSessions, loginAccount } from "../api";
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
let receive, unsubscribe;
beforeEach(() => { activateAccountSession(null); receive = jest.fn(); unsubscribe = subscribeAccountDeleted(receive); global.fetch = jest.fn(); });
afterEach(() => { unsubscribe(); activateAccountSession(null); });
test("any authenticated API deletion publishes its captured session and retains the original error", async () => {
  const scope = activateAccountSession("one"); fetch.mockResolvedValue(response(401, { error: "accountDeleted" }));
  await expect(getServerSessions("one")).rejects.toMatchObject({ status: 401, code: "accountDeleted" });
  expect(receive).toHaveBeenCalledWith(scope);
});
test.each([[500, "accountDeleted"], [401, "unauthorized"], [403, "forbidden"]])("%s/%s is not proof of deletion", async (status, code) => {
  activateAccountSession("one"); fetch.mockResolvedValue(response(status, { error: code }));
  await expect(getCurrentUser("one")).rejects.toMatchObject({ status, code }); expect(receive).not.toHaveBeenCalled();
});
test("requests from another token and unauthenticated login cannot invalidate the APP account", async () => {
  activateAccountSession("one"); fetch.mockResolvedValue(response(401, { error: "accountDeleted" }));
  await expect(getCurrentUser("admin-two")).rejects.toBeDefined(); await expect(loginAccount("phone", "password")).rejects.toBeDefined();
  expect(receive).not.toHaveBeenCalled();
});
test("a request begun before a same-token relogin cannot invalidate the new local login", async () => {
  let resolve; fetch.mockReturnValue(new Promise(done => { resolve = done; }));
  const old = activateAccountSession("one"), pending = getCurrentUser("one");
  const current = activateAccountSession("one"); clearAccountSession(old);
  resolve(response(401, { error: "accountDeleted" })); await expect(pending).rejects.toBeDefined();
  expect(receive).not.toHaveBeenCalled(); expect(captureAccountSession("one")).toBe(current);
});
test("listener failure cannot turn a confirmed HTTP error into a network failure", async () => {
  const stop = subscribeAccountDeleted(() => { throw new Error("listener failed"); });
  activateAccountSession("one"); fetch.mockResolvedValue(response(401, { error: "accountDeleted" }));
  await expect(getCurrentUser("one")).rejects.toMatchObject({ code: "accountDeleted", status: 401 }); stop();
});
