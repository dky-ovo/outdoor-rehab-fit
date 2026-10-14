import { analyzeAssistantLanguage, hasAssistantEmergency, assistantExerciseQuantityQuestion } from "./assistantLanguage.js";
import { assistantAppText, assistantRopeCaution, conflictingRopeInstructions, assistantSymptomSubjectText, ASSISTANT_CONTENT_POLICY } from "./assistantContentPolicy.js";
// Public project knowledge shared by the API and APP. No user data, IO,
// provider credentials, model calls, embeddings or fine-tuning are involved.
// Editorial source: FAQ for AI Chatbot.docx, reviewed 2026-10-02.
// Original medical claims are deliberately not imported verbatim. See
// docs/assistant-faq-review-20261002.md for corrections and source provenance.
export const ASSISTANT_FAQ_POLICY = "app-faq-reviewed-v1";
export const ASSISTANT_FAQ_VERSION = "2026-10-07-v21";
export function assistantFaqEmergency(message, locale = "zh") {
	if (!hasAssistantEmergency(message)) return null;
	return { reply: locale === "en" ? "Stop exercising and seek urgent medical help. These symptoms need immediate assessment, not an equipment recommendation. Call 999 for emergency assistance." : "請停止運動並立即求醫。這些症狀需要即時評估，不宜繼續選擇器材；緊急情況請致電 999。", action: "general", recommendations: [], recommendationsFinal: true, confirmationRequired: false, deepSeekUsed: false };
}
// Editorial source provenance is retained in docs/assistant-faq-review-20261002.md.
// External references are never returned as chat links or fetched at runtime.

const entry = (id, questions, all, zh, en, options = {}) => ({ id, questions, all, answer: { zh, en }, guideIds: [], sources: [], ...options });
const equipmentRequest = /器材|器械|儀器|仪器|設施|设施|器|機|机|單車|单车|掌上壓|掌上压|臂伏撐|臂伏撑|承重|練|练|踩|鍛煉|锻炼|訓練|训练|運動|运动|教學|教学|\b(?:equipment|apparatus|facilities|machines?|exercises?|training|workouts?|guides?|use|using|push[ -]?ups?|weight[ -]?bearing|bike|bicycle|cycle|cycling)\b/i;
const pain = /痛|疼|痠|酸|不適|不适|\b(?:pain|painful|hurts?|hurting|sore|soreness|aches?|aching|discomfort)\b/i;

