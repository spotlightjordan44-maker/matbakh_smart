export function parsePipeList(value, separator = "|") {
  return String(value || "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

export function formatMoney(value, currency = "JOD") {
  const num = Number(value || 0).toFixed(2);
  return `${num} ${currency}`;
}

export function nowInTimezone(timezone = "Asia/Amman") {
  return new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
}

export function todayInTimezone(timezone = "Asia/Amman") {
  const d = nowInTimezone(timezone);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function tomorrowInTimezone(timezone = "Asia/Amman") {
  const d = nowInTimezone(timezone);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateInput(input, timezone = "Asia/Amman") {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, dd, mm, yyyy] = slash;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const normalized = raw.replace(/\s+/g, " ").toLowerCase();

  if (["اليوم", "today"].includes(normalized)) return todayInTimezone(timezone);
  if (["غدًا", "غدا", "tomorrow"].includes(normalized)) return tomorrowInTimezone(timezone);

  return null;
}

export function isPositiveInteger(value) {
  return /^\d+$/.test(String(value || "").trim()) && Number(value) > 0;
}

export function makeButtonId(...parts) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":")
    .slice(0, 200);
}

export function safeJson(value, fallback = {}) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value ?? fallback;
  } catch {
    return fallback;
  }
}

export function compactText(lines) {
  return lines.filter(Boolean).join("\n");
}

export function buildWhatsAppLink(phone, text) {
  const normalized = normalizePhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function getLocalHour(timezone = "Asia/Amman") {
  const d = nowInTimezone(timezone);
  return d.getHours();
}

export function availableSameDaySlots(allSlots, timezone = "Asia/Amman") {
  const currentHour = getLocalHour(timezone);
  return allSlots.filter((slot) => {
    const match = String(slot).match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/);
    if (!match) return true;
    const startHour = Number(match[1]);
    return startHour > currentHour;
  });
}

export function randomIntBetween(min, max) {
  const start = Number(min || 0);
  const end = Number(max || 0);
  if (end <= start) return start;
  return Math.floor(Math.random() * (end - start + 1)) + start;
}

export function addMinutes(dateInput, minutes) {
  const d = new Date(dateInput);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return d;
}

export function toIso(dateInput = new Date()) {
  return new Date(dateInput).toISOString();
}

export function isArabicLanguage(value) {
  return String(value || "").trim().toLowerCase() === "ar";
}

export function isEnglishLanguage(value) {
  return String(value || "").trim().toLowerCase() === "en";
}

export function normalizeLanguage(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["en", "english", "الانجليزية", "انجليزي", "english 🇬🇧"].includes(raw)) return "en";
  return "ar";
}

export function orderSerialLabel(serialNo) {
  if (!serialNo) return "EMANI001";
  return `EMANI${String(serialNo).padStart(3, "0")}`;
}

export function parseInteractiveChoice(message) {
  const interactiveId = String(message?.interactiveId || "").trim();
  if (interactiveId) return interactiveId;
  return String(message?.text || "").trim();
}

export function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}
