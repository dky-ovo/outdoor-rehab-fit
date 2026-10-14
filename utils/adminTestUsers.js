// Credentials live only in component memory. Never persist them in localStorage,
// AsyncStorage, URLs, telemetry, or the server's batch metadata.
export function newTestUserBatch(random = globalThis.crypto) {
 if (!random?.getRandomValues) throw new Error("secureRandomUnavailable");
 const bytes = count => random.getRandomValues(new Uint8Array(count));
 const hex = values => [...values].map(value => value.toString(16).padStart(2, "0")).join("");
 const id = bytes(16); id[6] = (id[6] & 15) | 64; id[8] = (id[8] & 63) | 128;
 const raw = hex(id), batchId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
 return { batchId, passwords: Array.from({ length: 50 }, () => `T_${hex(bytes(24))}`) };
}
function csvCell(value) {
 const text = String(value ?? "");
 return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
}
export function testUsersCsv(result, draft) {
 if (!result || result.batchId !== draft?.batchId || result.disabledAt || result.accounts?.length !== 50 || draft.passwords?.length !== 50) throw new Error("credentialsUnavailable");
 return "\ufeff" + [["用户名（电邮）", "密码", "姓名", "批次"], ...result.accounts.map((account, index) => [account.email, draft.passwords[index], account.name, result.batchId])].map(row => row.map(csvCell).join(",")).join("\r\n");
}