export const ASSISTANT_FAQ_ENTRIES = [
	entry("neck-injury", ["我最近整親條頸，不過我都係想練下肢，我可以用咩器材鍛煉而唔會影響到患處？", "I recently injured my neck. What equipment can I use to train my legs?"],
		[/頸|颈|\bneck\b/i, /受傷|受伤|整親|整亲|傷患|伤患|\binjur\w*/i, equipmentRequest],
		"頸部剛受傷，請先請醫生或治療師確認可做哪些活動。即使只練雙腿，也可能用到頸部及上身來保持穩定和平衡，不能保證不影響患處。先不要自行選器材或加強訓練。",
		"With a recent neck injury, ask your doctor or physiotherapist which activities you can do first. Even leg exercises may use your neck and upper body for stability and balance. Do not choose equipment or increase training on your own before this assessment.", { medical: true }),
	entry("weak-legs-falls", ["有冇一啲安全啲嘅運動？因為我隻腳冇乜力，容易跌親。", "My legs are weak and I fall easily. Is there safer equipment?"],
		[/腳|脚|腿|\blegs?\b/i, /冇.{0,4}力|無力|无力|弱|\bweak\b/i, /跌|平衡|\b(?:fall|balance|safer)\b/i],
		"腳力較弱、容易跌倒，先請醫護評估，並找人陪同。可以先了解有座位和椅背支撐的下肢關節健身架，也要確認能安全上落座位。\n\n這款健身架有椅背、腳踏幅度較小；健體單車沒有椅背、幅度較大，較需要腳力和軀幹穩定。現場器材款式可能不同，請先看清楚。初期不要獨自用踏級、踏步或漫步機；頭暈、腿軟、疼痛或站不穩時，立即停止。",
		"If your legs feel weak and you are prone to falls, arrange a healthcare assessment and have someone with you. Start by learning about a seated lower-limb joint exerciser with back support, including how to get on and off safely.\n\nThis exerciser has a backrest and a smaller pedalling range. The fitness bike has no backrest and a larger range, needing more leg strength and trunk stability. Check the actual design at the park. Do not initially use steps, steppers or airwalkers alone. Stop for dizziness, weakness, pain or unsteadiness.", { guideIds: ["24"], medical: true, sources: ["balance"] }),
	entry("balance-near-home", ["我想冇咁易跌親，練吓平衡力。我住彩雲邨嘅，請問可以做咩器械", "I live in Choi Wan Estate. What equipment helps me practise balance?"],
		[/彩雲|彩云|屋企附近|住.{1,16}邨|\b(?:choi wan|near my home)\b/i, /平衡|跌|\b(?:balance|fall)\b/i],
		"請先在「尋找設施地點」查看附近位置，再到現場確認有哪些器材。練平衡時，先選能扶穩的設施，慢慢增加難度，並找人陪同。\n\n如果經常跌倒、頭暈或腳無力，先請醫護評估；不要獨自從踏步機等需要較多平衡能力的器材開始。",
		"Open Find Facility Locations to check nearby places, then confirm which equipment is there. For balance practice, start with sturdy support, progress gradually and have a companion nearby.\n\nFrequent falls, dizziness or weak legs need assessment first. Do not start alone with steppers or other moving equipment that demands more balance.", { guideIds: ["12", "11"], sources: ["balance"] }),
	entry("balance-safety", ["醫生叫我要防跌倒啊，啲練平衡力嘅運動會唔會危險？", "My doctor told me to prevent falls. Is balance training dangerous?"],
		[/平衡|防跌|\b(?:balance|falls?)\b/i, /危險|危险|醫生|医生|安全|\b(?:dangerous|safe|doctor|prevent)\b/i],
		"可以練習，但難度要配合您的能力，先按醫生或治療師的建議做。扶穩扶手、穿防滑鞋，選乾爽地面，並找人陪同。站不穩時，不要自行放手或單腳站立。\n\n初期不要獨自嘗試漫步機、踏步機或踏級。動作慢而穩；頭暈、胸口不適、明顯氣促、腿軟、痛楚增加或快失平衡時，立即停止並休息。持續或嚴重不適要求醫。",
		"Balance and strength practice can help prevent falls when it matches your ability. Follow your clinician’s advice, hold sturdy support, wear non-slip shoes, choose a dry surface and have someone nearby. If unsteady, do not let go or try one-leg standing alone.\n\nDo not initially use airwalkers, steppers or steps alone. Move slowly and steadily. Stop and rest for dizziness, chest discomfort, marked breathlessness, weakness, worsening pain or loss of balance. Seek care for persistent or severe symptoms.", { guideIds: ["12", "11", "0"], sources: ["balance"] }),
	entry("weekly-activity", ["一個禮拜做幾多日運動好？一次做幾耐好？", "How many days a week should I exercise and for how long?"],
		[/運動|运动|活動|活动|\b(?:exercise|activity|active|workout)\b/i, /一.{0,3}(?:禮拜|星期|周)|每周|每週|幾多日|几多日|一次.{0,4}(?:幾耐|多久)|\b(?:week|weekly|how often|how long)\b/i],
		"成年人可朝每星期累積 150–300 分鐘中等強度帶氧活動，或 75–150 分鐘高強度活動的目標前進，也可作等量組合。每星期至少 2 天練習主要肌群；長者宜至少 3 天加入結合平衡與肌力的活動。\n\n不用一次做完，短時間活動也算，沒有「每次必須至少 10 分鐘」的要求。由自己做得到的少量開始，逐步增加。伸展或用戶外器材不一定達到帶氧強度；有健康或活動限制，先向醫護詢問適合自己的目標。",
		"Adults can work towards 150–300 minutes of moderate aerobic activity a week, or 75–150 minutes of vigorous activity, or a combination. Include major-muscle strengthening on at least 2 days. Older adults should include balance and strength activities on at least 3 days.\n\nYou can split activity into short periods: there is no minimum 10-minute session requirement. Start with what you can manage and build gradually. Stretching or using an outdoor machine does not always count as aerobic activity. Ask a healthcare professional about a suitable target if you have health or mobility limitations.", { sources: ["who"], exclude: /計劃|计划|方案|目標|目标|\b(?:plan|goal|schedule)\b/i }),
	entry("exercise-weather", ["幾時做運動最啱呀？", "What is the best time of day for outdoor exercise?"],
		[/運動|运动|\bexercise\b/i, /幾時|几时|清晨|傍晚|酷熱|酷热|天氣|天气|\b(?:time of day|weather|hot|morning|evening)\b/i],
		"選天氣較涼、光線足夠、地面安全的時段，先留意天氣警告。酷熱或潮濕時減少戶外活動，必要時改到室內；清晨和傍晚也可能很熱。秋冬或寒冷時要保暖，按天氣和身體狀況調整強度。\n\n適量補水，不能以出汗多少判斷運動強度。頭暈、噁心、異常氣促或不適時，立即停止並到陰涼處；嚴重或持續不適要求醫。",
		"Choose a cooler time with enough light and a safe surface, and check weather warnings. Reduce outdoor activity in heat or humidity; move indoors when needed. Mornings and evenings can still be hot. Keep warm in autumn, winter or cold weather, and adjust intensity to how you feel.\n\nKeep hydrated. Sweat does not reliably show exercise intensity. Stop and move to a cool place for dizziness, nausea, unusual breathlessness or discomfort. Seek help for severe or persistent symptoms.", { sources: ["heat", "safety"] }),
	entry("food-before-exercise", ["做運動前應該隔幾耐食嘢？同埋食啲乜嘢嘢最好？", "How long should I wait after eating before exercise and what should I eat?"],
		[/運動|运动|\bexercise\b/i, /食|餐|肚餓|肚饿|\b(?:eat|eating|meal|food|hungry|lunch|breakfast|dinner|supper)\b/i],
		"剛吃完一頓大餐，先不要急着運動；太肚餓或太飽也不適合。要等多久，視乎吃了多少、運動強度和身體情況，沒有人人適用的固定時間。\n\n按日常需要吃適量食物、補充水分，運動前避免飲酒，並做熱身及緩和。有糖尿病或飲食、藥物上的特別需要，請向醫生或註冊營養師詢問。",
		"Do not rush into exercise just after a large meal, or when very hungry or uncomfortably full. How long to wait depends on the meal size, exercise intensity and how you feel; there is no single waiting time for everyone.\n\nEat amounts that suit your usual needs, keep hydrated, avoid alcohol before exercise, and include a warm-up and cool-down. Ask your doctor or dietitian about diabetes or special dietary and medication needs.", { sources: ["safety"] }),
	entry("personal-goals", ["根據我上個禮拜嘅運動表現，請幫我調整我下個禮拜嘅目標設定。", "Adjust next week's goals using my exercise performance last week."],
		[/目標|目标|\bgoals?\b/i, /上.{0,3}(?:星期|禮拜|周)|記錄|记录|表現|表现|調整|调整|\b(?:last week|record|performance|adjust)\b/i],
		"請先從主頁查看「運動記錄」和「目標設定」。我不能讀取您的個人記錄或代您更改目標；可請熟悉您情況的治療師或教練，一起按上星期的表現調整。請不要在對話中提供密碼或身分證資料。",
		"Open Exercise Records and Goal Setting from Home. I cannot read your private records or change your goals for you. A clinician or trainer who knows your circumstances can help adjust them using last week’s performance. Do not share passwords or identity documents in chat."),
	entry("weekly-leg-plan", ["請幫我制定一個一星期戶外運動的方案，我希望可以提升下肢的力量。", "Make a one-week outdoor exercise plan to improve lower-body strength."],
		[/下肢|腿|腳|脚|\b(?:leg|legs|lower.body)\b/i, /方案|計劃|计划|\b(?:plan|schedule|programme|program)\b/i],
		"先挑一項下肢器材，學會動作和注意事項，再按能力逐步增加。每種器材對肌力、活動度、平衡和心肺的要求不同，不能排成人人適用的難度次序；伸展或踩踏也不一定等於肌力訓練。\n\n要安排一星期的動作和運動量，請讓專業人員按您的健康、能力及恢復情況一起決定。先看示範、做好熱身，不要一下子增加太多。",
		"Start by learning one lower-body activity and its precautions, then progress gradually. Different equipment makes different demands on strength, movement, balance and fitness. There is no difficulty order for everyone; stretching or pedalling is not necessarily strength training.\n\nPlan the week’s activities and amounts with a qualified professional who can consider your health, ability and recovery. Watch the demonstrations and warm up before starting.", { guideIds: ["15", "24", "17", "26", "18"] }),
	entry("back-alternative", ["我想訓練腰部力量，但係我屋企附近公園無扭腰機，有無咩其他器材/動作可以取代?", "There is no twister in my park. What other equipment can I learn about for back strength?"],
		[/腰|背|\b(?:back|waist|twister)\b/i, /取代|替代|無扭腰|冇扭腰|沒有扭腰|\b(?:alternative|other equipment|no twister|replace)\b/i],
		"可以先看「強健背部」的教學，了解姿勢和注意事項。它與扭腰機的作用不同，不能當成完全相同的替代。\n\n如果教學頁有室內示範，也可先看，再按能力及專業建議選擇。附近公園有甚麼器材，仍需到現場確認。",
		"You can start with the Back Strengthening guide and its posture and safety notes. It works differently from a twister, so it is not a direct substitute.\n\nIf the guide includes an indoor demonstration, view that too and choose with advice suited to your ability. Check the park itself to confirm what equipment is available.", { guideIds: ["13"] }),
	entry("calf-stretch-alternative", ["我想拉下小腿嘅肌肉，不過我覺得嗰個小腿伸展唔夠斜，我拉唔到，我仲可以用咩器材，或者點調整動作？", "The calf stretch platform is not steep enough. What other guide can I use?"],
		[/小腿|\bcalf\b/i, /唔夠斜|不夠斜|拉唔到|調整|调整|其他|取代|\b(?:steep|alternative|adjust|other)\b/i],
		"可先看下方另一項下肢伸展的示範，了解不同姿勢。不要自行墊高或改裝器材，也不要為了拉得更緊而勉強加大幅度。\n\n若教學頁有室內示範，也可查看。動作要受控、按能力做；一直找不到合適姿勢或有痛楚，請治療師協助調整。",
		"You can compare the lower-limb stretching demonstration below. Do not raise or modify the equipment, or force a larger movement just to feel more stretch.\n\nCheck any indoor demonstration on the guide page too. Keep the movement controlled and within your ability. Ask a physiotherapist to help if positioning remains difficult or painful.", { guideIds: ["4"] }),
	entry("whole-body-equipment", ["我想要器材可以同時訓練上肢與下肢，你會推薦哪幾個？", "Which equipment involves both upper and lower limbs?"],
		[/上肢.{0,10}下肢|上下肢|\b(?:upper.{0,15}lower|arms.{0,15}legs|whole.body)\b/i, equipmentRequest],
		"可先看太極揉推器、踏步機和強健背部的教學，了解上下肢如何配合。先挑一種學會動作，再慢慢開始。\n\n實際負荷視乎使用方式，不能保證同時練到所有肌群。請按自己的平衡、協調和體能選擇；有不適便停止。",
		"Start by looking at the Tai Chi Wheel, Stepper and Back Strengthening guides to see how the arms and legs work together. Learn one movement at a time and begin gently.\n\nThe load depends on how you use the equipment; it does not necessarily train every muscle group. Choose according to your balance, coordination and fitness, and stop if you feel unwell.", { guideIds: ["0", "21", "13"] }),
	entry("beginner-equipment", ["我係一個新手，我想成身都練，不過我唔識用嗰啲好難，需要技術嘅器材，有啲咩係容易入門嘅器材推薦？", "I am a beginner. Which equipment is easier to learn?"],
		[/新手|入門|入门|唔識|\b(?:beginner|new to|easy|easier)\b/i, equipmentRequest],
		"先挑一種有示範的器材，每次學會一個動作。看清楚注意事項，以慢速、小幅度開始，需要時找人陪同。\n\n固定軌跡不代表人人都適合；扭腰、踏步和健騎仍需要平衡與協調。有疼痛、無力或容易跌倒，先向醫護詢問。",
		"Choose one guide with a demonstration and learn one movement at a time. Read the precautions, start slowly with a small comfortable range, and have someone help if needed.\n\nA fixed movement path does not make equipment suitable for everyone. Twisting, stepping and riding still need balance and coordination. Seek advice first for pain, weakness or falls.", { guideIds: ["0", "8", "9", "21"] }),
	entry("carer-upper-body", ["我是陪同者，我的家人希望鍛煉上肢力量，但是她在戶外運動方面沒有太多經驗，我應該如何幫助她？", "I am a carer. How can I help my inexperienced relative learn upper-body exercise?"],
		[/陪同|照顧|照顾|家人|\b(?:carer|caregiver|relative)\b/i, /上肢|手臂|\b(?:upper.body|arm)\b/i],
		"先陪家人一起看示範和「給陪同者的提示」，每次熟習一種動作。檢查地面和器材，讓她自己控制速度及幅度；您在旁協助，不要替她拉動手臂或強行加大幅度。\n\n有傷患、活動受限或站不穩，先請醫護評估。用輪椅器材時，開始前先鎖定輪椅。出現痛楚便停止，不要催她完成次數。",
		"Watch the demonstration and Tips for Exercise Companions together, learning one movement at a time. Check the surface and equipment. Let your relative control the speed and range while you help nearby; do not pull her arm or force a larger movement.\n\nSeek assessment first for injury, limited movement or unsteadiness. Lock a wheelchair before using wheelchair equipment. Stop a painful movement rather than asking her to finish the repetitions.", { guideCategory: "upper", careTips: true }),
	entry("frozen-shoulder", ["我有肩周炎，有什麼戶外儀器可以幫助我？", "I have frozen shoulder. Which outdoor equipment guides are relevant?"],
		[/肩周炎|五十肩|冷凍肩|冷冻肩|\bfrozen.shoulder\b/i, equipmentRequest, /幫助|帮助|改善|教學|教学|\b(?:help|improve|guides?|relevant)\b/i],
		"肩周炎要按痛楚和恢復階段安排活動。先按醫生或治療師教的方法溫和活動，不要自行強拉或做劇烈練習。\n\n可先了解下方肩部教學，但不要忍痛照做。痛楚或僵硬持續、手臂很難活動時，先請醫護評估。",
		"With frozen shoulder, activity needs to match your pain and stage of recovery. Follow gentle movements taught by your doctor or physiotherapist; do not force a stretch or start strenuous exercise on your own.\n\nYou can learn about the shoulder guides below, but do not work through pain. Seek assessment for persistent pain or stiffness, or difficulty moving the arm.", { guideIds: ["5", "19", "20", "23", "0"], medical: true, sources: ["shoulder"] }),
	entry("knee-cautions", ["我有膝蓋痛，有什麼戶外儀器要避免/小心使用？", "I have knee pain. What equipment should I avoid or use with caution?"],
		[/膝|\bknee\b/i, pain, /避免|小心|注意|\b(?:avoid|caution|careful)\b/i],
		"先避免會加劇膝痛的動作，慢速、受控，在不痛的幅度內活動。留意：\n• 太極推手半蹲時痛，可減少屈膝或不做半蹲。半前蹲調整後仍痛，就暫停。\n• 扭腰機轉板會增加膝部負荷，不要快速扭轉。\n• 踏級及踏步要反覆屈膝承重，膝頭與腳尖保持同向，站不穩便停止。\n• 單車按現場設計調整座高，避免勉強屈膝。\n\n不是每個人都要禁用這些器材；持續、反覆或加劇的膝痛，先請醫護評估。",
		"Avoid movements that worsen knee pain. Move slowly, with control, within a pain-free range.\n• If a Tai Chi wheel’s partial squat hurts, bend less or omit the squat. Pause a partial lunge if it still hurts after adjustment.\n• A twister’s rotating platform loads the knees: avoid fast twisting.\n• Steps and steppers repeatedly bend and load the knees. Keep knees aligned with toes; stop if unsteady.\n• Adjust the bike seat height where possible to avoid forcing knee bending.\n\nThese are not a ban on every machine for everyone. Seek assessment for persistent, recurring or worsening knee pain.", { guideIds: ["0", "8", "11", "15", "21", "17"], medical: true, sources: ["joint"], guideCautions: {
			"0": { zh: "半蹲若令膝痛，可減少屈膝幅度或避免半蹲；膝頭與腳尖保持同向，痛楚增加便停止。", en: "If the partial squat hurts your knee, reduce knee bending or omit it. Keep the knee aligned with the toes and stop if pain increases." },
			"8": { zh: "轉板會涉及膝部負荷，不要快速扭轉；保持慢速、受控及不痛的幅度。", en: "The rotating platform loads the knees. Avoid fast twisting and keep a slow, controlled, pain-free range." },
			"11": { zh: "調整半前蹲後若仍有膝痛，暫停該動作；膝頭與腳尖保持同向，不要勉強屈膝。", en: "Pause the partial lunge if your knee still hurts after adjustment. Keep the knee aligned with the toes; do not force bending." },
			"15": { zh: "踏級需要反覆屈膝承重，注意膝頭與腳尖同向；痛楚增加或不穩便停止。", en: "Stepping repeatedly bends and loads the knees. Keep knees aligned with the toes; stop for increasing pain or unsteadiness." },
			"21": { zh: "踏步需要反覆屈膝承重，注意姿勢與控制；痛楚增加或不穩便停止。", en: "Stepper movements repeatedly bend and load the knees. Pay attention to posture and control; stop for increasing pain or unsteadiness." },
			"17": { zh: "按現場單車設計選擇合適座高，以調整屈膝幅度；不要勉強完成會加劇膝痛的活動。", en: "Where the bike design permits, choose an appropriate seat height to adjust knee bending. Do not force activity that worsens knee pain." }
		} }),
	entry("knee-mobility", ["我有膝蓋痛，有什麼儀器可以幫助我改善問題", "I have knee pain. Can any equipment improve it?"],
		[/膝|\bknee\b/i, pain, equipmentRequest, /幫助|帮助|改善|\b(?:help|improve)\b/i],
		"膝痛時，先不要強行伸展或做會加劇疼痛的動作。下方可查看下肢活動的示範，但要按自己的情況選擇，不能保證器材會改善膝痛。\n\n痛楚持續、反覆或加劇，先請醫護評估，再決定適合做哪些活動。",
		"With knee pain, do not force stretching or movements that make it worse. The lower-limb guides below show activities to learn about, but equipment cannot be guaranteed to improve the pain.\n\nHave persistent, recurring or worsening pain assessed before deciding which activities suit you.", { guideIds: ["4", "10", "16", "25", "26", "24"], medical: true, sources: ["joint"], guideCautions: Object.fromEntries(["4", "10", "16", "25", "26", "24"].map(id => [id, {
			zh: "這是下肢活動及伸展的教學參考，不能確認能改善您的膝痛；不要強行拉伸或做會加劇膝痛的動作，持續或加劇的痛楚應先評估。",
			en: "This lower-limb activity or stretching guide does not establish that it will improve your knee pain. Do not force stretching or movements that worsen pain; persistent or worsening pain needs assessment first."
		}])) }),
	entry("plantar-fasciitis", ["我有足底筋膜炎，有什麼儀器可以幫助我改善問題？", "I have plantar fasciitis. Which equipment guides are relevant?"],
		[/足底筋膜炎|\bplantar.fasciitis\b/i, equipmentRequest],
		"足底筋膜炎的負重和伸展要按您的情況調整。可以先了解小腿及下肢伸展的示範，不要勉強拉伸，也不要站到痛楚加劇。\n\n足痛嚴重、持續或反覆，或伴隨麻痺，請先向醫護詢問，再選活動。",
		"With plantar fasciitis, loading and stretching need to suit your condition. You can learn about the calf and lower-limb stretches below, but do not force a stretch or keep standing as pain increases.\n\nSeek healthcare advice for severe, persistent or recurring foot pain, or tingling or loss of feeling, before choosing activities.", { guideIds: ["10", "4", "16"], medical: true, sources: ["foot"] }),
	entry("back-twister-pain", ["我條腰彎曲嘅時候有少少痛，請問應唔應該做扭腰機？", "My lower back hurts when bending. Should I use the twister?"],
		[/腰|背|\bback\b/i, pain, /扭腰|\btwister\b/i],
		"彎腰時會痛，先不要急着用扭腰機，請醫生或治療師評估是否適合。若獲准使用，扶穩、慢慢轉動，在不加劇痛楚的幅度內活動；有不適便停止。\n\n安排休息，避免腰部過度疲勞；對平衡沒有信心時，找人陪同。突然劇痛、雙腿麻痺無力或大小便功能改變，要立即求醫。",
		"If bending hurts your back, do not rush to use a twister. Ask your doctor or physiotherapist whether it is suitable. If cleared, hold support and turn slowly within a range that does not worsen pain. Stop if uncomfortable.\n\nTake rest breaks to avoid back fatigue and have a companion nearby if unsure of your balance. Sudden severe pain, weakness or numbness in both legs, or bladder or bowel changes need immediate medical help.", { guideIds: ["8"], medical: true, sources: ["back"] }),
	entry("back-pain", ["我有下腰背痛問題，有什麼儀器可以幫助我改善問題？有什麼戶外儀器要避免？", "I have lower back pain. Which equipment should I read about or avoid?"],
		[/腰|背|\bback\b/i, pain, equipmentRequest],
		"腰背痛時，先避開會令痛楚增加的動作。可先看強健背部、腰背按摩和背部伸展的教學；三位壓腿、腿腱伸展及扭腰機也要按個人情況選擇，不要當成治療腰痛的方法。\n\n特別留意：健騎機反覆推拉時若腰痛，停止並先問醫護；站立式臂伏撐若令您無法保持穩定而拱腰，避免該動作並先評估。按摩、扭轉或伸展時都要慢而受控，不能忍痛。\n\n嚴重、持續或加劇的痛楚要求醫；伴隨雙腿麻痺無力或大小便功能改變，要立即求醫。",
		"With back pain, first avoid movements that make it worse. You can look at the Back Strengthening, Back Massage and Back Stretch guides. Leg stretches, hamstring stretches and a twister also need to suit your circumstances; do not treat equipment as a remedy for back pain.\n\nStop and seek advice if the rider’s repeated pushing and pulling causes back pain. Avoid standing push-ups and seek assessment if you cannot stay stable and arch your back. Keep massage, twisting and stretching slow and controlled; do not work through pain.\n\nSevere, persistent or worsening pain needs care. Weakness or numbness in both legs, or bladder or bowel changes need immediate medical help.", { guideIds: ["13", "22", "6", "25", "16", "8", "9", "14"], medical: true, sources: ["back"], guideCautions: {
			"9": { zh: "健騎機反覆推拉時若出現腰痛，停止並先諮詢醫護，再決定如何使用或是否暫停。", en: "Stop and seek healthcare advice if repeated pushing and pulling on the rider causes back pain, before deciding how or whether to continue." },
			"14": { zh: "站立式臂伏撐需要控制軀幹；若腰痛時無法保持穩定而拱腰，應避免該動作並先評估。", en: "Standing push-ups require trunk control; avoid the movement and seek assessment if back pain prevents stability and you arch your back." },
		} }),
	entry("wrist-pain", ["我有手腕痛，有什麼儀器可以幫助我改善問題？有什麼要注意。", "I have wrist pain. What equipment precautions should I know?"],
		[/手腕|\bwrist\b/i, pain, equipmentRequest],
		"手腕痛時，避免會加劇疼痛的抓握、扭轉、過度屈曲，或用手腕支撐體重。站式掌上壓和站立式臂伏撐需要手腕承重，先不要做，請醫護評估。\n\n可先了解肩關節伸展、上肢關節健身架、手部鍛鍊器或太極推手等活動方式；握手柄不要過度用力，也不要忍痛。若想用上肢伸展器，先請場地人員或治療師示範正確拉法，不要自行拉。嚴重或持續痛楚，先求醫。",
		"With wrist pain, avoid gripping, twisting, excessive bending or supporting body weight through the wrist when these hurt. Avoid push-ups and standing push-ups while the wrist is painful, and seek assessment first.\n\nYou can learn about shoulder stretches, the upper-limb joint exerciser, hand exerciser or Tai Chi movements. Do not grip hard or work through pain. Before using the pull-down, ask venue staff or a physiotherapist to demonstrate the correct technique; do not pull on your own. Seek care for severe or persistent pain.", { guideIds: ["20", "19", "23", "27", "0", "7", "14"], medical: true, sources: ["joint"], guideReferenceOnly: true, guideCautions: {
			"7": { zh: "站式掌上壓需要手腕支撐體重；手腕痛時應避免，先請醫護評估。", en: "Push-ups support body weight through the wrists; avoid them while the wrist is painful and seek assessment first." },
			"14": { zh: "站立式臂伏撐需要手腕承重；手腕痛時應避免，先請醫護評估。", en: "Standing push-ups load the wrists; avoid them while the wrist is painful and seek assessment first." },
		} }),
	entry("elbow-pain", ["我有手肘痛，有什麼儀器可以幫助我改善問題？有什麼要注意。", "I have elbow pain. What equipment can help and what should I watch for?"],
		[/手肘|肘|\belbow\b/i, pain, equipmentRequest],
		"手肘痛時，先避免強力抓握、反覆扭轉，以及拉起或推動身體重量。請醫護評估，再決定適合的活動。\n\n如果獲准做溫和上肢活動，可先看下方示範，按專業建議調整；痛楚增加就停止。若想用拉繩器，先請場地人員或治療師示範，不要自行拉。",
		"With elbow pain, avoid forceful gripping, repeated twisting and pulling or pushing your body weight. Seek assessment before choosing activities.\n\nIf cleared for gentle upper-limb activity, view the guides below and follow advice suited to you. Stop if pain increases. Before using a rope-pulling machine, ask venue staff or a physiotherapist to demonstrate it; do not pull on your own.", { guideIds: ["20", "23"], medical: true, sources: ["joint"] }),
	entry("knee-twister-cautions", ["我有膝痛，使用扭腰機要注意甚麼？", "I have knee pain. What should I watch for when using a twister?"], [],
		"膝痛時用扭腰機，要小心轉板對膝部的負荷。不要快速扭轉；慢慢做，保持受控及不加劇痛楚的幅度。膝痛增加或站不穩，立即停止。\n\n持續、反覆或加劇的膝痛，先請醫護評估是否適合使用。",
		"With knee pain, take care: a twister’s rotating platform loads the knees. Do not twist quickly. Move slowly with control, in a range that does not worsen pain. Stop immediately if knee pain increases or you feel unsteady.\n\nSeek assessment for persistent, recurring or worsening pain before deciding whether to use it.",
		{ medical: true, guideIds: ["8"], guideCautions: { "8": { zh: "扭腰機的轉板會涉及膝部負荷。慢速、受控；膝痛加劇或站不穩便停止，先請醫護評估。", en: "The twister's rotating platform loads the knees. Move slowly with control; stop for increasing knee pain or unsteadiness and seek assessment." } } }),
	entry("knee-back-twister", ["我的膝蓋和腰都痛，可以使用扭腰機嗎？", "My knees and back hurt. Can I use a twister?"], [],
		"膝蓋和腰都痛，先不要急着用扭腰機，請醫護評估。轉板會涉及膝部負荷，扭動也可能令腰部不適。\n\n若獲准使用，扶穩、慢慢做，不要強扭或忍痛。腰或膝任何一處痛楚增加、站不穩或出現麻痺無力，都應停止並求醫。",
		"If both your knees and back hurt, do not rush to use a twister; seek assessment first. Its rotating platform loads the knees, and twisting may cause back discomfort.\n\nIf cleared, hold support and move slowly. Do not force the turn or work through pain. Stop and seek help if pain in either area increases, you feel unsteady, or numbness or weakness appears.",
		{ medical: true, guideIds: ["8"], guideCautions: { "8": { zh: "轉板涉及膝部負荷；腰或膝痛時先評估，不要快速或強行扭動。痛楚增加立即停止。", en: "The rotating platform loads the knees. Seek assessment for knee or back pain; do not twist quickly or force the movement. Stop if pain increases." } } }),
	entry("wrist-support", ["我有手腕痛，可以做站立式臂伏撐嗎？", "My wrist hurts. Should I do standing push-ups?"], [],
		"手腕痛時，先不要做站式掌上壓或站立式臂伏撐，這些動作需要手腕承重。請先讓醫護評估。\n\n也不要忍痛抓握、扭轉或過度屈曲手腕。痛楚嚴重、持續或加劇時，請求醫。",
		"Avoid push-ups and standing push-ups while your wrist is painful: they put body weight through the wrists. Have the pain assessed first.\n\nDo not force a painful grip, twist or excessive wrist bend. Seek care for severe, persistent or worsening pain.",
		{ medical: true, guideIds: ["7", "14"], guideCautions: {
			"7": { zh: "站式掌上壓需要手腕支撐體重；手腕痛時應避免，先請醫護評估。", en: "Push-ups support body weight through the wrists; avoid them while the wrist is painful and seek assessment first." },
			"14": { zh: "站立式臂伏撐需要手腕承重；手腕痛時應避免，先請醫護評估。", en: "Standing push-ups load the wrists; avoid them while the wrist is painful and seek assessment first." }
		} }),
	entry("rope-use", ["拉繩器應如何使用，每次應拉多少次？", "How should I use the rope-pulling machine, and how many repetitions should I do?"], [],
		"您說的是「上肢伸展器」這款拉繩器嗎？先對照器材圖片，確認是同一款。\n\n先不要自行拉，請場地人員或治療師示範正確方法。先確認動作，再按個人能力和專業建議安排次數、組數、時間及阻力，沒有人人適用的固定數字。不要勉強加量或忍痛完成。",
		"Do you mean the Upper Body Stretch / Pull Down shown below? Compare its picture with the equipment you mean.\n\nDo not pull on your own yet. Ask venue staff or a physiotherapist to demonstrate the correct technique first. Once the movement is clear, choose repetitions according to your ability and professional advice, including how many sets, how long and what resistance to use. There is no fixed amount for everyone. Do not force extra effort or work through pain.",
		{ guideIds: ["20"], careTips: true }),
	entry("carer-pain-followup", ["我陪母親練習上肢，拉動時她覺得痛，我該怎麼辦？", "I am helping my mother exercise her upper limbs. She feels pain while pulling. What should I do?"], [],
		"她拉動時覺得痛，就先停止這個動作。不要催她完成次數，也不要替她拉手臂或加大幅度。\n\n陪她休息；痛楚持續、反覆或加劇，先請醫護評估，再決定怎樣調整。若同時胸痛或明顯呼吸困難，立即尋求醫護協助。",
		"If pulling hurts, stop that movement. Do not ask her to finish the repetitions, pull her arm for her or increase the range.\n\nStay with her while she rests. Persistent, recurring or worsening pain needs assessment before deciding how to adapt the activity. Seek urgent medical help for chest pain or marked difficulty breathing.", { medical: true }),

	entry("app-videos", ["啲示範影片喺邊度搵㗎？", "Where can I find the demonstration videos?"],
		[/影片|視頻|视频|\bvideos?\b/i, /邊度|边度|哪|搵|找|\b(?:where|find)\b/i],
		"在主頁開啟「設施教學」，選擇器材，就可查看該頁的影片和使用說明。不同器材和語言可能有不同影片；沒有影片時，可先看文字教學。告訴我器材名稱，我可以幫您找。",
		"Open Facility Guide from Home and choose the equipment to see its videos and instructions. Videos may differ by equipment and language. If there is no video, use the written guide. Tell me the equipment name and I can help find it."),
	entry("app-records", ["我個運動記錄喺邊度㗎？點樣send俾人睇㗎？", "Where are my exercise records and how can I share them?"],
		[/運動記錄|运动记录|\bexercise records?\b/i, /邊度|边度|哪|搵|分享|send|\b(?:where|find|share|send)\b/i],
		"從主頁開啟「運動記錄」，就可查看自己的記錄。若想傳給別人，請在「設定」→「聯絡我們」向技術支援詢問您這個版本的分享步驟；我無法確認分享功能，也不能代您傳送。\n\n分享前先確認接收對象及會公開的資料，不要把密碼交給別人。",
		"Open Exercise Records from Home to see your records. To send them to someone, ask technical support through Settings → Contact Us about the steps for your version. I cannot confirm the sharing options or send records for you.\n\nCheck who will receive them and what information will be visible. Never share your password."),
	entry("app-features", ["App 有咩功能？", "What features does this app have?"],
		[/app|程式|應用|应用/i, /功能|頁面|页面|選單|选单|\b(?:features|menus|pages)\b/i],
		"主頁可開啟運動記錄、目標進度與設定、倒數計時器、設施教學、尋找設施地點和 AI 助手。「收藏」可找回已收藏器材；「其他」有風險管理、研究、體能活動建議及使用數據；「設定」可查看個人資料、切換語言及聯絡我們。部分功能視帳戶權限而定。\n\n您可以問我器材用法、運動注意事項或怎樣找教學。我不能代您操作頁面、讀取私人資料或提供個人診斷。",
		"Home has Exercise Records, goal progress and settings, a timer, Facility Guide, facility locations and AI Assistant. Favorites holds saved equipment. Other includes risk management, research, activity advice and usage data. Settings has your profile, language and Contact Us. Some features depend on account permissions.\n\nAsk me about equipment use, exercise precautions or finding a guide. I cannot operate pages for you, read private data or provide a personal diagnosis."),
	entry("scope-health", ["做完運動後第二日，嗰手臂仲係有啲㾓，係咪正常㗎？", "我有高血壓，係咪唔做得太劇烈嘅運動啊？", "運動嗰陣點樣呼吸先啱呀？我好似好容易就chur晒大氣咁。", "我做完一個設施之後，應該休息幾耐先可以做下一個？", "Is arm soreness the day after exercise normal?", "Can I do intense exercise with high blood pressure?", "How should I breathe during exercise?", "How long should I rest between machines?"],
		[/高血壓|高血压|呼吸.{0,8}(?:點|怎|方法)|休息.{0,8}(?:幾耐|多久)|第二日|\b(?:high blood pressure|hypertension|breathe|breathing technique|rest between|sore.{0,20}(?:next|after)|soreness)\b/i],
		"先按身體狀況調整運動，不要忍痛或勉強撐下去。運動後不適是否正常、血壓適合的強度和休息多久，都要按個人情況判斷，請向醫生或治療師詢問。\n\n持續或加劇的痛楚、麻痺、無力或明顯頭暈，應停止運動並求醫；胸痛或嚴重呼吸困難，立即致電 999 求助。",
		"Adjust activity to how you feel; do not push through pain or marked discomfort. Whether symptoms after exercise are normal, what intensity suits your blood pressure and how long to rest depend on your circumstances. Ask your doctor or physiotherapist.\n\nStop and seek care for persistent or worsening pain, numbness, weakness or marked dizziness. Call 999 for chest pain or severe breathing difficulty."),
];

