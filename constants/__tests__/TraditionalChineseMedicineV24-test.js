import { createHash } from "node:crypto";
import {
	traditionalChineseMedicineContent,
	traditionalChineseMedicineEquipmentIds,
} from "../TraditionalChineseMedicine";
import revision from "../../server/src/tcmV24Content.json";
import guide from "../../server/src/equipmentGuideEvidence.json";

// Independently calculated from the two source Word cells for each highlighted
// TCM row (accepted revisions, not deleted text). Only whitespace is ignored.
const sourceRows = [
	["0", "1", "db3b3346825e4a4966c0a052591f8239102d318871a848668b1c4a6dfe2fc88f", "29b8cb8419d45538c7d002868a57e5ed11e3500398afdba02a702bfdf44f5cd9"],
	["4", "5a", "a53a13060fc53b2a6ded7a2f8ac13fbc4f04a7252d6bb483181b39ad45391a9f", "000debf293b40a22c26f11887618a095b4e248be3c119f4a5c0c52fd1290d60c"],
	["6", "5c", "dec5650166cf8ff648ed8d3f11ab079d8418f91288f2a460e085edd67d569ed2", "cb9d6ffeee0bdeb5eb1a42e6e24b7deda5e24dd870daf2af0fdc567deb6ff798"],
	["8", "7", "06ab20daa9b3bbeb587bee5e7427399416406311325415f8e0d2db9319da0e1d", "f53d05e09602c8935d9e758c7aa469d71153be19d3d2406027de41c26ee7426f"],
	["10", "9", "216ad4515a25b018c0c1c4b9d032da6d0bacbe6c62d56f3042899a6da6dc3bcd", "e4718c3eed7c30d89a62ffdd254ed24fc53078a51b4955abcdd6a5a68188ff2e"],
	["16", "14", "d11ba367a5407689f5e253fdd30ced12e4a79a5e8ac906e8cd0dabbbb1be58dd", "5360ab848cc2808e0a44cb9397025a4943a41833f189231710dbbe3a833d8186"],
	["19", "17", "9b400260fb46e66377f90c9fe9455605c606e03bae7d886b1e4a4a186f14c607", "7bc66489dae2f7e55b22ba9752801c7b9fbe9f059d9cc0a01dd0f98f240aeaa4"],
	["20", "18a", "1fdf55dd5a27fe518d4144358ab13021624472c96a4f32e6e77e6328306204aa", "19f28ab5e63282b5e56b5e8db4d6aa0f3ff0d4620d06acbb7fc8304b6fbf1613"],
	["22", "21", "67c778cbbefe1915ff22471caa7b76c9bbfc5a8f07e1a8f3baa7f5bedcea6276", "39fab394fc7319856787342b40210ad37823c2b9729f06b8089d455efa3e5775"],
];
const hash = (value) => createHash("sha256").update(value).digest("hex");

describe("V24 highlighted bilingual traditional Chinese medicine content", () => {
	it("limits the backend source update to the nine verified identities", () => {
		expect(revision.revision).toBe("equipment-tcm-v24-20260918");
		expect(revision.sourceSha256).toBe("aeb4eb8a0942d9c485300b310529507303ec54b60ed63b1d9f867033c65fe340");
		expect(revision.items.map(({ id, code }) => [id, code])).toEqual(sourceRows.map(([id, code]) => [id, code]));
	});

	it.each(sourceRows)("APP, server source and AI evidence match both Word cells for id %s/code %s", (id, code, zhHash, enHash) => {
		const item = revision.items.find((row) => row.id === id);
		expect(item.code).toBe(code);
		for (const [locale, field, expectedHash] of [["zh", "tcmZh", zhHash], ["en", "tcmEn", enHash]]) {
			expect(hash(item[field].replace(/\s/g, ""))).toBe(expectedHash);
			expect(traditionalChineseMedicineContent[locale][id]).toBe(item[field]);
			expect(guide[id][locale].tcmTip).toBe(item[field]);
			expect(guide[id][locale].tcmEnabled).toBe(true);
		}
	});

	it("preserves the Foot Massage Path Chinese original and missing English translation", () => {
		expect(hash(traditionalChineseMedicineContent.zh[28])).toBe("7f469ede6465749edd3731187cd4483c0c10f219d2d923dc4614c005cd14e4bc");
		expect(traditionalChineseMedicineContent.en[28]).toBeUndefined();
		expect(guide[28].en.tcmTip).toBe("");
		expect(traditionalChineseMedicineEquipmentIds).toEqual([0, 4, 6, 8, 10, 16, 19, 20, 22, 28]);
	});
});
