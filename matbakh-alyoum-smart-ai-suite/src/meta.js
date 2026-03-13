import { CONFIG } from "./config.js";

const GRAPH_BASE = `https://graph.facebook.com/${CONFIG.wa.graphVersion}/${CONFIG.wa.phoneNumberId}/messages`;

function authHeaders() {
  return {
    Authorization: `Bearer ${CONFIG.wa.accessToken}`,
    "Content-Type": "application/json"
  };
}

async function graphPost(payload) {
  const response = await fetch(GRAPH_BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(`Graph API POST failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data;
}

function trimText(value, max = 1024) {
  return String(value || "").trim().slice(0, max);
}

function trimButtonTitle(value) {
  return String(value || "").trim().slice(0, 20);
}

function trimRowTitle(value) {
  return String(value || "").trim().slice(0, 24);
}

function trimRowDescription(value) {
  return String(value || "").trim().slice(0, 72);
}

function trimFooter(value) {
  return value ? String(value).trim().slice(0, 60) : undefined;
}

function ensurePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

export async function sendText(to, body, previewUrl = false) {
  const payload = {
    messaging_product: "whatsapp",
    to: ensurePhone(to),
    type: "text",
    text: {
      preview_url: Boolean(previewUrl),
      body: trimText(body, 4096)
    }
  };

  return graphPost(payload);
}

export async function sendButtons(to, body, buttons = [], footer = null) {
  const safeButtons = (buttons || [])
    .slice(0, 3)
    .map((button) => ({
      type: "reply",
      reply: {
        id: String(button.id || "").slice(0, 256),
        title: trimButtonTitle(button.title)
      }
    }))
    .filter((button) => button.reply.id && button.reply.title);

  if (!safeButtons.length) {
    return sendText(to, body);
  }

  const payload = {
    messaging_product: "whatsapp",
    to: ensurePhone(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: trimText(body, 1024)
      },
      action: {
        buttons: safeButtons
      }
    }
  };

  const safeFooter = trimFooter(footer);
  if (safeFooter) {
    payload.interactive.footer = { text: safeFooter };
  }

  return graphPost(payload);
}

export async function sendList(to, body, buttonText, sections = [], footer = null) {
  const safeSections = (sections || [])
    .slice(0, 10)
    .map((section) => ({
      title: trimText(section.title || "", 24),
      rows: (section.rows || [])
        .slice(0, 10)
        .map((row) => ({
          id: String(row.id || "").slice(0, 200),
          title: trimRowTitle(row.title),
          description: trimRowDescription(row.description || "")
        }))
        .filter((row) => row.id && row.title)
    }))
    .filter((section) => section.title && section.rows.length);

  if (!safeSections.length) {
    return sendText(to, body);
  }

  const payload = {
    messaging_product: "whatsapp",
    to: ensurePhone(to),
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: trimText(body, 1024)
      },
      action: {
        button: trimButtonTitle(buttonText || "عرض"),
        sections: safeSections
      }
    }
  };

  const safeFooter = trimFooter(footer);
  if (safeFooter) {
    payload.interactive.footer = { text: safeFooter };
  }

  return graphPost(payload);
}

export async function sendImage(to, imageUrl, caption = "") {
  const payload = {
    messaging_product: "whatsapp",
    to: ensurePhone(to),
    type: "image",
    image: {
      link: String(imageUrl || "").trim()
    }
  };

  const safeCaption = trimText(caption, 1024);
  if (safeCaption) {
    payload.image.caption = safeCaption;
  }

  return graphPost(payload);
}

export async function sendDocument(to, documentUrl, filename = "", caption = "") {
  const payload = {
    messaging_product: "whatsapp",
    to: ensurePhone(to),
    type: "document",
    document: {
      link: String(documentUrl || "").trim()
    }
  };

  const safeFilename = trimText(filename, 240);
  const safeCaption = trimText(caption, 1024);

  if (safeFilename) payload.document.filename = safeFilename;
  if (safeCaption) payload.document.caption = safeCaption;

  return graphPost(payload);
}

function extractContactsMap(value = []) {
  const map = new Map();

  for (const contact of value || []) {
    const waId = String(contact?.wa_id || "").trim();
    if (!waId) continue;

    const name =
      contact?.profile?.name ||
      contact?.name?.formatted_name ||
      contact?.name?.first_name ||
      "";

    map.set(waId, {
      waId,
      profileName: name
    });
  }

  return map;
}

function parseTextMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "text",
    text: message?.text?.body || "",
    interactiveId: "",
    profileName,
    raw: message
  };
}

function parseButtonReplyMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "interactive",
    text: message?.interactive?.button_reply?.title || "",
    interactiveId: message?.interactive?.button_reply?.id || "",
    profileName,
    raw: message
  };
}

function parseListReplyMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "interactive",
    text: message?.interactive?.list_reply?.title || "",
    interactiveId: message?.interactive?.list_reply?.id || "",
    profileName,
    raw: message
  };
}

function parseButtonLegacyMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "button",
    text: message?.button?.text || "",
    interactiveId: message?.button?.payload || "",
    profileName,
    raw: message
  };
}

function parseImageMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "image",
    text: message?.image?.caption || "",
    interactiveId: "",
    profileName,
    raw: message
  };
}

function parseDocumentMessage(message, profileName = "") {
  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "document",
    text: message?.document?.caption || "",
    interactiveId: "",
    profileName,
    raw: message
  };
}

function parseLocationMessage(message, profileName = "") {
  const loc = message?.location || {};
  const text = [loc.name, loc.address].filter(Boolean).join(" - ");

  return {
    id: message.id,
    from: ensurePhone(message.from),
    type: "location",
    text,
    interactiveId: "",
    profileName,
    latitude: loc.latitude,
    longitude: loc.longitude,
    raw: message
  };
}

function parseUnknownMessage(message, profileName = "") {
  return {
    id: message?.id || "",
    from: ensurePhone(message?.from),
    type: message?.type || "unknown",
    text: "",
    interactiveId: "",
    profileName,
    raw: message
  };
}

function parseSingleMessage(message, profileName = "") {
  const type = message?.type;

  if (type === "text") return parseTextMessage(message, profileName);
  if (type === "interactive") {
    if (message?.interactive?.button_reply) return parseButtonReplyMessage(message, profileName);
    if (message?.interactive?.list_reply) return parseListReplyMessage(message, profileName);
  }
  if (type === "button") return parseButtonLegacyMessage(message, profileName);
  if (type === "image") return parseImageMessage(message, profileName);
  if (type === "document") return parseDocumentMessage(message, profileName);
  if (type === "location") return parseLocationMessage(message, profileName);

  return parseUnknownMessage(message, profileName);
}

export function parseIncomingMessages(payload) {
  const results = [];
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const messages = value?.messages || [];
      const contactsMap = extractContactsMap(value?.contacts || []);

      for (const message of messages) {
        if (!message?.from) continue;

        const profile = contactsMap.get(String(message.from).trim());
        const parsed = parseSingleMessage(message, profile?.profileName || "");

        if (parsed) {
          results.push(parsed);
        }
      }
    }
  }

  return results;
}
