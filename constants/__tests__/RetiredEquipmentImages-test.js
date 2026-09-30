import { equipmentTranslations } from "../Equipments";

const placeholder = require("../../assets/icons/outdoor.png");

test.each([["en", "J-__1ClLJqY"], ["zh", "JC0vtfK5i5s"]])("%s Rider starts with a neutral image until the managed picture is known", (language, videoKey) => {
	const rider = equipmentTranslations[language].equipmentList.find(item => String(item.id) === "9");
	expect(rider).toBeDefined();
	expect(rider.icon).toBe(placeholder);
	expect(rider.horizontalPic).toBe(placeholder);
	expect(rider.pic).toBe("");
	// Keep the equipment's stable identity and teaching content when retiring photos.
	expect(rider.youtubeKey).toBe(videoKey);
	expect(rider.details.length).toBeGreaterThan(50);
});
