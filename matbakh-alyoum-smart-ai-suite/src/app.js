import express from "express";
import { createClient } from "@supabase/supabase-js";
import { CONFIG, isConfigured } from "./config.js";
import { handleCustomerMessage, processAdminAction } from "./bot.js";
import { parseIncomingMessages, sendButtons, sendText } from "./meta.js";

const app = express();

const db = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

function nowIso() {
  return new Date().toISOString();
}

function minutesAgo(minutes) {
  return new Date(Date.now() - Number(minutes || 0) * 60 * 1000).toISOString();
}

function pickRandom(arr = []) {
  if (!arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}

function isEnglish(lang) {
  return String(lang || "").trim().toLowerCase() === "en";
}

function abandonedReminderText(lang) {
  const ar = [
    "طلبك ما زال بانتظارك 🌿 إذا رغبت نكمل معك من نفس النقطة.",
    "لاحظنا أنك لم تكمل الطلب بعد 💛 إذا رغبت نرتب لك الطلب بسرعة.",
    "ما زال بإمكانك إكمال الطلب أو العودة للرئيسية في أي وقت."
  ];

  const en = [
    "Your order is still waiting for you 🌿 We can continue from the same point.",
    "We noticed the order was not completed yet 💛 We can finish it with you quickly.",
    "You can continue your order or return to the main menu at any time."
  ];

  return pickRandom(isEnglish(lang) ? en : ar);
}

function delayedAdminText(lang) {
  if (isEnglish(lang)) {
    return [
      "We apologize for the delay due to current pressure 🌿",
      `To finalize your request faster, please call ${CONFIG.orderFlow.delayedCustomerPhone} directly or send "ابدأ" and choose "Book with Staff".`
    ].join("\n");
  }

  return [
    "نعتذر عن التأخير بسبب الضغط الحالي 🌿",
    `لضمان تثبيت طلبك بسرعة، يرجى الاتصال مباشرة على ${CONFIG.orderFlow.delayedCustomerPhone} أو أرسل "ابدأ" ثم اختر "تثبيت حجز مع موظف".`
  ].join("\n");
}

async function getCustomerById(customerId) {
  if (!customerId) return null;

  const { data, error } = await db
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function listDueAbandonedSessions() {
  const { data, error } = await db
    .from("customer_sessions")
    .select("*")
    .not("reminder_due_at", "is", null)
    .is("reminder_sent_at_phase1", null)
    .lte("reminder_due_at", nowIso())
    .order("reminder_due_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markSessionReminderSent(sessionId, messageText) {
  const { error } = await db
    .from("customer_sessions")
    .update({
      reminder_sent_at_phase1: nowIso(),
      reminder_message: messageText || null,
      updated_at: nowIso()
    })
    .eq("id", sessionId);

  if (error) throw error;
}

async function listPendingAdminOrdersForDelay(delayMinutes = 15) {
  const cutoff = minutesAgo(delayMinutes);

  const { data, error } = await db
    .from("orders")
    .select("*")
    .in("status", ["pending_admin_review", "PENDING_ADMIN"])
    .is("reminder_sent_at_phase1", null)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markOrderDelayNoticeSent(orderId) {
  const { error } = await db
    .from("orders")
    .update({
      reminder_sent_at_phase1: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", orderId);

  if (error) throw error;
}

async function processAbandonedReminders() {
  if (!CONFIG.orderFlow.enableAbandonedReminder) return;

  const sessions = await listDueAbandonedSessions();

  for (const session of sessions) {
    try {
      const customer = await getCustomerById(session.customer_id);
      const phone = customer?.phone;
      if (!phone) {
        await markSessionReminderSent(session.id, "NO_PHONE");
        continue;
      }

      const lang = session.selected_language || customer?.preferred_language || "ar";
      const body = abandonedReminderText(lang);

      await sendButtons(
        phone,
        body,
        [
          { id: "home:main", title: isEnglish(lang) ? "Main Menu" : "الرئيسية" },
          { id: "lang:ar", title: isEnglish(lang) ? "Arabic" : "العربية" }
        ],
        CONFIG.business.name
      );

      await markSessionReminderSent(session.id, body);
    } catch (error) {
      console.error("ABANDONED_REMINDER_ERROR", error?.response || error);
    }
  }
}

async function processDelayedPendingOrders() {
  if (!CONFIG.orderFlow.delayedCustomerMessageEnabled) return;

  const orders = await listPendingAdminOrdersForDelay(15);

  for (const order of orders) {
    try {
      const lang = String(order?.meta?.language || "ar").toLowerCase();
      const phone = String(order.customer_phone || "").replace(/[^\d]/g, "");
      if (!phone) {
        await markOrderDelayNoticeSent(order.id);
        continue;
      }

      const body = delayedAdminText(lang);

      await sendText(phone, body);
      await markOrderDelayNoticeSent(order.id);
    } catch (error) {
      console.error("DELAYED_PENDING_ORDER_ERROR", error?.response || error);
    }
  }
}

function startBackgroundLoops() {
  setInterval(() => {
    processAbandonedReminders().catch((error) => {
      console.error("ABANDONED_LOOP_ERROR", error?.response || error);
    });
  }, Math.max(30, CONFIG.orderFlow.reminderLoopSeconds) * 1000);

  setInterval(() => {
    processDelayedPendingOrders().catch((error) => {
      console.error("PENDING_DELAY_LOOP_ERROR", error?.response || error);
    });
  }, Math.max(60, CONFIG.orderFlow.followupLoopSeconds) * 1000);
}

app.get("/health", async (req, res) => {
  res.status(200).json({
    ok: true,
    app: CONFIG.appName,
    configured: isConfigured(),
    timezone: CONFIG.timezone,
    now: nowIso(),
    approval_mode_default: CONFIG.orderFlow.approvalModeDefault,
    abandoned_reminder_enabled: CONFIG.orderFlow.enableAbandonedReminder
  });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.wa.verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: "Webhook verification failed" });
});

app.post("/webhook", async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const messages = parseIncomingMessages(req.body);

    for (const message of messages) {
      try {
        if (message.interactiveId?.startsWith("admin:")) {
          const handled = await processAdminAction(message);
          if (handled) continue;
        }

        await handleCustomerMessage(message);
      } catch (error) {
        console.error("EVENT_ERROR", error?.response || error);

        try {
          await sendText(
            message.from,
            "حدث خلل مؤقت أثناء معالجة الرسالة. أرسل كلمة: ابدأ للعودة إلى القائمة الرئيسية."
          );
        } catch (sendError) {
          console.error("SEND_ERROR", sendError?.response || sendError);
        }
      }
    }
  } catch (error) {
    console.error("WEBHOOK_ERROR", error?.response || error);
  }
});

const server = app.listen(CONFIG.port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${CONFIG.port}`);
  console.log(`Configured: ${isConfigured()}`);
  console.log(`Approval mode default: ${CONFIG.orderFlow.approvalModeDefault}`);
  console.log(`Abandoned reminder enabled: ${CONFIG.orderFlow.enableAbandonedReminder}`);
  startBackgroundLoops();
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
