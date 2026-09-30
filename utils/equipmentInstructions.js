export function equipmentInstructionParts(value) {
	const sentences = String(value || "")
		.replace(/([。！？!?])\s*/g, "$1\n")
		.split(/\n+/)
		.map((line) => line.replace(/^\s*(?:\d+[.)、]|[-•])\s*/, "").trim())
		.filter(Boolean);
	const warningPattern = /注意|避免|不可|不要|請勿|停止|疼痛|不適|危險|warning|caution|avoid|do not|stop|pain|discomfort/i;
	return {
		steps: sentences.filter((line) => !warningPattern.test(line)),
		warnings: sentences.filter((line) => warningPattern.test(line)),
	};
}

export function formatEquipmentInstructionSteps(value, locale = "zh") {
	const { steps } = equipmentInstructionParts(value);
	if (!steps.length) return "";
	const heading = locale === "en" ? "Steps" : "使用步驟";
	return `${heading}\n\n${steps.map((step, index) => `${index + 1}\n${step}`).join("\n\n")}`;
}
