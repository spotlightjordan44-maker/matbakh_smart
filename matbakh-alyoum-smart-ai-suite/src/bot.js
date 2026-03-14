import {
  clearChatState,
  createCustomerIfMissing,
  createDraftOrder,
  detectLanguage,
  getKnowledgeAnswer,
  logConversation,
  readChatState,
  saveCustomerFact,
  writeChatState,
} from "./supabase.js";

import {
  sendButtonsMessage,
  sendListMessage,
  sendTextMessage,
} from "./whatsapp-interactive.js";

import { CONFIG, isInsideOperatingWindow } from "./config.js";

function tr(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function parseDishFromId(id = "") {
  if (id === "order:item:maqluba") return "مقلوبة";
  if (id === "order:item:grape_leaves") return "ورق عنب";
  if (id === "order:item:cabbage") return "ملفوف";
  if (id === "order:item:zucchini") return "كوسا";
  if (id === "order:item:eggplant") return "باذنجان";
  if (id === "order:item:maftoul") return "مفتول";
  return null;
}

function parseProteinFromId(id = "") {
  if (id === "order:protein:chicken") return "دجاج";
  if (id === "order:protein:meat") return "لحم";
  return null;
}

function parseQtyFromId(id = "") {
  if (id === "order:qty:1") return "1";
  if (id === "order:qty:2") return "2";
  if (id === "order:qty:3") return "3";
  if (id === "order:qty:4") return "4";
  return null;
}

function parseAreaFromId(id = "") {
  const map = {
    "order:area:umm_sumaq": "أم السماق",
    "order:area:abdoun": "عبدون",
    "order:area:dabouq": "دابوق",
    "order:area:khilda": "خلدا",
    "order:area:tabarbour": "طبربور",
  };
  return map[id] || null;
}

function parseTimeFromId(id = "") {
  const map = {
    "order:time:asap": "أقرب وقت متاح",
    "order:time:today": "اليوم",
    "order:time:tomorrow": "غدًا",
    "order:time_slot:11_12": "11:00-12:00",
    "order:time_slot:12_13": "12:00-13:00",
    "order:time_slot:13_14": "13:00-14:00",
    "order:time_slot:14_15": "14:00-15:00",
    "order:time_slot:15_16": "15:00-16:00",
    "order:time_slot:16_1630": "16:00-16:30",
  };
  return map[id] || null;
}

function parsePaymentFromId(id = "") {
  if (id === "order:payment:cash") return "cash";
  if (id === "order:payment:transfer") return "electronic";
  return null;
}

function getWelcomeMessage(lang = "ar") {
  return tr(
    lang,
    `أهلاً وسهلاً بكم في ${CONFIG.business.name} 🌙
كل عام وأنتم بخير، وتقبل الله طاعاتكم.

أنا مساعد مطبخ اليوم الذكي، ويسعدني خدمتك.`,
    `Welcome to ${CONFIG.business.name}.`
  );
}

function getOutOfHoursMessage(lang = "ar") {
  return tr(
    lang,
    `يسعدني خدمتك 🌙
نستقبل الطلبات والاستفسارات، مع التنويه أن تأكيد الطلبات والتسليم يتم حاليًا ضمن الفترة من 10:00 صباحًا حتى 6:00 مساءً بتوقيت عمّان.
يمكنني الآن تسجيل طلبك مبدئيًا ومتابعته في أول وقت متاح ضمن فترة التشغيل.`,
    `We accept inquiries now, but confirmations and deliveries are handled between 10:00 AM and 6:00 PM Amman time.`
  );
}

function getHomeButtons(lang = "ar") {
  return [
    { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
    { id: "home:menu", title: tr(lang, "المنيو", "Menu") },
    { id: "home:offers", title: tr(lang, "العروض", "Offers") },
  ];
}

function getOrderCategoriesSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الأقسام", "Categories"),
      rows: [
        {
          id: "order:category:cooked",
          title: tr(lang, "أطباق مطبوخة", "Cooked Dishes"),
          description: tr(lang, "جاهزة للتقديم", "Ready to serve"),
        },
        {
          id: "order:category:ready_to_cook",
          title: tr(lang, "جاهز للطبخ", "Ready to Cook"),
          description: tr(lang, "أصناف مجهزة للطبخ", "Prepared for cooking"),
        },
        {
          id: "order:category:frozen",
          title: tr(lang, "مفرزات ومبرد", "Frozen & Chilled"),
          description: tr(lang, "أصناف محفوظة", "Stored items"),
        },
        {
          id: "order:category:feasts",
          title: tr(lang, "ولائم وعزائم", "Feasts"),
          description: tr(lang, "طلبات أكبر", "Larger orders"),
        },
      ],
    },
  ];
}

function getCookedItemsSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الأصناف", "Items"),
      rows: [
        { id: "order:item:maqluba", title: tr(lang, "مقلوبة", "Maqluba"), description: tr(lang, "أرز وخضار ولحم أو دجاج", "Rice dish") },
        { id: "order:item:grape_leaves", title: tr(lang, "ورق عنب", "Grape Leaves"), description: tr(lang, "طعم منزلي", "Homestyle") },
        { id: "order:item:cabbage", title: tr(lang, "ملفوف", "Cabbage"), description: tr(lang, "محشي ملفوف", "Stuffed cabbage") },
        { id: "order:item:zucchini", title: tr(lang, "كوسا", "Zucchini"), description: tr(lang, "محشي كوسا", "Stuffed zucchini") },
        { id: "order:item:eggplant", title: tr(lang, "باذنجان", "Eggplant"), description: tr(lang, "محشي باذنجان", "Stuffed eggplant") },
        { id: "order:item:maftoul", title: tr(lang, "مفتول", "Maftoul"), description: tr(lang, "طبق شرقي", "Eastern dish") },
      ],
    },
  ];
}

function getProteinButtons(lang = "ar") {
  return [
    { id: "order:protein:chicken", title: tr(lang, "دجاج", "Chicken") },
    { id: "order:protein:meat", title: tr(lang, "لحم", "Meat") },
    { id: "nav:back:cooked_items", title: tr(lang, "رجوع", "Back") },
  ];
}

function getQtyButtons(lang = "ar") {
  return [
    { id: "order:qty:1", title: "1" },
    { id: "order:qty:2", title: "2" },
    { id: "order:qty:3", title: "3" },
  ];
}

function getQtyListSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الكمية", "Quantity"),
      rows: [
        { id: "order:qty:1", title: "1", description: tr(lang, "كمية واحدة", "One") },
        { id: "order:qty:2", title: "2", description: tr(lang, "كمية 2", "Two") },
        { id: "order:qty:3", title: "3", description: tr(lang, "كمية 3", "Three") },
        { id: "order:qty:4", title: "4", description: tr(lang, "كمية 4", "Four") },
        { id: "order:qty:other", title: tr(lang, "كمية أخرى", "Other Quantity"), description: tr(lang, "إدخال يدوي", "Manual input") },
      ],
    },
  ];
}

function getAreaSections(lang = "ar") {
  return [
    {
      title: tr(lang, "المناطق", "Areas"),
      rows: [
        { id: "order:area:umm_sumaq", title: tr(lang, "أم السماق", "Um Al Summaq"), description: "" },
        { id: "order:area:abdoun", title: tr(lang, "عبدون", "Abdoun"), description: "" },
        { id: "order:area:dabouq", title: tr(lang, "دابوق", "Dabouq"), description: "" },
        { id: "order:area:khilda", title: tr(lang, "خلدا", "Khilda"), description: "" },
        { id: "order:area:tabarbour", title: tr(lang, "طبربور", "Tabarbour"), description: "" },
        { id: "order:area:other", title: tr(lang, "منطقة أخرى", "Other Area"), description: tr(lang, "إدخال يدوي", "Manual input") },
      ],
    },
  ];
}

