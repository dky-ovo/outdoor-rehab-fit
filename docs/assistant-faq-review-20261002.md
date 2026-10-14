# AI FAQ and Android composer review — 2026-10-02

The complete supplied `FAQ for AI Chatbot.docx` was reviewed through its extracted text in `workspace-artifacts/app-suggestions-20261002/source/faq.txt`. The implementation contains 26 bilingual topics (including application navigation and the grouped out-of-scope examples). It uses deterministic retrieval and reviewed responses, **not model training**. Unmatched questions retain the existing assistant/Facility Guide flow.

## Runtime and boundaries

- `server/src/assistantFaqKnowledge.js` is the single public, pure knowledge module. The APP statically imports this file only; it contains no server services, credentials, filesystem access or user data. The API wrapper is `server/src/assistantFaq.js`.
- The existing authenticated, rate-limited assistant handler invokes the wrapper before ordinary symptom/model handling. Existing urgent symptoms retain priority. Additional red flags such as bladder/bowel changes and numbness in both legs receive an immediate safety response; the APP checks these before any local named-equipment lookup as well.
- Matching FAQs use no external model. Neither accounts nor exercise records are loaded or supplied to a provider. FAQ requests retain the existing durable assistant job and conversation workflow. No migration or new environment configuration is needed.
- Guide links use canonical IDs 0–28 against the currently published catalog, excluding inactive/deleted items. Names follow current catalog edits. No fabricated location inventory or nearest-park claim is made. Caregiver responses include current `careTip` text for matching upper-body guides.
- Client presentation rebuilds FAQ answers from this same knowledge module and current catalog, preventing historical symptom rewriting or automatic TCM prose from overriding reviewed content. Runtime chat uses the reviewed project FAQ and current APP guides only; editorial references remain in this review document and are not exposed as external chat links. The existing retained `focus` field identifies the topic after bounded conversation history is restored; extra metadata need not expand the stored-message schema.

## Editorial corrections

