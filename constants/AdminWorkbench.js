// Admin interface copy only. These labels never replace editable APP content.
const WORKBENCH_COPY = {
  "zh-CN": {
    title: "内容管理快捷入口",
    hint: "按管理权限显示常用操作。保存成功后，内容会在 APP 下次刷新时读取。",
    textsLabel: "APP文字与说明",
    shortcuts: {
      equipment: { label: "编辑设施教学", hint: "中英说明、图片、视频与上架状态" },
      home: { label: "维护首页内容", hint: "首页视频、文字及功能入口" },
      files: { label: "管理文件", hint: "上传、分类和复用已有素材" },
      feedback: { label: "查看用户反馈", hint: "阅读反馈、跟进处理进度" },
    },
  },
  "zh-HK": {
    title: "內容管理快捷入口",
    hint: "按管理權限顯示常用操作。儲存成功後，內容會在 APP 下次重新整理時讀取。",
    textsLabel: "APP文字與說明",
    shortcuts: {
      equipment: { label: "編輯設施教學", hint: "中英說明、圖片、影片與上架狀態" },
      home: { label: "維護首頁內容", hint: "首頁影片、文字及功能入口" },
      files: { label: "管理檔案", hint: "上傳、分類和重用現有素材" },
      feedback: { label: "查看用戶回饋", hint: "閱讀回饋、跟進處理進度" },
    },
  },
  en: {
    title: "Content management shortcuts",
    hint: "Common actions are shown according to your permissions. After saving, content is loaded the next time the APP refreshes.",
    textsLabel: "APP Text & Instructions",
    shortcuts: {
      equipment: { label: "Edit facility teaching", hint: "Chinese and English instructions, images, videos and publication status" },
      home: { label: "Maintain home content", hint: "Home videos, text and feature links" },
      files: { label: "Manage files", hint: "Upload, organise and reuse existing assets" },
      feedback: { label: "View user feedback", hint: "Read feedback and track follow-up progress" },
    },
  },
};

export function getAdminWorkbenchCopy(locale) {
  return WORKBENCH_COPY[locale] || WORKBENCH_COPY["zh-CN"];
}
