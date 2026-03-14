import axios from "axios";
import { CONFIG, isInsideOperatingWindow } from "./config.js";
import {
  clearChatState,
  createCustomerIfMissing,
  createDraftOrder,
  detectLanguage,
  getKnowledgeAnswer,
  logConversation,
  normalizePhone,
  readChatState,
  saveCustomerFact,
  writeChatState,
} from "./supabase.js";

function tr(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function splitCombinedMessage(text = "") {
  return String(text)
    .split(/\n+/)
    .map((s) => cleanText(s))
    .filter(Boolean);
}

function isGreeting(text = "") {
  return /^(مرحبا|السلام عليكم|هلا|أهلا|اهلا|hello|hi)\b/i.test(cleanText(text));
}

function isOrderIntent(text = "") {
  return /(بدي|اريد|أريد|بدنا|طلب|اطلب|مقلوبة|ورق عنب|ملفوف|كوسا|باذنجان|مفتول|يالنجي|محاشي)/i.test(
    cleanText(text)
  );
}

function parseDish(text = "") {
  const t = cleanText(text);

  if (/مقلوبة/i.test(t)) return "مقلوبة";
  if (/ورق عنب/i.test(t)) return "ورق عنب";
  if (/ملفوف/i.test(t)) return "ملفوف";
  if (/كوسا/i.test(t)) return "كوسا";
  if (/باذنجان/i.test(t)) return "باذنجان";
  if (/مفتول/i.test(t)) return "مفتول";
  if (/يالنجي/i.test(t)) return "يالنجي";
  if (/محاشي/i.test(t)) return "محاشي";

  return null;
}

function parseProtein(text = "") {
  const t = cleanText(text);

  if (/دجاج|جاج|جاجة|جاجتين|دجاجة|دجاجتين/i.test(t)) return "دجاج";
  if (/لحم|لحمة/i.test(t)) return "لحم";

  return null;
}

function parseQuantity(text = "") {
  const t = cleanText(text);

  if (/جاجتين|دجاجتين/i.test(t)) return "2 دجاج";
  if (/جاجة|دجاجة/i.test(t)) return "1 دجاج";

  const match = t.match(/(\d+(?:\.\d+)?)\s*(كيلو|وجبة|صحن|حبة|حبات)?/);
  if (!match) return null;

  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}

function parsePaymentMethod(text = "") {
  const t = cleanText(text);

  if (/كاش|نقد/i.test(t)) return "cash";
  if (/كليك|تحويل|بطاقة|فيزا/i.test(t)) return "electronic";

  return null;
}

function classifyIntent(text = "") {
  const t = cleanText(text);

  if (/منيو|شو عندكم|شو في|شو موجود|الاصناف|الأصناف|اعرف شو في|بدي منيو/i.test(t)) {
    return "view_menu";
  }

  if (/سعر|كم|بكم/i.test(t)) return "ask_price";
  if (/توصيل|دليفري|يوصل/i.test(t)) return "ask_delivery";
  if (/موقع|عنوان|وين/i.test(t)) return "ask_location";
  if (isOrderIntent(t)) return "order_food";
  if (isGreeting(t)) return "greeting";

  return "general";
}

function getWelcomeMessage(lang = "ar") {
  return tr(
    lang,
    `أهلاً وسهلاً بكم في ${CONFIG.business.name}
كل عام وأنتم بخير بمناسبة الشهر الفضيل، وقرب عيد الفطر السعيد.
تقبل الله طاعاتكم، وجعلكم من المقبولين.

أنا مساعد مطبخ اليوم الذكي، ويسعدني خدمتك في:
• استقبال الطلبات
• عرض الأصناف والأسعار
• توضيح مناطق ورسوم التوصيل
• متابعة الطلبات

يمكنك البدء الآن بكتابة الصنف الذي تريده، مثل:
بدي مقلوبة على دجاجة`,
    `Welcome to ${CONFIG.business.name}.
How can I help you today?`
  );
}

function getOutOfHoursMessage(lang = "ar") {
  return tr(
    lang,
    `يسعدني خدمتك 🌙
نستقبل الطلبات والاستفسارات، مع التنويه أن تأكيد الطلبات والتسليم يتم حاليًا ضمن الفترة من 10:00 صباحًا حتى 6:00 مساءً بتوقيت عمّان.
يمكنني الآن تسجيل طلبك مبدئيًا ومتابعته في أول وقت متاح ضمن فترة التشغيل.`,
    `We accept inquiries now, but order confirmation and delivery are currently handled between 10:00 AM and 6:00 PM Amman time.`
  );
}

function getRamadanMessage(lang = "ar") {
  return tr(
    lang,
    `أهلاً وسهلاً 🌙
خلال شهر رمضان المبارك، البيع الحالي لدينا مخصص لوجبة الإفطار فقط.
يسعدني مساعدتك في اختيار الأصناف المناسبة للإفطار واستكمال الطلب معك.`,
    `During Ramadan, current sales are limited to iftar meals only.`
  );
}

function getMenuMessage(lang = "ar") {
  return tr(
    lang,
    "الأصناف المتوفرة حاليًا تشمل: مقلوبة، ورق عنب، ملفوف، كوسا، باذنجان، مفتول. اكتب الصنف الذي ترغب به وسأكمل معك الطلب.",
    "Available dishes include maqluba, grape leaves, cabbage rolls, zucchini, eggplant, and maftoul."
  );
}

function buildCustomerFinalReview(context) {
  return `تم استلام تفاصيل طلبك، وأنا الآن أراجعها لإعطائك التفاصيل النهائية بشكل دقيق.

• الصنف: ${context.dish || "-"}${context.protein ? ` ${context.protein}` : ""}
• الكمية: ${context.quantity || "-"}
• المنطقة: ${context.area || "-"}
• العنوان: ${context.address || "-"}
• الوقت المطلوب: ${context.deliveryTime || "-"}
• طريقة الدفع: ${context.paymentMethod || "-"}

سأتابع معك بالصيغة النهائية حال اعتماد الطلب.`;
}

function buildAdminReviewMessage(phone, context, lang = "ar") {
  return `طلب جديد بانتظار المراجعة
العميل: ${phone}
اللغة: ${lang}
الأصناف: ${context.dish || "-"} ${context.protein || ""}
الكمية: ${context.quantity || "-"}
المنطقة: ${context.area || "-"}
العنوان: ${context.address || "-"}
الوقت المطلوب: ${context.deliveryTime || "-"}
طريقة الدفع: ${context.paymentMethod || "-"}
ملاحظات: ${context.notes || "-"}
الحالة الحالية: awaiting_internal_review
الإجراء المطلوب: approve / reject / modify`;
}

async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/${CONFIG.wa.graphVersion}/${CONFIG.wa.phoneNumberId}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.wa.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("WHATSAPP_SEND_ERROR", error?.response?.data || error.message);
  }
}

