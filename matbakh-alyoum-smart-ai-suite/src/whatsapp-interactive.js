import axios from "axios";
import { CONFIG } from "./config.js";
import { normalizePhone } from "./supabase.js";

function graphUrl() {
  return `https://graph.facebook.com/${CONFIG.wa.graphVersion}/${CONFIG.wa.phoneNumberId}/messages`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${CONFIG.wa.accessToken}`,
    "Content-Type": "application/json",
  };
}

function cut(text = "", max = 20) {
  return String(text || "").trim().slice(0, max);
}

function cutDesc(text = "", max = 72) {
  return String(text || "").trim().slice(0, max);
}

export async function sendTextMessage(to, body) {
  try {
    await axios.post(
      graphUrl(),
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "text",
        text: { body: String(body || "").trim() || " " },
      },
      { headers: authHeaders() }
    );
    return true;
  } catch (error) {
    console.error("WA_TEXT_SEND_ERROR", error?.response?.data || error.message);
    return false;
  }
}

export async function sendButtonsMessage(to, body, buttons = [], footer = null) {
  const safeButtons = buttons.slice(0, 3).map((btn) => ({
    type: "reply",
    reply: {
      id: String(btn.id || "").slice(0, 256),
      title: cut(btn.title || "", 20),
    },
  }));

  try {
    await axios.post(
      graphUrl(),
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: String(body || "").trim() || " " },
          footer: footer ? { text: String(footer).trim() } : undefined,
          action: { buttons: safeButtons },
        },
      },
      { headers: authHeaders() }
    );
    return true;
  } catch (error) {
    console.error(
      "WA_BUTTONS_SEND_ERROR",
      error?.response?.data || error.message
    );
    return false;
  }
}

export async function sendListMessage(
  to,
  body,
  buttonText,
  sections = [],
  headerText = null,
  footerText = null
) {
  const safeSections = sections
    .map((section) => ({
      title: cut(section.title || "الخيارات", 24),
      rows: (section.rows || []).slice(0, 10).map((row) => ({
        id: String(row.id || "").slice(0, 256),
        title: cut(row.title || "", 24),
        description: cutDesc(row.description || "", 72),
      })),
    }))
    .filter((section) => section.rows.length > 0);

  try {
    await axios.post(
      graphUrl(),
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "interactive",
        interactive: {
          type: "list",
          header: headerText ? { type: "text", text: String(headerText) } : undefined,
          body: { text: String(body || "").trim() || " " },
          footer: footerText ? { text: String(footerText) } : undefined,
          action: {
            button: cut(buttonText || "اختر", 20),
            sections: safeSections,
          },
        },
      },
      { headers: authHeaders() }
    );
    return true;
  } catch (error) {
    console.error("WA_LIST_SEND_ERROR", error?.response?.data || error.message);
    return false;
  }
}

export async function sendMainMenu(to, lang = "ar") {
  const body =
    lang === "en"
      ? "Welcome to Matbakh Al Youm. Choose from the main menu 👇"
      : "أهلاً وسهلاً بكم في مطبخ اليوم المركزي 🌙\nاختر من القائمة الرئيسية 👇";

  const sections = [
    {
      title: lang === "en" ? "Main Menu" : "القائمة الرئيسية",
      rows: [
        {
          id: "home:start_order",
          title: lang === "en" ? "Start Order" : "ابدأ الطلب",
          description: lang === "en" ? "Create a new order" : "ابدأ طلبًا جديدًا",
        },
        {
          id: "home:menu",
          title: lang === "en" ? "Menu & Prices" : "المنيو والأسعار",
          description: lang === "en" ? "Browse menu items" : "عرض الأصناف والأسعار",
        },
        {
          id: "home:offers",
          title: lang === "en" ? "Offers" : "العروض",
          description: lang === "en" ? "See active offers" : "عرض العروض الحالية",
        },
        {
          id: "home:track",
          title: lang === "en" ? "Track Order" : "تتبع الطلب",
          description: lang === "en" ? "Check order status" : "متابعة حالة الطلب",
        },
        {
          id: "home:support",
          title: lang === "en" ? "Customer Support" : "خدمة العملاء",
          description: lang === "en" ? "Get help" : "الاستفسارات والمساعدة",
        },
      ],
    },
  ];

  return sendListMessage(
    to,
    body,
    lang === "en" ? "Open" : "فتح",
    sections,
    null,
    lang === "en"
      ? "Use the buttons below for quick actions."
      : "استخدم الأزرار بالأسفل للإجراءات السريعة."
  );
}

export async function sendControlButtons(to, lang = "ar", body = null) {
  return sendButtonsMessage(
    to,
    body ||
      (lang === "en"
        ? "Choose the next action 👇"
        : "اختر الإجراء المناسب 👇"),
    [
      { id: "nav:back", title: lang === "en" ? "Back" : "رجوع" },
      { id: "nav:handoff", title: lang === "en" ? "Employee" : "موظف" },
      { id: "nav:exit", title: lang === "en" ? "Exit" : "خروج" },
    ]
  );
}

export async function sendHybridScreen({
  to,
  lang = "ar",
  body,
  listButtonText,
  sections,
  headerText = null,
  footerText = null,
}) {
  const okList = await sendListMessage(
    to,
    body,
    listButtonText,
    sections,
    headerText,
    footerText
  );

  if (!okList) return false;

  await sendControlButtons(
    to,
    lang,
    lang === "en"
      ? "Quick controls 👇"
      : "أزرار التحكم السريعة 👇"
  );

  return true;
}

export function extractIncomingMessage(msg) {
  if (!msg) return null;

  if (msg.type === "text") {
    return {
      kind: "text",
      text: msg.text?.body || "",
    };
  }

  if (msg.type === "interactive") {
    if (msg.interactive?.button_reply) {
      return {
        kind: "button",
        id: msg.interactive.button_reply.id,
        title: msg.interactive.button_reply.title || "",
      };
    }

    if (msg.interactive?.list_reply) {
      return {
        kind: "list",
        id: msg.interactive.list_reply.id,
        title: msg.interactive.list_reply.title || "",
        description: msg.interactive.list_reply.description || "",
      };
    }
  }

  if (msg.type === "audio") {
    return {
      kind: "audio",
      text: "رسالة صوتية",
      audioId: msg.audio?.id || null,
    };
  }

  if (msg.type === "image") {
    return {
      kind: "image",
      text: "صورة",
      imageId: msg.image?.id || null,
    };
  }

  return {
    kind: "unsupported",
    text: "",
  };
}
