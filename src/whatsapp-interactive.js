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

function truncateTitle(text = "", max = 20) {
  return String(text).trim().slice(0, max);
}

function truncateDesc(text = "", max = 72) {
  return String(text).trim().slice(0, max);
}

export async function sendTextMessage(to, body) {
  try {
    await axios.post(
      graphUrl(),
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "text",
        text: { body },
      },
      { headers: authHeaders() }
    );
    return true;
  } catch (error) {
    console.error("WA_TEXT_SEND_ERROR", error?.response?.data || error.message);
    return false;
  }
}

export async function sendButtonsMessage(to, body, buttons = []) {
  const safeButtons = buttons.slice(0, 3).map((btn) => ({
    type: "reply",
    reply: {
      id: String(btn.id).slice(0, 256),
      title: truncateTitle(btn.title, 20),
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
          body: { text: body },
          action: { buttons: safeButtons },
        },
      },
      { headers: authHeaders() }
    );
    return true;
  } catch (error) {
    console.error("WA_BUTTONS_SEND_ERROR", error?.response?.data || error.message);
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
  const safeSections = sections.map((section) => ({
    title: truncateTitle(section.title || "الخيارات", 24),
    rows: (section.rows || []).slice(0, 10).map((row) => ({
      id: String(row.id).slice(0, 256),
      title: truncateTitle(row.title, 24),
      description: truncateDesc(row.description || "", 72),
    })),
  }));

  try {
    await axios.post(
      graphUrl(),
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "interactive",
        interactive: {
          type: "list",
          header: headerText ? { type: "text", text: headerText } : undefined,
          body: { text: body },
          footer: footerText ? { text: footerText } : undefined,
          action: {
            button: truncateTitle(buttonText || "اختر", 20),
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

  return {
    kind: "unsupported",
    text: "",
  };
}
