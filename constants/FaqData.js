// App Upgrade #8: dataset of realistic user questions and ideal answers
// used by the chatbot to answer common enquiries about app features and practical sessions.
export const FAQ_DATA = [
	{
		keywords: ["record", "session", "timer", "記錄", "计时", "計時", "運動時段", "开始运动", "開始運動"],
		answerEn:
			"To record a session: press the \"Session Record\" button on the home page, choose outdoor or home session, then press Start. You can Pause/Resume anytime. Press \"End Session\" to fill in the summary and save it.",
		answerZh: "記錄運動：在主頁按「運動記錄」按鈕，選擇戶外或家居運動，然後按「開始」。可隨時暫停／繼續。按「結束時段」後填寫總結並儲存。",
	},
	{
		keywords: ["goal", "smart", "target", "目標", "目标", "設定"],
		answerEn:
			"Open \"Goal Setting\" from the home page. You can adjust the target days for aerobic, balance and muscle-strengthening exercise, and add weekly SMART goals. Your progress appears on the home page.",
		answerZh: "在主頁打開「目標設定」，可調整帶氧、平衡和肌肉強化運動的每週目標天數，亦可新增SMART目標。進度會顯示在主頁。",
	},
	{
		keywords: ["share", "分享", "群組", "群组"],
		answerEn:
			"In the Session Log, each saved session has a Share button. You can share the session summary (time, exercises, reps and goal progress) to this group or to external apps.",
		answerZh: "在「運動日誌」中，每個已儲存的時段都有分享按鈕，可將時段總結（時間、運動、次數及目標進度）分享到群組或其他應用程式。",
	},
	{
		keywords: ["equipment", "locate", "map", "location", "器材", "地圖", "地图", "位置", "尋找"],
		answerEn:
			"Use \"Locate Equipment\" on the home page to find outdoor exercise equipment near you, filtered by equipment type. You can open each site in the Maps app for directions.",
		answerZh: "使用主頁的「尋找器材」功能，可按器材類型篩選附近的戶外健身器材，並可在地圖應用中打開位置獲取路線。",
	},
	{
		keywords: ["audio", "sound", "語音", "语音", "播放"],
		answerEn:
			"Each equipment detail page has an audio guide. Open Outdoor Equipment, choose an equipment, and scroll to the \"Audio Guide\" section, then press the play button.",
		answerZh: "每個器材詳情頁都有語音指導。打開「戶外設施」，選擇器材，捲動到「語音指導」部分後按播放按鈕。",
	},
	{
		keywords: ["video", "youtube", "影片", "视频"],
		answerEn:
			"Demonstration videos are on each equipment's detail page under \"Reminder and Tips\". Guests can only watch some videos - log in for full access.",
		answerZh: "示範影片在每個器材詳情頁的「姿勢重點」部分。訪客只能觀看部分影片，登入後可觀看全部。",
	},
	{
		keywords: ["login", "logout", "account", "password", "登入", "登出", "密碼", "密码", "帳戶", "账户"],
		answerEn:
			"You can log in or register from the login screen. You will be signed out after 90 minutes without activity, including time spent in the background. Tapping, scrolling or typing restarts this window. Saved account data is retained. You may also need to sign in again after changing your password or when your secure session expires or is revoked.",
		answerZh: "可在登入頁登入或註冊。連續 90 分鐘沒有操作（包括停留在背景的時間）會自動登出；點按、捲動或輸入文字會重新計時。帳戶已儲存的資料會保留。修改密碼，或安全登入憑證到期或被撤銷後，也可能需要重新登入。",
	},
	{
		keywords: ["favorite", "favourite", "bookmark", "收藏", "最愛", "最爱"],
		answerEn:
			"Tap the heart icon on any equipment to add it to My Favorite. The Favorite tab also shows your learning progress - whether you have read, watched and listened to each item's materials.",
		answerZh: "在任何器材上按心形圖示即可加入收藏。收藏頁還會顯示學習進度——你是否已閱讀、觀看和收聽每個項目的教材。",
	},
	{
		keywords: ["warm", "safety", "safe", "熱身", "热身", "安全"],
		answerEn:
			"Warm up 10-15 minutes before using equipment and cool down 8-10 minutes afterwards. Read the Risk Management section in the app for full safety guidelines.",
		answerZh: "使用器材前請熱身10至15分鐘，之後做8至10分鐘的緩和運動。完整安全指引請閱讀應用程式內的「風險管理」部分。",
	},
	{
		keywords: ["who", "recommendation", "weekly", "建議", "建议", "世衞", "世卫"],
		answerEn:
			"WHO recommends older adults do at least 150 minutes of moderate aerobic activity per week, muscle-strengthening on 2+ days, and balance training on 3+ days. The preset goals in this app follow these recommendations.",
		answerZh: "世衞建議長者每週進行至少150分鐘中等強度帶氧運動、2天或以上肌肉強化運動及3天或以上平衡訓練。本應用的預設目標正是按此建議設定。",
	},
	{
		keywords: ["tts", "speech", "read aloud", "朗讀", "朗读"],
		answerEn: "On each equipment detail page, press the \"Read aloud\" button to have the app read the instructions out loud.",
		answerZh: "在器材詳情頁按「朗讀內容」按鈕，應用程式會把文字說明讀出來。",
	},
];
