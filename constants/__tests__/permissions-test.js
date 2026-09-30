import { FEATURES, GUEST_FACILITY_ACCESS_PERCENT, canAccess, canGuestAccessEquipment } from "../permissions";

describe("guest access policy", () => {
	it("blocks group chat and AI assistant but permits every other app feature", () => {
		expect(canAccess(FEATURES.GROUP_CHAT, true)).toBe(false);
		expect(canAccess(FEATURES.AI_CHAT, true)).toBe(false);
		Object.values(FEATURES)
			.filter((feature) => ![FEATURES.GROUP_CHAT, FEATURES.AI_CHAT].includes(feature))
			.forEach((feature) => expect(canAccess(feature, true)).toBe(true));
	});

	it("does not restrict signed-in users", () => {
		Object.values(FEATURES).forEach((feature) => expect(canAccess(feature, false)).toBe(true));
	});

	it("keeps a stable 40 percent Facility Guide sample for guests", () => {
		const ids = Array.from({ length: 30 }, (_, index) => index);
		const accessible = ids.filter(canGuestAccessEquipment);
		const currentCatalogIds = Array.from({ length: 29 }, (_, index) => index);
		expect(GUEST_FACILITY_ACCESS_PERCENT).toBe(40);
		expect(accessible).toHaveLength(12);
		expect(ids.filter((id) => !canGuestAccessEquipment(id))).toHaveLength(18);
		expect(currentCatalogIds.filter(canGuestAccessEquipment)).toHaveLength(12);
		expect(currentCatalogIds.filter((id) => !canGuestAccessEquipment(id))).toHaveLength(17);
		expect(accessible.every((id) => canGuestAccessEquipment(String(id)))).toBe(true);
	});
});
