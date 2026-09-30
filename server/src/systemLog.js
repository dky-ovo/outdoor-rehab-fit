import crypto from "node:crypto";

export function writeSystemLog(database, request, action, targetType, targetId, metadata = {}) {
	const sql = `
		INSERT INTO system_logs
			(id, actor_user_id, actor_role, action, target_type, target_id, created_at, ip_address, metadata_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const values = [
		crypto.randomUUID(),
		request.admin?.user.id || null,
		request.admin?.account.system_role || null,
		action,
		targetType || null,
		targetId || null,
		new Date().toISOString(),
		String(request.ip || "").slice(0, 80) || null,
		JSON.stringify(metadata),
	];
	if (database?.dialect === "mysql") return database.run(sql, values).then(result => {
		if (result?.warningStatus !== 0 || result.affectedRows !== 1) {
			throw Object.assign(new Error("System log write failed"), { code: "SYSTEM_LOG_WRITE_FAILED" });
		}
		return result;
	});
	return database.prepare(sql).run(...values);
}
