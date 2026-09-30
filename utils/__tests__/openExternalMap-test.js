import { Linking } from "react-native";
import { externalMapUrl, openExternalMap } from "../openExternalMap";

test("empty and invalid coordinates cannot silently navigate to zero degrees", async () => {
	for (const latitude of [null, undefined, "", "  ", false, [], {}, 91, "invalid"]) {
		expect(externalMapUrl({ latitude, longitude: 114.17 }, "android")).toBe("");
	}
	for (const longitude of [null, undefined, "", " ", true, 181, "invalid"]) {
		expect(externalMapUrl({ latitude: 22.31, longitude }, "ios")).toBe("");
	}
	const open = jest.spyOn(Linking, "openURL");
	await expect(openExternalMap({ latitude: null, longitude: null })).rejects.toMatchObject({ code: "invalidMapCoordinates" });
	expect(open).not.toHaveBeenCalled();
	open.mockRestore();
});

test("valid Hong Kong and numeric zero coordinates remain supported", () => {
	expect(externalMapUrl({ latitude: "22.3193", longitude: "114.1694", label: "測試地點" }, "android")).toContain("geo:22.3193,114.1694?");
	expect(externalMapUrl({ latitude: 0, longitude: "0" }, "ios")).toContain("daddr=0%2C0");
});
