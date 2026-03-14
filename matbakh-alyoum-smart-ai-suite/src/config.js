function required(name, fallback = "") {
  return process.env[name] || fallback;
}

function parseList(value = "", separator = ",") {
  return String(value)
    .split(separator)
    .map((v) => String(v).trim())
    .filter(Boolean);
}

function normalizeNumber(value = "") {
  return String(value).replace(/\D+/g, "");
}

function uniqueAdminNumbers(values = [], blocked = []) {
  const blockedSet = new Set(blocked.map(normalizeNumber).filter(Boolean));
  return [
    ...new Set(
      values
        .map(normalizeNumber)
        .filter(Boolean)
        .filter((n) => !blockedSet.has(n))
    ),
  ];
}

export const CONFIG = {
  nodeEnv: required("NODE_ENV", "development"),
  port: Number(required("PORT", "10000")),
  timezone: required("TIMEZONE", "Asia/Amman"),
  appName: required("APP_NAME", "Matbakh Al Youm Smart Kitchen"),
  baseUrl: required("APP_BASE_URL", "http://localhost:10000"),

  business: {
    name: required("BUSINESS_NAME", "مطبخ اليوم المركزي"),
    phone: normalizeNumber(required("BUSINESS_PHONE", "962779960015")),
    whatsapp: normalizeNumber(required("BUSINESS_WHATSAPP", "962779960015")),
    site: required("BUSINESS_SITE", "https://matbakh-alyoum.site"),
    address: required("ADDRESS_BUSINESS", "عمّان - أم السماق"),
    currency: required("CURRENCY", "JOD"),
  },

  wa: {
    graphVersion: required("META_GRAPH_VERSION", "v22.0"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN", ""),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID", ""),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN", ""),
    adminNumbers: uniqueAdminNumbers(
      parseList(required("WA_ADMIN_NUMBERS", ""), ","),
      [
        required("BUSINESS_PHONE", "962779960015"),
        required("BUSINESS_WHATSAPP", "962779960015"),
      ]
    ),
  },

  supabase: {
    url: required("SUPABASE_URL", ""),
    anonKey: required("SUPABASE_ANON_KEY", ""),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", ""),
  },

  orderFlow: {
    approvalModeDefault: required("APPROVAL_MODE_DEFAULT", "manual_first"),
    operatingStartHour: Number(required("OPERATING_START_HOUR", "10")),
    operatingEndHour: Number(required("OPERATING_END_HOUR", "18")),
    sameDayCutoffHour: Number(required("SAME_DAY_CUTOFF_HOUR", "15")),
    ramadanIftarOnly: required("RAMADAN_IFTAR_ONLY", "true") === "true",
    availableTimeSlots: parseList(
      required(
        "AVAILABLE_TIME_SLOTS",
        "11:00-12:00|12:00-13:00|13:00-14:00|14:00-15:00|15:00-16:00|16:00-16:30"
      ),
      "|"
    ),
  },

  ai: {
    enabled: required("AI_ENABLED", "true") === "true",
    model: required("OPENAI_MODEL", "gpt-4.1-mini"),
    minConfidence: Number(required("AI_MIN_CONFIDENCE", "0.84")),
    memoryWindow: Number(required("AI_MEMORY_WINDOW", "12")),
  },
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

export function getNowInAmman() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: CONFIG.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { now, hour, minute };
}

export function isInsideOperatingWindow() {
  const { hour } = getNowInAmman();
  return (
    hour >= CONFIG.orderFlow.operatingStartHour &&
    hour < CONFIG.orderFlow.operatingEndHour
  );
}
