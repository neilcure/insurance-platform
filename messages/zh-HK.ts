/**
 * Traditional Chinese (Hong Kong) message dictionary.
 *
 * Partial coverage is fine — `tStatic` falls back to the matching
 * leaf from `messages/en.ts` whenever a key is missing here. This
 * lets us ship phase by phase without breaking the UI.
 *
 * The structure intentionally mirrors `messages/en.ts`. Adding a new
 * top-level group there is a breaking change and must be matched
 * here (or accepted as English-only). The `Messages` type alias from
 * the English file keeps us honest on the keys we DO translate.
 */

import type { Messages } from "./en";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const messages: DeepPartial<Messages> = {
  nav: {
    dashboard: "主控台",
    overview: "總覽",
    policies: "保單",
    clients: "客戶",
    agents: "代理",
    accounting: "會計",
    documents: "文件",
    admin: "管理",
    settings: "設定",
    logout: "登出",
    platform: "平台",
    imports: "匯入",
    membership: "會籍",
    profile: "個人資料",
    docs: "說明文件",
    guide: "指南",
    myPolicies: "我的保單",
    myProfile: "我的個人資料",
  },

  sidebar: {
    adminPanel: "管理員面板",
    policySettings: "保單設定",
    packages: "套裝",
    userSettings: "使用者設定",
    activityLog: "活動記錄",
    clientNumberSettings: "客戶編號設定",
    landingPage: "首頁",
    paymentSchedules: "付款時間表",
    systemDiagnostics: "系統診斷",
    accountingRules: "會計規則",
    flows: "流程",
    documentTemplates: "文件範本",
    workflowActions: "工作流程動作",
    policyStatuses: "保單狀態",
    uploadDocuments: "上傳文件",
    backendDocuments: "後台文件",
    pdfMailMerge: "PDF 合併信件",
    category: "類別",
    fields: "欄位",
    clientAccount: "客戶帳戶",
    account: "帳戶",
    switchTeam: "切換團隊",
    categoryHint: "{label} — 類別",
    fieldsHint: "{label} — 欄位",
    announcements: "公告",
  },

  common: {
    save: "儲存",
    cancel: "取消",
    delete: "刪除",
    edit: "編輯",
    close: "關閉",
    confirm: "確認",
    ok: "確定",
    back: "返回",
    next: "下一步",
    create: "建立",
    update: "更新",
    search: "搜尋",
    loading: "載入中…",
    noResults: "沒有結果",
    yes: "是",
    no: "否",
    optional: "選填",
    required: "必填",
    fallbackUserName: "使用者",
    userPicker: {
      searchPlaceholder: "以姓名、電郵或用戶編號搜尋…",
      help: "勾選要包含的用戶。",
      selectedCount: "已選 {count} 位",
      shownCount: "顯示 {shown} / {total} 位",
      noLoginCount: "{count} 位未開帳戶",
      empty: "沒有符合的用戶。",
      loading: "載入用戶中…",
      clearSelection: "清除已選",
      missingTitle: "部分已選用戶未顯示於下方（可能已離開機構或超出列表上限）。在移除或儲存前仍會保留。",
      removeOne: "移除用戶 {id}",
      removeOneClient: "移除客戶 {id}",
      filterAllTypes: "全部類型",
      filterTypeLabel: "依用戶類型篩選",
      bucketPersonalClient: "客戶（未開帳戶）",
      bucketCompanyClient: "公司客戶（未開帳戶）",
      statusNoEmail: "尚未填寫電郵",
      statusNoLogin: "等候開帳戶",
      clientHint: "此客戶尚未開立登入帳戶；當他們被邀請後，公告會自動出現。",
    },
  },

  auth: {
    signInTitle: "登入",
    signOut: "登出",
    email: "電郵",
    password: "密碼",
    forgotPassword: "忘記密碼？",
    rememberMe: "記住我",
    signin: {
      welcomeBack: "歡迎回來",
      subtitle: "登入您的帳戶以繼續",
      signingIn: "登入中…",
      continueWithGoogle: "使用 Google 繼續",
      or: "或",
      contactAdmin: "尚未擁有帳戶？請聯絡您的管理員。",
      loading: "載入中…",
      errorGoogleAccessDenied: "Google 登入只供已邀請的有效用戶使用，請要求管理員邀請您的電郵。",
      errorIdleTimeout: "因閒置時間過長，您已被自動登出，請重新登入。",
      errorGoogleFailed: "Google 登入失敗，請再試一次。",
      errorNoResponse: "驗證伺服器沒有回應。",
      errorInvalidCredentials: "電郵或密碼錯誤。",
      errorSignInFailed: "登入失敗，請再試一次。",
      errorGeneric: "登入錯誤：{error}",
    },
    forgot: {
      title: "重設您的密碼",
      description: "請輸入您的電郵，我們會發送密碼重設連結給您。",
      checkEmail: "請查看您的電郵以取得重設連結。",
      sendLink: "發送重設連結",
      sentMessage: "如該電郵已註冊，您將會收到密碼重設連結。",
      tryAnother: "嘗試其他電郵",
      backToSignIn: "返回登入",
      toastSuccess: "如帳戶存在，已發送重設連結。",
      toastError: "請求失敗",
      devOnly: "僅限開發 - 重設連結：",
      copy: "複製",
      invalidEmail: "請輸入有效的電郵",
    },
    reset: {
      title: "重設密碼",
      newPassword: "新密碼",
      confirmPassword: "確認密碼",
      placeholderRetype: "請再次輸入您的密碼",
      passwordsNoMatch: "兩次輸入的密碼不相符",
      fillAll: "請填寫所有欄位",
      updating: "更新中…",
      updatePassword: "更新密碼",
      minLength: "至少 {n} 個字元",
      uppercase: "大寫字母 (A-Z)",
      lowercase: "小寫字母 (a-z)",
      number: "數字 (0-9)",
      special: "特殊字元 (!@#…)",
      failedReset: "密碼重設失敗",
      success: "密碼已更新，您現在可以登入。",
    },
    invite: {
      title: "接受邀請",
      passwordHint: "密碼（最少 10 個字元）",
      confirmPassword: "確認密碼",
      passwordMinLen: "密碼至少需 10 個字元",
      passwordsNoMatch: "兩次輸入的密碼不相符",
      failedAccept: "接受邀請失敗",
      invalidExpired: "邀請無效或已過期",
      success: "密碼已設定，您現在可以登入。",
      submitting: "提交中…",
      setPassword: "設定密碼",
    },
  },

  policiesTable: {
    implicitInsured: "受保人",
  },

  insured: {
    typeLabel: "受保人類型",
    noCategoriesHelp:
      "尚未設定受保人類別。請在「管理 → 保單設定 → 受保人類別」中新增。",
    infoSectionTitle: "受保人資料",
    noOptionsConfigured: "未設定選項。",
  },

  accounting: {
    display: "顯示",
  },

  admin: {
    policySettings: {
      title: "保單設定",
      description: "設定保單相關選項。",
      availableSettings: "可用設定",
      vehicleCategory: "車輛類別",
      vehicleFields: "車輛欄位",
      uploadDocumentTypes: "上傳文件類型",
    },
    users: {
      subtitle: "管理使用者及權限。",
      description: "邀請使用者、變更角色、啟用 / 停用或刪除帳戶。",
    },
    inviteForm: {
      defaultUiLanguage: "預設介面語言",
      defaultUiLanguageHint: "在用戶於頁首語言切換器選擇其他語言之前，將使用此設定。",
    },
    announcements: {
      title: "公告",
      subtitle: "為所屬機構設定主控台彈出視窗——對象、時間，以及選用的海報圖或 PDF。",
      columnTitle: "標題",
      columnSchedule: "時間",
      columnActive: "啟用",
      columnActions: "操作",
      newButton: "新增公告",
      editButton: "編輯",
      deleteButton: "刪除",
      saveButton: "儲存",
      cancelButton: "取消",
      titleLabel: "標題",
      bodyLabel: "內容（HTML）",
      bodyHelp: "可使用基本 HTML（段落、粗體、清單、連結）。會自動移除程式碼標籤。",
      linkUrlLabel: "選填連結網址",
      linkUrlPlaceholder: "https://...",
      startsLabel: "開始",
      endsLabel: "結束",
      autoCloseLabel: "自動關閉（秒）",
      autoCloseHint: "留空則須由用戶按「關閉」。",
      autoClosePlaceholder: "例如 15",
      priorityLabel: "優先順序（數字愈大愈先顯示）",
      activeLabel: "啟用",
      targetingLabel: "對象",
      targetingAll: "此機構所有用戶",
      targetingTypes: "指定用戶類型",
      targetingUsers: "指定用戶",
      userPickerHelp: "勾選應看到此彈出視窗的用戶。沒有登入帳戶的客戶亦可勾選 — 待他們被邀請成為用戶後，公告會自動出現。",
      uploadMedia: "上載圖片或 PDF",
      clearMedia: "移除媒體",
      mediaPreviewUploaded: "已上載媒體，將於彈出視窗顯示。",
      listEmpty: "尚未建立公告。",
      confirmDeleteTitle: "刪除此公告？",
      confirmDeleteDescription: "已關閉的用戶不會再看到；此操作將停止向其他人顯示。",
      toastSaved: "公告已儲存",
      toastDeleted: "公告已刪除",
      toastError: "發生錯誤",
    },
    documentTemplatesEditor: {
      legacyPremiumSource: "保費（舊版）",
      legacyPremiumBannerTitle: "舊版「保費」資料來源",
      legacyPremiumBannerBody:
        "此選項讀取會計資料表的保費列（policyPremiums）。精靈裡「Premium Record」套件欄位會存在保單快照 — 請將來源改為「套件（自訂）」，套件選「premiumRecord」，文件才會顯示這些數值。",
      premiumTypographyHeading: "此區塊標籤／數值字型",
      premiumTypographyHint:
        "覆蓋範本預設的正文字級與標籤／數值顏色。可用色塊選色或自行輸入十六進位色碼。「將最新金額列加粗」會套用最後一個貨幣或數字欄位（依欄位順序）。",
      premiumTypographyBodySize: "正文字級",
      premiumTypographyInherit: "沿用範本預設",
      premiumTypographyLabelColor: "標籤顏色",
      premiumTypographyValueColor: "數值顏色",
      premiumTypographyBoldLatest: "將最新金額列加粗",
    },
  },

  announcementsViewer: {
    openLink: "開啟連結",
    autoCloseNotice: "此訊息將自動關閉。",
  },

  landing: {
    signIn: "登入",
    forgotPassword: "忘記密碼",
    allRightsReserved: "版權所有。",
  },

  dashboard: {
    title: "主控台",
    createPolicy: "建立保單",
    welcomeTitle: "歡迎",
    welcomeSignedInAs: "登入身份",
    welcomeRole: "角色",
    welcomeAccountSetupComplete: "帳戶設定完成",
    welcomeFallbackRole: "使用者",
  },

  calendar: {
    title: "保單行事曆",
    error: {
      failedToLoad: "載入失敗",
    },
    bucket: {
      outstanding: "未繳付",
      pending: "待處理",
      rejected: "已拒絕",
      overdue: "逾期",
      inProgress: "進行中",
      thisWeek: "本週",
      thisMonth: "本月",
      later: "稍後",
    },
    day: {
      today: "今日",
      tomorrow: "明日",
      yesterday: "昨日",
    },
    action: {
      open: "開啟",
      email: "電郵",
      openTitle: "開啟保單",
      emailReminder: "發送續保提醒電郵",
    },
    starts: {
      today: "今日生效",
      tomorrow: "明日生效",
    },
    toolbar: {
      clearFilters: "清除所有狀態篩選",
      calendarSettings: "行事曆設定",
      unsavedChanges: "未儲存的變更",
      noChanges: "沒有變更",
      showByMonth: "按月顯示",
      showAllCount: "顯示全部 {count}",
    },
    aria: {
      openDayPreview: "開啟文件任務及當日預覽",
    },
  },

  locale: {
    label: "語言",
    en: "English",
    "zh-HK": "繁體中文",
  },
};

export default messages;
