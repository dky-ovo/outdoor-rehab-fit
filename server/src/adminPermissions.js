export const ADMIN_ROLES = new Set(["super_admin", "admin", "operator"]);
export const APP_MAINTENANCE_PERMISSIONS = [
	"app_maintenance.text.manage",
	"app_maintenance.home.manage",
	"app_maintenance.equipment.manage",
	"app_maintenance.locations.manage",
	"app_maintenance.ai.manage",
	"app_maintenance.files.manage",
];
export const OPERATOR_PERMISSIONS = new Set([
	"dashboard.read",
	"users.read",
	"users.edit",
	"app_maintenance.manage",
	...APP_MAINTENANCE_PERMISSIONS,
	"research.read",
	"messages.read",
	"messages.delete",
	"data.export",
	"facilities.manage",
	"feedback.read",
	"feedback.manage",
	"admin_assistant.use",
]);
export const ADMIN_PERMISSIONS = new Set([...OPERATOR_PERMISSIONS, "operators.manage"]);
export const SUPER_ADMIN_PERMISSIONS = new Set([...ADMIN_PERMISSIONS, "system_logs.read"]);

export function parsePermissions(account) {
	if (account.system_role === "super_admin") return [...SUPER_ADMIN_PERMISSIONS];
	if (account.system_role === "admin") return [...ADMIN_PERMISSIONS];
	try {
		const requested = JSON.parse(account.permissions_json || "[]");
		const allowed = requested.filter((permission) => OPERATOR_PERMISSIONS.has(permission));
		if (allowed.includes("app_maintenance.manage")) allowed.push(...APP_MAINTENANCE_PERMISSIONS);
		return [...new Set(allowed)];
	} catch {
		return [];
	}
}
