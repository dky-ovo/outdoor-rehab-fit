// Use real short utterances as evidence on engines without word-boundary events.
export function speechChunks(text, size = 120) {
	const chunks = [];
	for (let start = 0; start < text.length;) {
		let end = Math.min(text.length, start + size);
		if (end < text.length) {
			const candidate = text.slice(start, end);
			const boundary = Math.max(...["。", "！", "？", ". ", "; ", "\n", " "].map((separator) => candidate.lastIndexOf(separator)));
			if (boundary >= size / 3) end = start + boundary + 1;
			if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
		}
		chunks.push({ text: text.slice(start, end), start, end });
		start = end;
	}
	return chunks;
}
