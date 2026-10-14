import { newTestUserBatch, testUsersCsv } from "../adminTestUsers";
import { webcrypto } from "crypto";

test("new batches use secure randomness, unique 50 credentials and UUID v4", () => {
 const draft = newTestUserBatch(webcrypto);
 expect(draft.batchId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 expect(new Set(draft.passwords).size).toBe(50); expect(draft.passwords.every(value => /^T_[a-f0-9]{48}$/.test(value))).toBe(true);
 expect(() => newTestUserBatch({})).toThrow("secureRandomUnavailable");
});
test("CSV binds to the exact live batch and neutralizes spreadsheet formulas", () => {
 const draft = newTestUserBatch(webcrypto), result = { batchId:draft.batchId,accounts:draft.passwords.map((_,i) => ({email:`test${i}@example.invalid`,name:i ? 'Test' : '=FORMULA()'})) };
 const csv = testUsersCsv(result,draft);
 expect(csv.split("\r\n")).toHaveLength(51); expect(csv).toContain(draft.passwords[0]); expect(csv).toContain("'=FORMULA()");
 expect(() => testUsersCsv({...result,batchId:'other'},draft)).toThrow(); expect(() => testUsersCsv({...result,disabledAt:'now'},draft)).toThrow();
});