// Vocabulary normalization only; medical answers retain the reviewed wording.
// This is deliberately not an edit-distance match: one different body part or
// a negated diagnosis must not retrieve a superficially similar medical FAQ.
const EQUIVALENTS = {
	运动: "運動", 训练: "訓練", 锻炼: "鍛煉", 儀器: "器材", 仪器: "器材", 设备: "器材", 器械: "器材", 设施: "設施",
	记录: "記錄", 紀錄: "記錄", 视频: "影片", 視頻: "影片", 示范: "示範", 教学: "教學", 户外: "戶外", 软件: "app",
	膝盖: "膝蓋", 膝頭哥: "膝蓋", 膝头哥: "膝蓋", 颈: "頸", 脚: "腳", 伤: "傷", 腿軟: "腿無力", 腿软: "腿無力",
	酸痛: "疼痛", 痠痛: "疼痛", 腰骨: "腰背", 周身: "全身", 成身: "全身", 小腿肚: "小腿", 拉筋: "伸展",
	一周: "一星期", 每周: "每星期", 每週: "每星期", 每礼拜: "每星期", 每禮拜: "每星期", 週: "周",
	几: "幾", 哪些: "哪些", 什么: "什麼", 怎么: "怎麼", 哪里: "哪裡", 点样: "點樣", 咩: "什麼", 點樣: "怎麼",
	边度: "邊度", 搵: "找", 唔识: "唔識", 初學: "新手", 初学: "新手", 入门: "入門", 未玩過: "新手",
	上臂: "手臂", 母親: "媽媽", 阿媽: "媽媽", 阿妈: "媽媽", 妈妈: "媽媽", 幫手: "幫", 双: "雙", 两: "兩", 缺乏: "缺乏", 冇乜力: "無力", 沒力: "無力", 没力: "無力",
	摔倒: "跌倒", 跌親: "跌倒", 跌亲: "跌倒", 照顾: "照顧", 家属: "家人", 家屬: "家人",
	没有: "沒有", 沒有: "沒有", 并非: "並非", 并无: "並無", 无: "無", 不是: "不是", 唔係: "不是",
	計畫: "計劃", 计划: "計劃", 方案: "計劃", 推荐: "推薦", 帮助: "幫助", 帮: "幫", 改善: "改善", 缓解: "緩解",
	舒缓: "舒緩", 纾缓: "舒緩", 紓緩: "舒緩", 避开: "避免", 避開: "避免", 谨慎: "小心", 留神: "小心",
	危险: "危險", 安全: "安全", 太熱: "酷熱", 太热: "酷熱", 天气: "天氣", 吃饭: "食飯", 食嘢: "食物",
	飯後: "餐後", 饭后: "餐後", 目标: "目標", 调整: "調整", 表现: "表現", 进度: "進度",
};
function normalized(value) {
	let text = String(value || "").normalize("NFKC").toLowerCase().trim().slice(0, 600).replace(/[’‘]/g, "'");
	for (const [from, to] of Object.entries(EQUIVALENTS)) text = text.replaceAll(from, to);
	return text.replace(/\bwork(?:ing)?[ -]?out\b/g, "exercise").replace(/\bgym (?:kit|apparatus)\b/g, "equipment")
		.replace(/\b(?:waist[ -]twisting|waist[ -]rotation) (?:machine|equipment)\b/g, "twister");
}
const compact = text => normalized(text).replace(/[^\p{L}\p{N}]/gu, "");