| Supplied content | Implemented handling and basis |
| --- | --- |
| Aerobic exercise should last at least 10 minutes each time | Removed the minimum bout requirement. General adult target is 150–300 minutes moderate or 75–150 vigorous weekly, strength on 2 days, and older-adult balance/strength activities on 3 days. Short bouts count. [WHO 2020 guidelines](https://www.who.int/publications/i/item/9789240015128), [WHO physical activity fact sheet](https://www.who.int/news-room/fact-sheets/detail/physical-activity). |
| Sweating slightly determines exercise intensity; early morning is universally suitable | Sweat is not used as an intensity target. Consider heat/humidity warnings, lighting, safe surfaces, hydration and cooler/indoor alternatives. [Department of Health heat guidance](https://www.elderly.gov.hk/tc_chi/healthy_ageing/healthy_living/heat.html). |
| A fixed meal-to-exercise interval and fixed warm-up/cool-down lengths for everyone | Avoid exercise immediately after a large meal; timing depends on meal size, intensity and individual needs. No personal diet or medication advice is generated. [Department of Health exercise precautions](https://www.change4health.gov.hk/en/physical_activity/facts/safety_tips/). |
| Moving-platform equipment offered to people with weak legs or recurrent falls | Prioritise assessment, support and supervision. No unsupervised stepper/airwalker progression or instruction to release handrails. [Department of Health activity planning](https://www.elderly.gov.hk/english/healthy_ageing/physical_activities/tips_about_planning_physical_activities_programme.html). |
| Twisting/back machines will relieve low back pain; seek care only after a fixed 2–3 days | No diagnosis or clearance from symptoms alone. Stop aggravating movements, seek assessment for concerning/persistent symptoms and immediate help for red flags. [NHS back pain](https://www.nhs.uk/conditions/back-pain/). |
| Shoulder stretching and outdoor machines necessarily improve frozen shoulder | Gentle clinician-directed activities; no strenuous self-designed routine or equipment-specific treatment claim. [NHS frozen shoulder](https://www.nhs.uk/conditions/frozen-shoulder/). |
| Meridian/acupoint explanations cure plantar fasciitis; movement removes inflammatory substances | Removed unsupported mechanisms and treatment claims. Reference guides do not establish personal suitability. [NHS plantar fasciitis](https://www.nhs.uk/conditions/plantar-fasciitis/), [NHS joint pain](https://www.nhs.uk/symptoms/joint-pain/). |
| Named equipment has a universal difficulty order, all stretching/cycling is strength work, or multi-limb machines improve cognition | Removed these claims. Guide categories are educational navigation, not clinical evidence or personalised dosage. |
| App navigation questions are wholly out of scope | Public routes verified in the repository are described, while private records, changes to goals and sharing permissions remain inaccessible to the assistant. |

The source review is an editorial safety correction, not clinical sign-off. Sources were checked on 2026-10-02; future edits should review them again.

## Android keyboard and input

The existing Android `softwareKeyboardLayoutMode: resize` is unchanged. AI chat measures an outer native View against the actual keyboard top and adds only the remaining overlap inside it. If the native window already resized, the JS inset is zero. Frame changes, subsequent layouts and rotation recalculate the overlap; stale asynchronous measurements cannot restore an inset after keyboard dismissal. iOS continues to use only KeyboardAvoidingView.

The multiline composer grows from 48 to 128 layout units and scrolls internally only beyond that cap; clearing a sent draft restores minimum height. Safe-area padding is not added again while the keyboard is visible.

These changes use APIs already present in Build 17 and require no native dependency/configuration change or native rebuild. They can be shipped through the established OTA workflow. A real Build 17 Android smoke test with a Chinese IME remains necessary before release: show/hide keyboard, multiline composing/deleting, send/reply, history return, rotation, gesture/three-button navigation and hardware-keyboard use. No release, OTA export or publication was performed for this change.

## Verification

Targeted tests cover every supplied FAQ question and English counterpart, conservative paraphrase matching, real IDs and current visibility, caregiver text, urgent symptoms, private-data non-echo, authenticated API/rate/image boundaries, historical presentation, resize versus overlay, changing IME height, orientation, stale measurement, iOS isolation and multiline composer growth/reset. Test runner configuration excludes existing generated `tmp`, `workspace-artifacts`, `deploy` and `dist-*` copies. Node tests use `--test-isolation=none` in the restricted Windows environment.

The full backend `assistant*.test.js` set passed 134 tests. Eight targeted frontend suites passed 197 tests; the added red-flag/local-lookup regression brings the covered total to 198, with the changed delivery suite passing all 33 tests. The unrelated `AssistantHistory-test.js` suite has 10 existing failures reproduced against the original HEAD chat implementation (its persisted-row helper expects a write during restore); these are not reported as passing. Android IME layout is unit-tested, not yet verified on a physical Build 17 device.


## App-only reply and presentation correction — 2026-10-06

The v15 FAQ path ran before the existing evidence-based guide path. It returned only general FAQ prose plus identical navigation reasons, and the presentation layer appended that new reason once per card. This caused the repeated “點擊進入設施教學，查看完整說明和注意事項。” text and displaced the former individual explanations. Source links were static FAQ metadata, not internet search results.

The correction removes runtime external references, returns current complete PT/exercise-specialist/OT sections for the FAQ's published guides, and keeps the FAQ's existing cautions in the short reply. The preview includes at most one complete short section; other sections remain in the existing details reader. Empty placeholders and oversized sections are skipped, never cut before a warning. Stored replies are reconstructed without changing stored history or user-written links. Ordinary model greetings and clarifications remain conversational; model replies explicitly naming or linking outside sources are replaced with current APP content. The tools remain limited to read-only APP guides, with no web search. This lexical guard supplements the existing app-only prompts and source checks; it is not a general proof of factual grounding for arbitrary model prose.

Focused local validation: 60 backend cases, including mocked-provider HTTP boundary cases and the exact reported low-back question; 243 frontend cases covering saved history, FAQ display and delivery. An additional real-catalog preview regression confirms the back-strengthening explanation retains its final stop/consult caution. No production deployment or provider call was made for this correction.