function getTimeButtons(lang = "ar") {
  return [
    { id: "order:time:asap", title: tr(lang, "أقرب وقت", "ASAP") },
    { id: "order:time:today", title: tr(lang, "اليوم", "Today") },
    { id: "order:time:tomorrow", title: tr(lang, "غدًا", "Tomorrow") },
  ];
}

function getTimeSlotSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الفترات", "Time Slots"),
      rows: [
        { id: "order:time_slot:11_12", title: "11:00-12:00", description: "" },
        { id: "order:time_slot:12_13", title: "12:00-13:00", description: "" },
        { id: "order:time_slot:13_14", title: "13:00-14:00", description: "" },
        { id: "order:time_slot:14_15", title: "14:00-15:00", description: "" },
        { id: "order:time_slot:15_16", title: "15:00-16:00", description: "" },
        { id: "order:time_slot:16_1630", title: "16:00-16:30", description: "" },
      ],
    },
  ];
}

function getPaymentButtons(lang = "ar") {
  return [
    { id: "order:payment:cash", title: tr(lang, "كاش", "Cash") },
    { id: "order:payment:transfer", title: tr(lang, "تحويل", "Transfer") },
    { id: "nav:back:time", title: tr(lang, "رجوع", "Back") },
  ];
}

function getNotesButtons(lang = "ar") {
  return [
    { id: "order:notes:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
    { id: "order:notes:add", title: tr(lang, "إضافة ملاحظة", "Add Note") },
    { id: "nav:back:payment", title: tr(lang, "رجوع", "Back") },
  ];
}

function getFinalButtons(lang = "ar") {
  return [
    { id: "final:confirm", title: tr(lang, "تثبيت الطلب", "Confirm") },
    { id: "final:modify", title: tr(lang, "تعديل الطلب", "Modify") },
    { id: "final:cancel", title: tr(lang, "إلغاء الطلب", "Cancel") },
  ];
}

function getMenuText(lang = "ar") {
  return tr(
    lang,
    "الأصناف المتوفرة حاليًا تشمل: مقلوبة، ورق عنب، ملفوف، كوسا، باذنجان، مفتول.",
    "Available items include: maqluba, grape leaves, cabbage, zucchini, eggplant, and maftoul."
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
• الملاحظات: ${context.notes || "-"}

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

async function notifyAdmins(message) {
  for (const admin of CONFIG.wa.adminNumbers) {
    await sendTextMessage(admin, message);
  }
}

async function sendHome(to, lang = "ar") {
  await sendButtonsMessage(to, getWelcomeMessage(lang), getHomeButtons(lang));
}

async function sendOrderCategories(to, lang = "ar") {
  await sendListMessage(
    to,
    tr(lang, "اختر القسم المناسب 👇", "Choose a category 👇"),
    tr(lang, "الأقسام", "Categories"),
    getOrderCategoriesSections(lang)
  );
}

async function sendCookedItems(to, lang = "ar") {
  await sendListMessage(
    to,
    tr(lang, "اختر الصنف المطلوب 👇", "Choose an item 👇"),
    tr(lang, "الأصناف", "Items"),
    getCookedItemsSections(lang)
  );
}

async function sendProteinChoice(to, lang = "ar") {
  await sendButtonsMessage(
    to,
    tr(lang, "هل تفضل الطلب على دجاج أم لحم؟", "Do you prefer chicken or meat?"),
    getProteinButtons(lang)
  );
}

async function sendQtyChoice(to, lang = "ar") {
  await sendListMessage(
    to,
    tr(lang, "اختر الكمية المناسبة 👇", "Choose quantity 👇"),
    tr(lang, "الكمية", "Quantity"),
    getQtyListSections(lang)
  );
}

async function sendAreaChoice(to, lang = "ar") {
  await sendListMessage(
    to,
    tr(lang, "اختر المنطقة 👇", "Choose area 👇"),
    tr(lang, "المناطق", "Areas"),
    getAreaSections(lang)
  );
}

async function sendTimeChoice(to, lang = "ar") {
  await sendButtonsMessage(
    to,
    tr(lang, "اختر وقت التوصيل المناسب 👇", "Choose delivery time 👇"),
    getTimeButtons(lang)
  );
}

async function sendTimeSlots(to, lang = "ar") {
  await sendListMessage(
    to,
    tr(lang, "اختر الفترة المناسبة 👇", "Choose time slot 👇"),
    tr(lang, "الفترات", "Time Slots"),
    getTimeSlotSections(lang)
  );
}

async function sendPaymentChoice(to, lang = "ar") {
  await sendButtonsMessage(
    to,
    tr(lang, "اختر طريقة الدفع 👇", "Choose payment method 👇"),
    getPaymentButtons(lang)
  );
}

async function sendNotesChoice(to, lang = "ar") {
  await sendButtonsMessage(
    to,
    tr(lang, "هل لديك ملاحظات على الطلب؟", "Any notes for the order?"),
    getNotesButtons(lang)
  );
}

async function sendMenuPreview(to, lang = "ar") {
  await sendButtonsMessage(
    to,
    `${getMenuText(lang)}\n\n${tr(lang, "يمكنك الآن بدء الطلب.", "You can start your order now.")}`,
    [
      { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
      { id: "nav:back:home", title: tr(lang, "الرئيسية", "Home") },
    ]
  );
}

async function finalizeDraftIfReady(from, customer, stateRow, lang = "ar") {
  const context = stateRow?.context || {};

  if (
    !context.dish ||
    !context.quantity ||
    !context.area ||
    !context.address ||
    !context.deliveryTime ||
    !context.paymentMethod
  ) {
    return false;
  }

  const order = await createDraftOrder({
    phone: from,
    customerId: customer?.id || null,
    items: [
      {
        dish: context.dish,
        protein: context.protein,
        quantity: context.quantity,
      },
    ],
    subtotal: null,
    deliveryArea: context.area,
    deliveryAddress: context.address,
    paymentMethod: context.paymentMethod,
    requestedDeliveryTime: context.deliveryTime,
    customerNotes: context.notes || null,
  });

  await saveCustomerFact(from, "last_area", { area: context.area });
  await saveCustomerFact(from, "favorite_dish_candidate", {
    dish: context.dish,
    protein: context.protein,
  });

  await notifyAdmins(buildAdminReviewMessage(from, context, lang));
  await writeChatState(from, "AWAITING_INTERNAL_REVIEW", {
    ...context,
    orderId: order?.id || null,
  });

  await sendTextMessage(from, buildCustomerFinalReview(context));
  return true;
}

async function handleTextByState({ from, text, stateRow, lang, customer }) {
  const currentState = stateRow?.state || "START";
  const context = { ...(stateRow?.context || {}) };

  if (currentState === "WAITING_CUSTOM_QUANTITY") {
    context.quantity = cleanText(text);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendAreaChoice(from, lang);
    return true;
  }

  if (currentState === "WAITING_CUSTOM_AREA") {
    context.area = cleanText(text);
    await writeChatState(from, "WAITING_ADDRESS", context);
    await sendTextMessage(from, tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address."));
    return true;
  }

  if (currentState === "WAITING_ADDRESS") {
    context.address = cleanText(text);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendButtonsMessage(
      from,
      tr(lang, "اختر الوقت المناسب أو افتح الفترات 👇", "Choose delivery time or open slots 👇"),
      [
        { id: "order:time:asap", title: tr(lang, "أقرب وقت", "ASAP") },
        { id: "order:time:today", title: tr(lang, "اليوم", "Today") },
        { id: "order:time:custom_slot", title: tr(lang, "تحديد وقت", "Time Slot") },
      ]
    );
    return true;
  }

  if (currentState === "WAITING_NOTES") {
    context.notes = cleanText(text);
    await writeChatState(from, "COLLECT_ORDER", context);
    const latest = await readChatState(from);
    await finalizeDraftIfReady(from, customer, latest, lang);
    return true;
  }

  return false;
}

async function handleInteractiveSelection({ from, id, lang, customer }) {
  const stateRow = await readChatState(from);
  const context = { ...(stateRow?.context || {}) };

  if (id === "home:start_order") {
    await writeChatState(from, "VIEWING_ORDER_CATEGORIES", context);
    await sendOrderCategories(from, lang);
    return true;
  }

  if (id === "home:menu") {
    await writeChatState(from, "VIEWING_MENU", context);
    await sendMenuPreview(from, lang);
    return true;
  }

  if (id === "home:offers") {
    await sendTextMessage(
      from,
      tr(lang, "العروض سيتم ربطها من قاعدة البيانات في المرحلة التالية 🌿", "Offers will be linked from database in the next step.")
    );
    return true;
  }

  if (id === "nav:back:home") {
    await writeChatState(from, "START", {});
    await sendHome(from, lang);
    return true;
  }

  if (id === "order:category:cooked") {
    context.category = "cooked";
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendCookedItems(from, lang);
    return true;
  }

  if (id.startsWith("order:item:")) {
    context.dish = parseDishFromId(id);
    await writeChatState(from, "COLLECT_ORDER", context);

    if (context.dish === "مقلوبة") {
      await sendProteinChoice(from, lang);
    } else {
      await sendQtyChoice(from, lang);
    }
    return true;
  }

  if (id.startsWith("order:protein:")) {
    context.protein = parseProteinFromId(id);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendQtyChoice(from, lang);
    return true;
  }

  if (id === "order:qty:other") {
    await writeChatState(from, "WAITING_CUSTOM_QUANTITY", context);
    await sendTextMessage(from, tr(lang, "أرسل الكمية المطلوبة بالأرقام من فضلك.", "Please send the quantity in numbers."));
    return true;
  }

  if (id.startsWith("order:qty:")) {
    context.quantity = parseQtyFromId(id);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendAreaChoice(from, lang);
    return true;
  }

  if (id === "order:area:other") {
    await writeChatState(from, "WAITING_CUSTOM_AREA", context);
    await sendTextMessage(from, tr(lang, "أرسل اسم المنطقة من فضلك.", "Please send the area name."));
    return true;
  }

  if (id.startsWith("order:area:")) {
    context.area = parseAreaFromId(id);
    await writeChatState(from, "WAITING_ADDRESS", context);
    await sendTextMessage(from, tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address."));
    return true;
  }

  if (id === "order:time:custom_slot") {
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendTimeSlots(from, lang);
    return true;
  }

  if (id.startsWith("order:time:") || id.startsWith("order:time_slot:")) {
    context.deliveryTime = parseTimeFromId(id);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendPaymentChoice(from, lang);
    return true;
  }

  if (id.startsWith("order:payment:")) {
    context.paymentMethod = parsePaymentFromId(id);
    await writeChatState(from, "COLLECT_ORDER", context);
    await sendNotesChoice(from, lang);
    return true;
  }

  if (id === "order:notes:none") {
    context.notes = null;
    await writeChatState(from, "COLLECT_ORDER", context);
    const latest = await readChatState(from);
    await finalizeDraftIfReady(from, customer, latest, lang);
    return true;
  }

  if (id === "order:notes:add") {
    await writeChatState(from, "WAITING_NOTES", context);
    await sendTextMessage(from, tr(lang, "أرسل الملاحظة من فضلك.", "Please send your note."));
    return true;
  }

  if (id === "final:confirm") {
    await sendTextMessage(
      from,
      tr(lang, "رائع 🌿 تم تثبيت طلبك النهائي وبدأت إجراءات التنفيذ.", "Great. Your order has been confirmed and execution has started.")
    );
    await writeChatState(from, "CUSTOMER_CONFIRMED", context);
    return true;
  }

  if (id === "final:modify") {
    await sendTextMessage(
      from,
      tr(lang, "تم استلام طلب التعديل. سأعيدك الآن إلى مسار الطلب.", "Modification request received. Returning you to the order flow.")
    );
    await writeChatState(from, "VIEWING_ORDER_CATEGORIES", {});
    await sendOrderCategories(from, lang);
    return true;
  }

  if (id === "final:cancel") {
    await sendTextMessage(
      from,
      tr(lang, "تم استلام طلب الإلغاء.", "Cancellation request received.")
    );
    await writeChatState(from, "ORDER_CANCELLED", context);
    return true;
  }

  return false;
}

export async function processInboundText({ from, text }) {
  const lang = detectLanguage(text);
  const customer = await createCustomerIfMissing(from, null, lang);
  const stateRow = await readChatState(from);
  const cleaned = cleanText(text);

  if (!cleaned) {
    await sendHome(from, lang);
    return { ok: true };
  }

  const handledByState = await handleTextByState({
    from,
    text: cleaned,
    stateRow,
    lang,
    customer,
  });

  if (handledByState) {
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: null,
      messageType: "text",
      detectedLanguage: lang,
      intent: "state_text_input",
    });
    return { ok: true };
  }

  if (isGreeting(cleaned)) {
    await writeChatState(from, "START", {});
    await sendHome(from, lang);
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: getWelcomeMessage(lang),
      messageType: "text",
      detectedLanguage: lang,
      intent: "greeting",
    });
    return { ok: true };
  }

  if (/منيو|شو عندكم|شو في|اعرف شو في|الأصناف|الاصناف/i.test(cleaned)) {
    await sendMenuPreview(from, lang);
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: getMenuText(lang),
      messageType: "text",
      detectedLanguage: lang,
      intent: "view_menu",
    });
    return { ok: true };
  }

  const knowledge = await getKnowledgeAnswer(cleaned);
  if (knowledge) {
    await sendButtonsMessage(from, knowledge, [
      { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
      { id: "home:menu", title: tr(lang, "المنيو", "Menu") },
      { id: "nav:back:home", title: tr(lang, "الرئيسية", "Home") },
    ]);
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: knowledge,
      messageType: "text",
      detectedLanguage: lang,
      intent: "knowledge",
    });
    return { ok: true };
  }

  if (!isInsideOperatingWindow() && /بدي|اريد|أريد|بدنا|طلب|مقلوبة|ورق عنب|ملفوف|كوسا|باذنجان|مفتول/i.test(cleaned)) {
    await sendButtonsMessage(from, getOutOfHoursMessage(lang), [
      { id: "home:menu", title: tr(lang, "المنيو", "Menu") },
      { id: "home:start_order", title: tr(lang, "تسجيل مبدئي", "Save Draft") },
      { id: "nav:back:home", title: tr(lang, "الرئيسية", "Home") },
    ]);
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: getOutOfHoursMessage(lang),
      messageType: "text",
      detectedLanguage: lang,
      intent: "out_of_hours_order",
    });
    return { ok: true };
  }

  await sendButtonsMessage(
    from,
    tr(
      lang,
      "يسعدني خدمتك. اختر الإجراء المناسب 👇",
      "Choose the next action 👇"
    ),
    getHomeButtons(lang)
  );

  await logConversation({
    customerId: customer?.id || null,
    phone: from,
    incomingText: cleaned,
    botReplyText: null,
    messageType: "text",
    detectedLanguage: lang,
    intent: "fallback",
  });

  return { ok: true };
}

export async function processInteractiveReply({ from, interactiveId, interactiveTitle = "" }) {
  const lang = detectLanguage(interactiveTitle || "مرحبا");
  const customer = await createCustomerIfMissing(from, null, lang);

  const handled = await handleInteractiveSelection({
    from,
    id: interactiveId,
    lang,
    customer,
  });

  await logConversation({
    customerId: customer?.id || null,
    phone: from,
    incomingText: interactiveTitle || interactiveId,
    botReplyText: null,
    messageType: "interactive",
    detectedLanguage: lang,
    intent: interactiveId,
  });

  return { ok: handled };
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
  await sendTextMessage(
    from,
    "تم تأكيد طلبك بنجاح. نعمل الآن على متابعته حتى التسليم، وسأبقيك على اطلاع بحالة الطلب."
  );

  return true;
}

export async function resetConversation(from) {
  await clearChatState(from);
}