const PARTS = {
	neck: /頸|\bneck\b/i, knee: /膝|\bknees?\b/i, shoulder: /肩|\bshoulders?\b/i,
	foot: /足底|腳底|腳跟|\b(?:plantar|feet|foot|heels?)\b/i, back: /腰|背|\b(?:back|waist)\b/i,
	wrist: /腕|\bwrists?\b/i, elbow: /肘|\belbows?\b/i,
};
const MEDICAL_TARGET = { "neck-injury": "neck", "frozen-shoulder": "shoulder", "knee-cautions": "knee", "knee-mobility": "knee", "plantar-fasciitis": "foot", "back-twister-pain": "back", "back-pain": "back", "wrist-pain": "wrist", "elbow-pain": "elbow" };
function affirmativeMedicalText(text) { return analyzeAssistantLanguage(text).affirmativeText; }
function medicalParts(text) { return new Set(analyzeAssistantLanguage(text).targets); }
const HELP = /幫|改善|舒緩|緩解|教學|參考|了解|介紹|睇|看|\b(?:show|read|learn|reference|helps?|helpful|improv\w*|reliev\w*|guides?|relevant|ease)\b/i;
const CAUTION = /避免|小心|注意|唔好|不要|不應|不能|\b(?:avoid|cautions?|careful|precautions?|stay away|shouldn't|must not)\b/i;
const ACTIVITY = /運動|活動|\b(?:exercises?|exercising|activity|active|workouts?)\b/i;
const CARER = /陪|照顧|家人|媽媽|母親|阿媽|爸爸|父親|父母|\b(?:carer|caregiver|relatives?|mother|mum|mom|father|dad|parents?|family member|accompanying|accompany|helping my)\b/i;
const UPPER_LIMB = /上肢|手臂|\b(?:upper[ -](?:body|limbs?)|arms?)\b/i;
const TWISTER = /扭腰|\btwister\b/i;
const SUPPORTING_HANDS = /掌上壓|掌上压|臂伏撐|臂伏撑|手.{0,8}(?:承重|支撐|支撑|撐|撑)|\b(?:push[ -]?ups?|weight.{0,25}(?:hands?|wrists?)|support.{0,20}(?:hands?|wrists?))\b/i;
const ROPE = /拉[繩绳](?:器|機|机)|上肢伸展器|\b(?:rope[ -]?(?:pull(?:ing)?|machine|exerciser)|pull[ -]?down(?: machine)?)\b/i;
const ROPE_OTHER_TOPIC = /購買|购买|買|买|售價|售价|價錢|价钱|幾多錢|多少钱|維修|维修|送貨|送货|喺邊|邊度|哪裡|哪里|\b(?:buy|purchase|price|cost|repair|delivery|where)\b/i;
const ROPE_INSTRUCTIONS = /怎|如何|點(?:樣|用|玩)|用法|玩法|操作|方法|教學|示範|注意|\b(?:use|using|instructions?|technique|precautions?|cautions?|demonstrat\w*)\b/i;
function affirmativeRopeMention(text) {
	return [...text.matchAll(new RegExp(ROPE.source, "gi"))].some(match => {
		const before = text.slice(Math.max(0, match.index - 60), match.index);
		const after = text.slice(match.index + match[0].length);
		return !/(?:不是|不想|唔想|不要|唔要|不用|別用|别用|除咗|除了)(?:用|玩|使用)?\s*$|\b(?:not|no|do not want|don't want|instead of|other than)(?:\s+(?:to use|to try|use|try|the|a))*\s*$/i.test(before)
			&& !/^\s*(?:不是|不想|唔想|不要|唔要|不用)/i.test(after);
	});
}
// Inherit only an elided quantity question. A new equipment name, location,
// symptom, medicine or unrelated subject cannot be consumed as a continuation.
function ropeQuantityContinuation(text) {
	if (text.length > 160 || !assistantExerciseQuantityQuestion(text)) return false;
	const remaining = text
		.replace(/\b(?:and|then|so|please|how|many|much|long|what|which|number|of|reps?|repetitions?|sets?|minutes?|seconds?|weight|resistance|load|level|kilograms?|kgs?|pounds?|lbs?|should|would|could|can|do|does|i|we|me|my|it|this|that|be|is|are|per|each|session|time|in|on|for|the|a|an|enough|too|few|much|many|okay|ok|safe|use|pull|hold|stretch|set|select|choose|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b/gi, "")
		.replace(/(?:咁|那麼|那么|然後|然后|請問|请问|請|请|一次|每次|一組|一组|每組|每组|總共|总共|應該|应该|要|可以|應|应|拉|做|用|調|调|設|设|幾多|多少|幾|几|多久|耐|阻力|負重|负重|重量|公斤|千克|磅|分鐘|分钟|秒|次數|次数|下|次|組|组|先夠|先够|夠唔夠|够不够|得唔得|夠|够|太多|太少|呢|呀|啊|嗎|吗|一|二|三|四|五|六|七|八|九|十|百|兩|两)/g, "")
		.replace(/[\d\s.,，。?？!！:：;；–—-]/g, "");
	return remaining.length === 0;
}
function recentRopeQuantityContext(text, history) {
	if (!ropeQuantityContinuation(text) || analyzeAssistantLanguage(text).hasSymptom) return false;
	for (const row of (Array.isArray(history) ? history : []).slice(-8).reverse()) {
		if (row?.role !== "user" || typeof row.content !== "string") continue;
		const prior = normalized(row.content), language = analyzeAssistantLanguage(prior);
		if (language.hasSymptom || language.urgent || ROPE_OTHER_TOPIC.test(prior)) return false;
		if (affirmativeRopeMention(prior)) return true;
		if (!ropeQuantityContinuation(prior)) return false;
	}
	return false;
}
// Conditions come only from affirmative assertions. Request words remain in
// the original question so “which movements should I avoid?” still works,
// without reintroducing a diagnosis that the user explicitly denied.
const MEDICAL_RULES = {
	"neck-injury": { facts: [PARTS.neck, /受傷|傷了|傷咗|整親|整亲|扭傷|拉傷|傷患|\b(?:injur\w*|strain\w*|sprain\w*)\b/i], request: [/踩腳|踩脚|單車|单车|練|练|踩|器材|器械|機|机|運動|鍛煉|訓練|\b(?:equipment|machines?|exercise|train|training|pedal\w*)\b/i] },
	"frozen-shoulder": { facts: [/肩周炎|五十肩|冷凍肩|冷冻肩|\bfrozen[ -]shoulder\b/i], request: [equipmentRequest] },
	"knee-cautions": { facts: [PARTS.knee, pain], request: [CAUTION] },
	"knee-mobility": { facts: [PARTS.knee, pain], request: [equipmentRequest, HELP] },
	"plantar-fasciitis": { facts: [/足底筋膜炎|\bplantar[ -]fasciitis\b/i], request: [equipmentRequest] },
	"back-twister-pain": { facts: [PARTS.back, pain], request: [TWISTER] },
	"back-pain": { facts: [PARTS.back, pain], request: [equipmentRequest] },
	"wrist-pain": { facts: [PARTS.wrist, pain], request: [equipmentRequest] },
	"elbow-pain": { facts: [PARTS.elbow, pain], request: [equipmentRequest] },
};
const RULES = {
	"weak-legs-falls": [/腳|腿|\blegs?\b/i, /冇.{0,4}力|無力|弱|\b(?:weak|weakness|give way)\b/i, /跌|平衡|\b(?:falls?|falling|balance|safer)\b/i],
	"balance-near-home": [/彩雲|彩云|屋企附近|我住|住.{1,16}邨|\b(?:choi wan|near my home|my neighbourhood|my neighborhood|i live)\b/i, /平衡|跌|\b(?:balance|falls?|falling)\b/i],
	"balance-safety": [/平衡|防跌|\b(?:balance|falls?|falling)\b/i, /危險|醫生|医生|安全|\b(?:dangerous|safe|safety|doctor|prevent|prevention)\b/i],
	"weekly-activity": [ACTIVITY, /一.{0,3}(?:禮拜|星期|周)|每星期|幾多日|幾天|幾耐|多久|多長|\b(?:week|weekly|how often|how long|how much|how many (?:days|minutes))\b/i],
	"exercise-weather": [ACTIVITY, /幾時|清晨|傍晚|酷熱|天氣|早上|晚上|朝早|夜晚|夏天|冬天|\b(?:time of day|weather|hot|morning|evening|summer|winter|when is (?:a|the) (?:good|best) time)\b/i],
	"food-before-exercise": [ACTIVITY, /食|餐|肚餓|吃|\b(?:eat|eating|eaten|meal|food|hungry|lunch|breakfast|dinner|supper)\b/i],
	"personal-goals": [/目標|\bgoals?\b/i, /上.{0,3}(?:星期|禮拜|周)|記錄|表現|調整|進度|\b(?:last week|records?|performance|adjust|progress)\b/i],
	"weekly-leg-plan": [/下肢|腿|腳|\b(?:legs?|lower[ -](?:body|limbs?))\b/i, /計劃|\b(?:plan|schedule|programme|program)\b/i],
	"back-alternative": [PARTS.back, /取代|替代|代替|無扭腰|冇扭腰|沒有扭腰|\b(?:alternative|other equipment|no twister|replace|instead)\b/i],
	"calf-stretch-alternative": [/小腿|\b(?:calf|calves)\b/i, /唔夠斜|不夠斜|拉唔到|調整|其他|取代|替代|\b(?:steep|alternative|adjust|other|instead)\b/i],
	"whole-body-equipment": [/上肢.{0,12}下肢|上下肢|手.{0,8}腳|全身|\b(?:upper.{0,20}lower|arms.{0,20}legs|whole[ -]body|full[ -]body)\b/i, equipmentRequest],
	"beginner-equipment": [/新手|入門|唔識|\b(?:beginner|new to|easy|easier|first time)\b/i, equipmentRequest],
	"carer-upper-body": [CARER, UPPER_LIMB, /練|鍛煉|訓練|幫|協助|使用|注意|\b(?:train\w*|exercis\w*|strength\w*|help\w*|watch|assist\w*|use|using)\b/i],
	"app-videos": [/影片|\bvideos?|demonstrations?\b/i, /邊度|哪|找|睇|看|打開|\b(?:where|find|watch|open|access)\b/i],
	"app-records": [/運動記錄|鍛煉記錄|\b(?:exercise|workout|activity) (?:records?|logs?|history)\b/i, /邊度|哪|找|睇|看|分享|send|\b(?:where|find|share|send|view|see|access)\b/i],
	"app-features": [/app|程式|應用|应用|助手|\bassistant\b/i, /功能|頁面|页面|選單|选单|可以做什麼|能做什麼|\b(?:features|menus|pages|what can.{0,25}(?:do|help))\b/i],
	"scope-health": [/高血壓|高血压|呼吸.{0,8}(?:點|怎|方法)|休息.{0,8}(?:幾耐|多久)|(?:第二日|翌日|隔日).{0,20}(?:痛|痠|㾓)|\b(?:high blood pressure|hypertension|breathe|breathing technique|rest between|(?:sore|soreness).{0,30}(?:next|after)|(?:next day|day after).{0,30}(?:sore|ache))\b/i],
};
const SPECIAL_IDS = new Set(["knee-twister-cautions", "knee-back-twister", "wrist-support", "rope-use", "carer-pain-followup"]);
const faqById = id => ASSISTANT_FAQ_ENTRIES.find(item => item.id === id);
const EXACT = new Map(ASSISTANT_FAQ_ENTRIES.flatMap(item => item.questions.map(question => [compact(question), item])));
// Specific requests take precedence only within the same documented intent.
// Unrelated simultaneous topics and multiple painful body areas stay with the
// clarification/model flow; array order is never a tie breaker.
const MORE_SPECIFIC = {
	"back-twister-pain": ["back-pain", "back-alternative"],
	"weak-legs-falls": ["balance-safety", "balance-near-home", "beginner-equipment"],
	"balance-near-home": ["balance-safety"],
	"carer-upper-body": ["beginner-equipment"],
	"beginner-equipment": ["whole-body-equipment"],
	"food-before-exercise": ["weekly-activity"],
	"personal-goals": ["weekly-activity", "app-records"],
};
function retrieveSingle(text) {
	if (!text) return null;
	const language = analyzeAssistantLanguage(text);
	const medicalText = normalized(language.affirmativeText), subjectText = assistantSymptomSubjectText(medicalText), targets = new Set(language.targets);
	if (language.urgent) return null;
	const onlyTwister = TWISTER.test(text) && !/太極|踏步|踏級|單車|跑步|\b(?:tai chi|stepper|bike|bicycle|step exercises?)\b/i.test(text);
	if (onlyTwister && targets.size === 2 && targets.has("knee") && targets.has("back")) return faqById("knee-back-twister");
	if (onlyTwister && targets.size === 1 && targets.has("knee")) return faqById("knee-twister-cautions");
	if (SUPPORTING_HANDS.test(text) && targets.size === 1 && targets.has("wrist")) return faqById("wrist-support");
	if (!language.hasSymptom && affirmativeRopeMention(text) && !ROPE_OTHER_TOPIC.test(text)
		&& (ROPE_INSTRUCTIONS.test(text) || assistantExerciseQuantityQuestion(text))) return faqById("rope-use");
	const exact = EXACT.get(compact(text));
	if (exact) return exact;
	let matches = ASSISTANT_FAQ_ENTRIES.filter(item => {
		if (SPECIAL_IDS.has(item.id) || item.exclude?.test(text)) return false;
		const target = MEDICAL_TARGET[item.id];
		if (target && (targets.size !== 1 || !targets.has(target) || Object.entries(PARTS).some(([id, pattern]) => id !== target && pattern.test(subjectText)))) return false;
		if (item.id === "weak-legs-falls" && !/無力|弱|\b(?:weak|give way)/i.test(medicalText)) return false;
		// A medical condition must not be answered by a generic fitness FAQ.
		if (!item.medical && targets.size && !item.id.startsWith("app-") && item.id !== "scope-health") return false;
		const medical = MEDICAL_RULES[item.id];
		return medical
			? medical.facts.every(pattern => pattern.test(medicalText)) && medical.request.every(pattern => pattern.test(text))
			: (RULES[item.id] || item.all).every(pattern => pattern.test(text));
	});
	const dominated = new Set(matches.flatMap(item => MORE_SPECIFIC[item.id] || []));
	matches = matches.filter(item => !dominated.has(item.id));
	return matches.length === 1 ? matches[0] : null;
}
const FOLLOW_UP = /^(?:(?:咁|那|那麼|那么|請問|请问|請|请)\s*)?(?:有什麼器材(?:可以)?(?:幫(?:到)?我|改善)?|有哪些器材(?:可以)?(?:幫我|改善)?|什麼器材(?:可以)?(?:幫我|改善)|要(?:小心|注意|避免)什麼|有哪些要(?:小心|注意|避免)|可以看什麼教學|還有其他選擇|还有其他选择|可以再講多啲|請詳細說明|再詳細說明|(?:which|what) (?:equipment|machines?|guides?)(?: (?:can|could) help(?: me)?)?|what should i (?:avoid|watch for)|(?:tell me|explain) more|more details(?: please)?)[呀啊呢嗎吗?？!！。,.，\s]*$/i;

// Unknown questions remain with the existing guide/model flow. Context is
// opt-in through a narrowly recognized continuation and one recent USER turn;
// assistant prose, unrelated topics and a new body part cannot supply facts.
export function retrieveAssistantFaq(message, { history = [] } = {}) {
	const text = normalized(message);
	if (hasAssistantEmergency(message)) return null;
	const previousUser = (Array.isArray(history) ? history : []).slice(-8).filter(item => item?.role === "user" && typeof item.content === "string").at(-1);
	const priorUserText = normalized(previousUser?.content);
	const carerContext = (CARER.test(text) && UPPER_LIMB.test(text)) || (previousUser && CARER.test(priorUserText) && UPPER_LIMB.test(priorUserText));
	if (carerContext && /(?:佢|她|他|母親|媽媽)|\b(?:she|her|he|him|mum|mom|mother)\b/i.test(text)
		&& /拉|拉動|\bpull\w*\b/i.test(text) && pain.test(text)
		&& !analyzeAssistantLanguage(text).hasExplicitNegation && !hasAssistantEmergency(text)) return faqById("carer-pain-followup");
	const direct = retrieveSingle(text);
	if (!direct && recentRopeQuantityContext(text, history)) return faqById("rope-use");
	if (direct || text.length > 120 || !FOLLOW_UP.test(text)) return direct;
	const previous = (Array.isArray(history) ? history : []).slice(-8).filter(item => item?.role === "user" && typeof item.content === "string").at(-1);
	if (!previous) return null;
	const prior = normalized(previous.content);
	const priorLanguage = analyzeAssistantLanguage(prior);
	if (priorLanguage.historicalOnly || priorLanguage.hasExplicitNegation) return null;
	if (/tell me more|explain more|more details|再講多啲|詳細說明/i.test(text)) return retrieveSingle(prior);
	if (!medicalParts(affirmativeMedicalText(prior)).size && !retrieveSingle(prior)) return null;
	return retrieveSingle(`${prior}。${text}`);
}

function healthTopicAnswer(message, locale) {
	const en = locale === "en";
	const text = String(message || "");
	if (/高血壓|高血压|\b(?:high blood pressure|hypertension)\b/i.test(text)) return en
		? "If you have high blood pressure, ask your doctor what exercise intensity suits you before starting vigorous exercise. Do not push yourself into marked breathlessness or discomfort. Stop if unwell; chest pain or severe difficulty breathing needs urgent help — call 999."
		: "有高血壓，先請醫生確認適合您的運動強度，再決定是否做劇烈運動。不要勉強做到明顯氣促或不適。有不適便停止；胸痛或嚴重呼吸困難，要立即致電 999 求助。";
	if (/休息|休復|恢復|\b(?:rest|recover)\w*\b/i.test(text)) return en
		? "Rest between activities according to how you feel; there is no fixed interval for everyone. Do not start the next machine while dizzy, unusually breathless or in pain. If recovery is difficult or symptoms persist, stop and seek healthcare advice. A clinician can help plan rest periods suited to you."
		: "兩項活動之間先按身體狀況休息，沒有人人適用的固定分鐘數。仍然頭暈、異常氣促或疼痛，就不要開始下一項。久久未能恢復或持續不適，停止運動並向醫護詢問，請他們協助安排適合您的休息時間。";
	if (/呼吸|氣|气|chur|\b(?:breath\w*|pant\w*)\b/i.test(text)) return en
		? "Keep breathing normally during the movement. Do not push yourself to marked breathlessness. If breathing becomes unusually difficult, stop and rest; persistent or recurring symptoms need assessment. Ask a physiotherapist to demonstrate breathing with the particular movement. Severe breathing difficulty or chest pain needs urgent help — call 999."
		: "做動作時保持正常呼吸，不要勉強做到很喘。如果異常氣促，先停止並休息；持續或反覆出現，請醫護評估。您也可以請治療師配合正在做的動作示範呼吸方法。嚴重呼吸困難或胸痛，要立即致電 999 求助。";
	if (/第二日|翌日|痠|酸|㾓|\b(?:next day|day after|sore\w*)\b/i.test(text)) return en
		? "I cannot tell from this alone whether next-day arm soreness is normal. Avoid movements that make it worse and do not exercise through pain. If pain persists, worsens or comes with numbness or weakness, stop and seek healthcare advice before continuing."
		: "不能只憑這句描述確認翌日手臂痠痛是否正常。先避免令痛楚增加的動作，不要忍痛繼續練。痛楚持續、加劇，或伴隨麻痺、無力，先停止並請醫護評估，再決定怎樣繼續。";
	return null;
}

export function renderAssistantFaq(entry, catalog = [], locale = "zh", { message = "" } = {}) {
	if (!entry || !ASSISTANT_FAQ_ENTRIES.includes(entry)) return null;
	const language = locale === "en" ? "en" : "zh";
	const active = (Array.isArray(catalog) ? catalog : []).filter(item => item && item.id != null && item.isActive !== false && !item.deletedAt && !item.deleted_at);
	const selected = entry.guideCategory ? active.filter(item => item.categories?.includes(entry.guideCategory))
		: entry.guideIds.map(id => active.find(item => String(item.id) === id)).filter(Boolean);
	// Keep a small first choice set. Caution-only equipment stays explicitly in
	// the main answer; a card must not make an avoided movement look recommended.
	const excluded = entry.id === "back-pain" ? new Set(["9", "14"]) : entry.id === "wrist-pain" ? new Set(["7", "14", "20"]) : new Set();
	const priority = entry.id === "carer-upper-body" ? ["0", "19", "20"] : [];
	const ordered = priority.length ? [...selected].sort((a, b) => {
		const rank = item => priority.includes(String(item.id)) ? priority.indexOf(String(item.id)) : priority.length;
		return rank(a) - rank(b);
	}) : selected;
	const seen = new Set();
	const guides = ordered.filter(item => { const id = String(item.id); if (excluded.has(id) || seen.has(id)) return false; seen.add(id); return true; }).slice(0, 3);
	const name = item => String(item.name || item[language === "en" ? "nameEn" : "nameZh"] || "").trim();
	const recommendations = guides.filter(item => name(item)).map(item => ({ id: String(item.id), name: name(item), reason: "" }));
	// The reviewed main answer already contains the relevant precautions. Do
	// not append every professional section (often about unrelated diagnoses),
	// nor repeat the same warning underneath every equipment name.
	const rope = guides.find(item => conflictingRopeInstructions([item.details, item.careTip, item.ptTip, item.otTip].filter(Boolean).join("\n")));
	const ropeNote = rope && !["rope-use", "wrist-pain", "elbow-pain"].includes(entry.id)
		? `${name(rope)}：${assistantRopeCaution(language)}` : "";
	const missing = !recommendations.length && (entry.guideIds.length || entry.guideCategory)
		? (language === "en" ? "This guide is not available right now. You can choose another item in Facility Guide." : "這項教學暫時未能開啟，您可在「設施教學」查看其他器材。") : "";
	const base = entry.id === "scope-health" ? healthTopicAnswer(message, language) || entry.answer[language] : entry.answer[language];
	const faqReplyBase = assistantAppText([base, ropeNote, missing].filter(Boolean).join("\n\n"));
	return {
		reply: faqReplyBase,
		faqReplyBase,
		action: "faq", focus: entry.id, source: "app_content", knowledgeSource: "project_faq", evidencePolicy: ASSISTANT_FAQ_POLICY,
		faqId: entry.id, knowledgeVersion: ASSISTANT_FAQ_VERSION,
		knowledgeReferences: [], contentPolicy: ASSISTANT_CONTENT_POLICY,
		recommendations, recommendationsFinal: true, confirmationRequired: false, deepSeekUsed: false, tcmInReply: false,
	};
}
