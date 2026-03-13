import { parsePipeList } from "./utils.js";

function required(name, fallback = "") {
  return process.env[name] || fallback;
}

function uniqueAdminNumbers(values = [], blocked = []) {
  const blockedSet = new Set(
    blocked
      .filter(Boolean)
      .map((value) => String(value).replace(/\D+/g, "").trim())
      .filter(Boolean)
  );

  return [...new Set(
    values
      .filter(Boolean)
      .map((value) => String(value).replace(/\D+/g, "").trim())
      .filter(Boolean)
      .filter((value) => !blockedSet.has(value))
  )];
}

export const CONFIG = {
  nodeEnv: required("NODE_ENV", "development"),
  appName: required("APP_NAME", "Matbakh Al Youm Smart Kitchen"),
  baseUrl: required("APP_BASE_URL", "http://localhost:10000"),
  port: Number(required("PORT", "10000")),
  timezone: required("TIMEZONE", "Asia/Amman"),

  business: {
    name: required("BUSINESS_NAME", "مطبخ اليوم المركزي"),
    phone: required("BUSINESS_PHONE", "962779960015"),
    whatsapp: required("BUSINESS_WHATSAPP", "962779960015"),
    site: required("BUSINESS_SITE", "https://matbakh-alyoum.site"),
    address: required("BUSINESS_ADDRESS", "عمّان - أم السماق"),
    currency: required("CURRENCY", "JOD")
  },

  wa: {
    graphVersion: required("META_GRAPH_VERSION", "v22.0"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    adminNumbers: uniqueAdminNumbers(
      parsePipeList(required("WA_ADMIN_NUMBERS", "962788328832,962799060405,962799080840"), ","),
      [required("BUSINESS_PHONE", "962779960015"), required("BUSINESS_WHATSAPP", "962779960015")]
    ),
    autoApproveAfterMinutes: Number(required("AUTO_APPROVE_DELIVERY_AFTER_MINUTES", "15"))
  },

  orderFlow: {
    timeSlots: parsePipeList(
      required("AVAILABLE_TIME_SLOTS", "11:00-13:00|13:00-15:00|15:00-17:00|17:00-19:00|19:00-21:00"),
      "|"
    ),
    sameDayCutoffHour: Number(required("SAME_DAY_CUTOFF_HOUR", "17")),
    approvalModeDefault: required("APPROVAL_MODE_DEFAULT", "manual_first"),
    enableAbandonedReminder: required("ENABLE_ABANDONED_REMINDER", "false") === "true",
    abandonedReminderMinMinutes: Number(required("ABANDONED_REMINDER_MIN_MINUTES", "15")),
    abandonedReminderMaxMinutes: Number(required("ABANDONED_REMINDER_MAX_MINUTES", "25")),
    reminderLoopSeconds: Number(required("REMINDER_LOOP_SECONDS", "60")),
    followupLoopSeconds: Number(required("FOLLOWUP_LOOP_SECONDS", "90")),
    delayedCustomerMessageEnabled: required("DELAYED_CUSTOMER_MESSAGE_ENABLED", "true") === "true",
    delayedCustomerPhone: required("DELAYED_CUSTOMER_PHONE", required("BUSINESS_PHONE", "962779960015"))
  },

  ai: {
    enabled: required("AI_ENABLED", "true") === "true",
    openaiApiKey: required("OPENAI_API_KEY", ""),
    openaiModel: required("OPENAI_MODEL", "gpt-4.1-mini"),
    minConfidence: Number(required("AI_MIN_CONFIDENCE", "0.84")),
    memoryWindow: Number(required("AI_MEMORY_WINDOW", "12"))
  },

  supabase: {
    url: required("SUPABASE_URL"),
    anonKey: required("SUPABASE_ANON_KEY"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY")
  },

  adminDashboardToken: required("ADMIN_DASHBOARD_TOKEN", "CHANGE_ME")
};

export function isConfigured() {
  return Boolean(
    CONFIG.wa.accessToken &&
      CONFIG.wa.phoneNumberId &&
      CONFIG.wa.verifyToken &&
      CONFIG.supabase.url &&
      CONFIG.supabase.serviceRoleKey
  );
}