async function notifyAdmins(message) {
  for (const admin of CONFIG.wa.adminNumbers) {
    await sendWhatsAppText(admin, message);
  }
}

function mergeContext(prev = {}, text = "") {
  const next = { ...prev };

  next.dish = next.dish || parseDish(text);
  next.protein = next.protein || parseProtein(text);

  const quantity = parseQuantity(text);
  if (!next.quantity && quantity) next.quantity = quantity;

  const paymentMethod = parsePaymentMethod(text);
  if (!next.paymentMethod && paymentMethod) next.paymentMethod = paymentMethod;

  return next;
}

function nextQuestion(context, lang = "ar") {
  if (!context.dish) {
    return tr(lang, "ما الصنف الذي ترغب به؟", "Which dish would you like?");
  }

  if (
    (context.dish === "مقلوبة" || context.dish === "محاشي") &&
    !context.protein
  ) {
    return tr(
      lang,
      "هل تفضل الطلب على دجاج أم لحم؟",
      "Do you prefer chicken or meat?"
    );
  }

  if (!context.quantity) {
    return tr(lang, "كم الكمية التي ترغب بها؟", "What quantity would you like?");
  }

  if (!context.area) {
    return tr(lang, "ما هي المنطقة؟", "What is the delivery area?");
  }

  if (!context.address) {
    return tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address.");
  }

  if (!context.deliveryTime) {
    return tr(lang, "ما الوقت المناسب للتوصيل؟", "What delivery time do you prefer?");
  }

  if (!context.paymentMethod) {
    return tr(
      lang,
      "ما طريقة الدفع المناسبة؟ كاش أم تحويل؟",
      "Preferred payment method: cash or transfer?"
    );
  }

  return null;
}

function getKnowledgeOrSmartReply(text, lang = "ar") {
  const t = cleanText(text);

  if (/منيو|شو عندكم|شو في|شو موجود|اعرف شو في|بدي منيو/i.test(t)) {
    return getMenuMessage(lang);
  }

  return null;
}

