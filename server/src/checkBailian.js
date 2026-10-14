import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBailianFaqSelector } from "./assistantBailian.js";
import { bailianFaqCandidates } from "./assistantBailianFaq.js";

// Explicit opt-in diagnostic. Prints no API key, raw response or account data.
export async function checkBailian(env = process.env, options = {}) {
  const select = createBailianFaqSelector(env, options);
  if (!select) throw new Error("BAILIAN_FAQ_DISABLED");
  const started = Date.now();
  const selection = await select({
    question: "Which section lets me replay the clips?", locale: "en",
    candidates: bailianFaqCandidates("Which section lets me replay the clips?", "en"),
  });
  return { ok: selection.action === "faq" && selection.faqId === "app-videos", model: select.model, selection, elapsedMs: Date.now() - started };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--run") {
    console.log("No request sent. Run node src/checkBailian.js --run to make one billable test request using server environment variables.");
  } else {
    try {
      const result = await checkBailian();
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    } catch {
      console.error("BAILIAN_CHECK_FAILED: check server configuration, deployment status and API-key workspace; the request must complete within 3 seconds.");
      process.exitCode = 1;
    }
  }
}