async function processSingleMessage({
  from,
  text,
  customer,
  stateRow,
  lang,
}) {
  const intent = classifyIntent(text);
  const currentContext = stateRow?.context || {};
  const mergedContext = mergeContext(currentContext, text);

  let reply = null;

  if (isGreeting(text)) {
    reply = getWelcomeMessage(lang);
    await writeChatState(from, "START", currentContext);
  } else {
    const smartReply = getKnowledgeOrSmartReply(text, lang);
    if (smartReply) {
      reply = smartReply;
    } else {
      const knowledge = await getKnowledgeAnswer(text);
      if (knowledge && intent !== "order_food") {
        reply = knowledge;
      }
    }
  }

  // خارج الوقت: يطبّق فقط على الطلب، وليس على المنيو أو الأسئلة العامة
  if (!reply && intent === "order_food" && !isInsideOperatingWindow()) {
    reply = getOutOfHoursMessage(lang);
  }

  if (!reply && CONFIG.orderFlow.ramadanIftarOnly) {
    if (intent === "order_food" && !currentContext.ramadanNoticeShown) {
      mergedContext.ramadanNoticeShown = true;

      if (isInsideOperatingWindow()) {
        reply = `${getRamadanMessage(lang)}\n\n${nextQuestion(mergedContext, lang) || ""}`.trim();
      }
    }
  }

  if (!reply && intent === "ask_price") {
    reply = tr(
      lang,
      "يسعدني خدمتك. أخبرني بالصنف والكمية حتى أتابع معك بشكل أدق.",
      "Tell me the dish and quantity so I can help accurately."
    );
  }

  if (!reply && intent === "view_menu") {
    reply = getMenuMessage(lang);
  }

  if (!reply && intent === "order_food") {
    const question = nextQuestion(mergedContext, lang);

    if (question) {
      reply = question;
      await writeChatState(from, "COLLECT_ORDER", mergedContext);
    } else {
      const order = await createDraftOrder({
        phone: from,
        customerId: customer?.id || null,
        items: [
          {
            dish: mergedContext.dish,
            protein: mergedContext.protein,
            quantity: mergedContext.quantity,
          },
        ],
        subtotal: null,
        deliveryArea: mergedContext.area,
        deliveryAddress: mergedContext.address,
        paymentMethod: mergedContext.paymentMethod,
        requestedDeliveryTime: mergedContext.deliveryTime,
        customerNotes: mergedContext.notes || null,
      });

      await saveCustomerFact(from, "last_area", { area: mergedContext.area });
      await saveCustomerFact(from, "favorite_dish_candidate", {
        dish: mergedContext.dish,
        protein: mergedContext.protein,
      });

      await notifyAdmins(buildAdminReviewMessage(from, mergedContext, lang));
      await writeChatState(from, "AWAITING_INTERNAL_REVIEW", {
        ...mergedContext,
        orderId: order?.id || null,
      });

      reply = buildCustomerFinalReview(mergedContext);
    }
  }

  if (!reply && stateRow?.state === "COLLECT_ORDER") {
    const question = nextQuestion(mergedContext, lang);

    if (question) {
      reply = question;
      await writeChatState(from, "COLLECT_ORDER", mergedContext);
    }
  }

  if (!reply) {
    reply = tr(
      lang,
      "يسعدني خدمتك. يمكنك كتابة الصنف مباشرة مثل: بدي مقلوبة على دجاجة، أو سؤال مثل: هل الأكل مطبوخ؟",
      "You can type your dish directly, for example: I want chicken maqluba."
    );
  }

  await logConversation({
    customerId: customer?.id || null,
    phone: from,
    incomingText: text,
    botReplyText: reply,
    messageType: "text",
    detectedLanguage: lang,
    intent,
  });

  return { reply, intent };
}

export async function processInboundText({ from, text }) {
  const lang = detectLanguage(text);
  const customer = await createCustomerIfMissing(from, null, lang);
  let stateRow = await readChatState(from);

  const parts = splitCombinedMessage(text);
  const messages = parts.length ? parts : [cleanText(text)];

  let lastReply = null;

  for (const msg of messages) {
    const result = await processSingleMessage({
      from,
      text: msg,
      customer,
      stateRow,
      lang,
    });

    lastReply = result.reply;
    stateRow = await readChatState(from);
  }

  if (!lastReply) {
    lastReply = tr(
      lang,
      "يسعدني خدمتك. كيف يمكنني مساعدتك اليوم؟",
      "How can I help you today?"
    );
  }

  await sendWhatsAppText(from, lastReply);

  return { ok: true, reply: lastReply };
}

export async function processCustomerConfirmation({ from, text }) {
  const stateRow = await readChatState(from);

  if (stateRow?.state !== "APPROVED_PENDING_CUSTOMER_CONFIRMATION") {
    return false;
  }

  if (!/(نعم|موافق|تأكيد|اعتمد|أكد)/i.test(text)) {
    return false;
  }

  await notifyAdmins(`تم تأكيد الطلب من العميل نهائيًا.
العميل: ${from}
الحالة الحالية: customer_confirmed
يرجى بدء التنفيذ والمتابعة حتى التسليم.`);

  await writeChatState(from, "CUSTOMER_CONFIRMED", stateRow.context || {});
  await sendWhatsAppText(
    from,
    "تم تأكيد طلبك بنجاح. نعمل الآن على متابعته حتى التسليم، وسأبقيك على اطلاع بحالة الطلب."
  );

  return true;
}

export async function resetConversation(from) {
  await clearChatState(from);
}
