import { CONFIG, isInsideOperatingWindow } from "./config.js";
import {
  clearChatState,
  createCustomerIfMissing,
  createDraftOrder,
  detectLanguage,
  getActiveOffers,
  getDeliveryZones,
  getKnowledgeAnswer,
  getLastOpenDraftOrder,
  getMenuCategories,
  getMenuItemByKey,
  getMenuItemsByCategory,
  logConversation,
  readChatState,
  saveCustomerFact,
  writeChatState,
} from "./supabase.js";

import {
  sendButtonsMessage,
  sendControlButtons,
  sendHybridScreen,
  sendMainMenu,
  sendTextMessage,
} from "./whatsapp-interactive.js";

function tr(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function cleanText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isGreeting(text = "") {
  return /^(مرحبا|السلام عليكم|هلا|أهلا|اهلا|hello|hi)\b/i.test(cleanText(text));
}

function isOrderLikeText(text = "") {
  return /(بدي|اريد|أريد|بدنا|طلب|اطلب|مقلوبة|ورق عنب|ملفوف|كوسا|باذنجان|مفتول|يالنجي|محاشي|منسف|دجاج|لحم)/i.test(
    cleanText(text)
  );
}

function normalizeKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function getStateEnvelope(stateRow) {
  return {
    state: stateRow?.state || "START",
    context: stateRow?.context || {},
  };
}

function withHistory(context = {}, currentStep = "START") {
  const history = Array.isArray(context._history) ? [...context._history] : [];
  if (!history.length || history[history.length - 1] !== currentStep) {
    history.push(currentStep);
  }
  return {
    ...context,
    _history: history.slice(-20),
    _last_step: currentStep,
    _last_activity_at: new Date().toISOString(),
  };
}

function previousStep(context = {}) {
  const history = Array.isArray(context._history) ? [...context._history] : [];
  if (history.length <= 1) return null;
  history.pop();
  return {
    step: history[history.length - 1] || "START",
    history,
  };
}

function setContextStep(context = {}, step = "START") {
  return withHistory(
    {
      ...context,
      _current_step: step,
    },
    step
  );
}

function stripSystemContext(context = {}) {
  const copy = { ...context };
  delete copy._history;
  delete copy._current_step;
  delete copy._last_step;
  delete copy._last_activity_at;
  return copy;
}

function parseNumericQuantity(text = "") {
  const t = cleanText(text);
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return String(m[1]);
}

function parseNaturalProtein(text = "") {
  const t = cleanText(text);
  if (/دجاج|جاج|جاجة|جاجتين|دجاجة|دجاجتين/i.test(t)) return "دجاج";
  if (/لحم|لحمة/i.test(t)) return "لحم";
  return null;
}

function humanPaymentLabel(value, lang = "ar") {
  if (value === "cash") return tr(lang, "كاش", "Cash");
  if (value === "electronic") return tr(lang, "تحويل / كليك", "Transfer / Click");
  return value || "-";
}

function isControlId(id = "") {
  return ["nav:back", "nav:handoff", "nav:exit"].includes(id);
}

function buildMainMenuSections(lang = "ar") {
  return [
    {
      title: tr(lang, "القائمة الرئيسية", "Main Menu"),
      rows: [
        {
          id: "home:start_order",
          title: tr(lang, "ابدأ الطلب", "Start Order"),
          description: tr(lang, "ابدأ طلبًا جديدًا", "Create a new order"),
        },
        {
          id: "home:menu",
          title: tr(lang, "المنيو والأسعار", "Menu & Prices"),
          description: tr(lang, "تصفح الأصناف والأسعار", "Browse menu items"),
        },
        {
          id: "home:offers",
          title: tr(lang, "العروض", "Offers"),
          description: tr(lang, "العروض الحالية", "Current offers"),
        },
        {
          id: "home:track",
          title: tr(lang, "تتبع الطلب", "Track Order"),
          description: tr(lang, "تابع حالة طلبك", "Check order status"),
        },
        {
          id: "home:support",
          title: tr(lang, "خدمة العملاء", "Customer Support"),
          description: tr(lang, "مساعدة واستفسارات", "Help and questions"),
        },
      ],
    },
  ];
}

function mapCategoryRow(category, lang = "ar") {
  const title =
    category?.name_ar ||
    category?.title_ar ||
    category?.name ||
    category?.title ||
    "قسم";
  const desc =
    category?.description_ar ||
    category?.description ||
    tr(lang, "اختر هذا القسم", "Select this category");
  const key =
    category?.category_key ||
    category?.slug ||
    category?.key ||
    category?.id;

  return {
    id: `order:category:${key}`,
    title,
    description: desc,
  };
}

function mapItemRow(item, lang = "ar") {
  const title =
    item?.name_ar ||
    item?.title_ar ||
    item?.name ||
    item?.title ||
    "صنف";
  const desc =
    item?.description_ar ||
    item?.description ||
    item?.short_description ||
    tr(lang, "اضغط للاختيار", "Tap to select");
  const key =
    item?.item_key ||
    item?.slug ||
    item?.key ||
    item?.id;

  return {
    id: `order:item:${key}`,
    title,
    description: desc,
  };
}

function mapOfferRow(offer, lang = "ar") {
  const title =
    offer?.name_ar ||
    offer?.title_ar ||
    offer?.name ||
    offer?.title ||
    "عرض";
  const desc =
    offer?.description_ar ||
    offer?.description ||
    tr(lang, "عرض متاح الآن", "Available offer");
  const key =
    offer?.offer_code ||
    offer?.offer_key ||
    offer?.slug ||
    offer?.id;

  return {
    id: `offer:item:${key}`,
    title,
    description: desc,
  };
}

function buildQuantitySections(lang = "ar") {
  return [
    {
      title: tr(lang, "الكمية", "Quantity"),
      rows: [
        {
          id: "order:qty:1",
          title: "1",
          description: tr(lang, "كمية 1", "Quantity 1"),
        },
        {
          id: "order:qty:2",
          title: "2",
          description: tr(lang, "كمية 2", "Quantity 2"),
        },
        {
          id: "order:qty:3",
          title: "3",
          description: tr(lang, "كمية 3", "Quantity 3"),
        },
        {
          id: "order:qty:4",
          title: "4",
          description: tr(lang, "كمية 4", "Quantity 4"),
        },
        {
          id: "order:qty:other",
          title: tr(lang, "كمية أخرى", "Other Quantity"),
          description: tr(lang, "أدخلها يدويًا", "Manual input"),
        },
      ],
    },
  ];
}

function buildPaymentSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الدفع", "Payment"),
      rows: [
        {
          id: "order:payment:cash",
          title: tr(lang, "كاش", "Cash"),
          description: tr(lang, "الدفع نقدًا", "Pay cash"),
        },
        {
          id: "order:payment:electronic",
          title: tr(lang, "تحويل / كليك", "Transfer / Click"),
          description: tr(lang, "تحويل إلكتروني", "Electronic payment"),
        },
      ],
    },
  ];
}

function buildNotesSections(lang = "ar") {
  return [
    {
      title: tr(lang, "الملاحظات", "Notes"),
      rows: [
        {
          id: "order:notes:none",
          title: tr(lang, "بدون ملاحظات", "No Notes"),
          description: tr(lang, "إكمال الطلب", "Continue"),
        },
        {
          id: "order:notes:add",
          title: tr(lang, "إضافة ملاحظة", "Add Note"),
          description: tr(lang, "اكتب ملاحظة للطلب", "Write a note"),
        },
      ],
    },
  ];
}

function buildTimeSections(lang = "ar") {
  return [
    {
      title: tr(lang, "وقت التوصيل", "Delivery Time"),
      rows: [
        {
          id: "order:time:asap",
          title: tr(lang, "أقرب وقت متاح", "Earliest Available"),
          description: tr(lang, "أقرب موعد ممكن", "Earliest possible"),
        },
        {
          id: "order:time:today",
          title: tr(lang, "اليوم", "Today"),
          description: tr(lang, "التوصيل اليوم", "Delivery today"),
        },
        {
          id: "order:time:tomorrow",
          title: tr(lang, "غدًا", "Tomorrow"),
          description: tr(lang, "التوصيل غدًا", "Delivery tomorrow"),
        },
        {
          id: "order:time:custom_slot",
          title: tr(lang, "تحديد وقت", "Choose Time Slot"),
          description: tr(lang, "اختر فترة زمنية", "Choose a time slot"),
        },
      ],
    },
  ];
}

function buildTimeSlotSections(lang = "ar") {
  const slots = CONFIG.orderFlow.availableTimeSlots || [];
  return [
    {
      title: tr(lang, "الفترات", "Time Slots"),
      rows: slots.slice(0, 10).map((slot, idx) => ({
        id: `order:time_slot:${idx + 1}`,
        title: String(slot),
        description: tr(lang, "اختر هذه الفترة", "Choose this slot"),
      })),
    },
  ];
}

function findTimeSlotByReplyId(id = "") {
  const m = String(id).match(/^order:time_slot:(\d+)$/);
  if (!m) return null;
  const index = Number(m[1]) - 1;
  const slots = CONFIG.orderFlow.availableTimeSlots || [];
  return slots[index] || null;
}

function buildFinalReviewText(context = {}, lang = "ar") {
  return tr(
    lang,
    `تم استلام تفاصيل طلبك مبدئيًا ✅

• الصنف: ${context.dish_name || context.dish || "-"}${context.protein ? ` ${context.protein}` : ""}
• الكمية: ${context.quantity || "-"}
• المنطقة: ${context.area || "-"}
• العنوان: ${context.address || "-"}
• الوقت: ${context.deliveryTime || "-"}
• طريقة الدفع: ${humanPaymentLabel(context.paymentMethod, lang)}
• الملاحظات: ${context.notes || "-"}

سيتم إرسال الطلب للإدارة للمراجعة.`,
    `Your order details were received successfully.`
  );
}

function buildAdminDraftText(phone, context = {}, lang = "ar") {
  return `طلب جديد بانتظار المراجعة
العميل: ${phone}
اللغة: ${lang}
الصنف: ${context.dish_name || context.dish || "-"} ${context.protein || ""}
الكمية: ${context.quantity || "-"}
المنطقة: ${context.area || "-"}
العنوان: ${context.address || "-"}
الوقت المطلوب: ${context.deliveryTime || "-"}
طريقة الدفع: ${humanPaymentLabel(context.paymentMethod, lang)}
الملاحظات: ${context.notes || "-"}
الحالة: awaiting_internal_review`;
}

function buildPauseReasonSections(lang = "ar") {
  return [
    {
      title: tr(lang, "سبب التوقف", "Pause Reason"),
      rows: [
        {
          id: "pause:reason:price",
          title: tr(lang, "السعر", "Price"),
          description: tr(lang, "أحتاج مراجعة السعر", "Need to review the price"),
        },
        {
          id: "pause:reason:time",
          title: tr(lang, "الوقت", "Time"),
          description: tr(lang, "الوقت غير مناسب", "Timing issue"),
        },
        {
          id: "pause:reason:delivery",
          title: tr(lang, "التوصيل", "Delivery"),
          description: tr(lang, "استفسار عن التوصيل", "Delivery concern"),
        },
        {
          id: "pause:reason:thinking",
          title: tr(lang, "أحتاج أفكر", "Need Time"),
          description: tr(lang, "سأكمل لاحقًا", "I will continue later"),
        },
        {
          id: "pause:reason:employee",
          title: tr(lang, "أفضل موظف", "Need Employee"),
          description: tr(lang, "أرغب بمتابعة مع موظف", "Talk to an employee"),
        },
        {
          id: "pause:reason:other",
          title: tr(lang, "سبب آخر", "Other Reason"),
          description: tr(lang, "أدخل السبب يدويًا", "Enter manually"),
        },
      ],
    },
  ];
}

async function notifyAdmins(message) {
  const admins = CONFIG.wa.adminNumbers || [];
  for (const admin of admins) {
    await sendTextMessage(admin, message);
  }
}

async function showHome(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(
      lang,
      "أهلاً وسهلاً بكم في مطبخ اليوم المركزي 🌙\nاختر من القائمة الرئيسية 👇",
      "Welcome to Matbakh Al Youm. Choose from the main menu 👇"
    ),
    listButtonText: tr(lang, "فتح", "Open"),
    sections: buildMainMenuSections(lang),
    footerText: tr(
      lang,
      "الأزرار بالأسفل: رجوع / موظف / خروج",
      "Quick controls below: Back / Employee / Exit"
    ),
  });
}

async function showOrderCategories(to, lang = "ar") {
  const categories = await getMenuCategories();
  const rows = categories.map((c) => mapCategoryRow(c, lang));

  if (!rows.length) {
    await sendTextMessage(
      to,
      tr(
        lang,
        "الأقسام غير متاحة حاليًا. تم تحويلك للرئيسية.",
        "Categories are not available right now."
      )
    );
    await showHome(to, lang);
    return;
  }

  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر القسم المناسب 👇", "Choose the right category 👇"),
    listButtonText: tr(lang, "الأقسام", "Categories"),
    sections: [{ title: tr(lang, "الأقسام", "Categories"), rows }],
  });
}

async function showMenuCategories(to, lang = "ar") {
  const categories = await getMenuCategories();
  const rows = categories.map((c) => ({
    ...mapCategoryRow(c, lang),
    id: `menu:category:${c?.category_key || c?.slug || c?.key || c?.id}`,
  }));

  if (!rows.length) {
    await sendTextMessage(
      to,
      tr(lang, "المنيو غير متاح حاليًا.", "Menu is not available right now.")
    );
    return;
  }

  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر قسم المنيو 👇", "Choose a menu category 👇"),
    listButtonText: tr(lang, "المنيو", "Menu"),
    sections: [{ title: tr(lang, "أقسام المنيو", "Menu Categories"), rows }],
  });
}

async function showItemsByCategory(to, categoryKey, lang = "ar") {
  const items = await getMenuItemsByCategory(categoryKey);
  const rows = items.map((item) => mapItemRow(item, lang));

  if (!rows.length) {
    await sendTextMessage(
      to,
      tr(lang, "لا توجد أصناف متاحة في هذا القسم.", "No items available in this category.")
    );
    return;
  }

  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر الصنف المطلوب 👇", "Choose the item 👇"),
    listButtonText: tr(lang, "الأصناف", "Items"),
    sections: [{ title: tr(lang, "الأصناف", "Items"), rows }],
  });
}

async function showOffers(to, lang = "ar") {
  const offers = await getActiveOffers();
  const rows = offers.map((offer) => mapOfferRow(offer, lang));

  if (!rows.length) {
    await sendTextMessage(
      to,
      tr(lang, "لا توجد عروض متاحة حاليًا.", "No active offers right now.")
    );
    return;
  }

  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "العروض الحالية 👇", "Current offers 👇"),
    listButtonText: tr(lang, "العروض", "Offers"),
    sections: [{ title: tr(lang, "العروض", "Offers"), rows }],
  });
}

async function showItemProtein(to, item, lang = "ar") {
  const body = tr(
    lang,
    `اختر النوع المناسب للصنف: ${item?.name_ar || item?.name || "الصنف"} 👇`,
    `Choose the protein type 👇`
  );

  await sendButtonsMessage(
    to,
    body,
    [
      { id: "order:protein:chicken", title: tr(lang, "دجاج", "Chicken") },
      { id: "order:protein:meat", title: tr(lang, "لحم", "Meat") },
      { id: "nav:back", title: tr(lang, "رجوع", "Back") },
    ],
    tr(lang, "يمكنك أيضًا التحويل لموظف أو الخروج.", "You can also hand off or exit.")
  );

  await sendButtonsMessage(
    to,
    tr(lang, "تحكم سريع 👇", "Quick control 👇"),
    [
      { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
      { id: "nav:exit", title: tr(lang, "خروج", "Exit") },
      { id: "nav:back", title: tr(lang, "رجوع", "Back") },
    ]
  );
}

async function showQuantity(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر الكمية 👇", "Choose quantity 👇"),
    listButtonText: tr(lang, "الكمية", "Quantity"),
    sections: buildQuantitySections(lang),
  });
}

async function showZones(to, lang = "ar") {
  const zones = await getDeliveryZones();

  let rows = [];
  if (zones.length) {
    rows = zones.slice(0, 9).map((zone) => ({
      id: `order:area:${zone?.zone_key || zone?.slug || zone?.id}`,
      title:
        zone?.name_ar ||
        zone?.title_ar ||
        zone?.area_name ||
        zone?.name ||
        "منطقة",
      description:
        zone?.description_ar ||
        zone?.description ||
        tr(lang, "اختر هذه المنطقة", "Choose this area"),
    }));
  }

  rows.push({
    id: "order:area:other",
    title: tr(lang, "منطقة أخرى", "Other Area"),
    description: tr(lang, "أدخلها يدويًا", "Manual input"),
  });

  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر المنطقة 👇", "Choose the area 👇"),
    listButtonText: tr(lang, "المناطق", "Areas"),
    sections: [{ title: tr(lang, "المناطق", "Areas"), rows }],
  });
}

async function showTimeOptions(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر وقت التوصيل 👇", "Choose delivery time 👇"),
    listButtonText: tr(lang, "الوقت", "Time"),
    sections: buildTimeSections(lang),
  });
}

async function showTimeSlots(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر الفترة المناسبة 👇", "Choose a suitable slot 👇"),
    listButtonText: tr(lang, "الفترات", "Slots"),
    sections: buildTimeSlotSections(lang),
  });
}

async function showPaymentOptions(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "اختر طريقة الدفع 👇", "Choose payment method 👇"),
    listButtonText: tr(lang, "الدفع", "Payment"),
    sections: buildPaymentSections(lang),
  });
}

async function showNotesOptions(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(lang, "هل لديك ملاحظات على الطلب؟ 👇", "Do you have order notes? 👇"),
    listButtonText: tr(lang, "الملاحظات", "Notes"),
    sections: buildNotesSections(lang),
  });
}

async function showPauseReasons(to, lang = "ar") {
  await sendHybridScreen({
    to,
    lang,
    body: tr(
      lang,
      "قبل إنهاء المسار، ما سبب التوقف؟ 👇",
      "Before exiting, what is the reason for stopping? 👇"
    ),
    listButtonText: tr(lang, "السبب", "Reason"),
    sections: buildPauseReasonSections(lang),
  });
}

function needsProteinChoice(item = {}) {
  const text = `${item?.name_ar || ""} ${item?.name || ""} ${item?.description_ar || ""} ${item?.description || ""}`;
  return /مقلوبة|maqluba|محاشي|mahashi/i.test(text);
}

function buildOrderContextFromItem(item = {}, existing = {}) {
  return setContextStep(
    {
      ...existing,
      flow: "order",
      item_key: item?.item_key || item?.slug || item?.key || item?.id,
      dish: item?.item_key || item?.slug || item?.key || item?.id,
      dish_name: item?.name_ar || item?.name || "صنف",
      category_key: item?.category_key || existing?.category_key || null,
    },
    "ITEM_SELECTED"
  );
}

function applyBackStep(state, context) {
  const prev = previousStep(context);
  if (!prev) {
    return {
      state: "START",
      context: setContextStep({}, "START"),
    };
  }

  return {
    state,
    context: {
      ...context,
      _history: prev.history,
      _current_step: prev.step,
      _last_step: prev.step,
    },
  };
}

async function resumeStepView(to, stateRow, lang = "ar") {
  const { state, context } = getStateEnvelope(stateRow);
  const currentStep = context?._current_step || state || "START";

  if (currentStep === "START") {
    await showHome(to, lang);
    return;
  }

  if (currentStep === "VIEWING_ORDER_CATEGORIES") {
    await showOrderCategories(to, lang);
    return;
  }

  if (currentStep === "VIEWING_MENU_CATEGORIES") {
    await showMenuCategories(to, lang);
    return;
  }

  if (currentStep === "VIEWING_OFFERS") {
    await showOffers(to, lang);
    return;
  }

  if (currentStep === "VIEWING_ITEMS" && context?.category_key) {
    await showItemsByCategory(to, context.category_key, lang);
    return;
  }

  if (currentStep === "WAITING_PROTEIN" && context?.item_key) {
    const item = await getMenuItemByKey(context.item_key);
    if (item) {
      await showItemProtein(to, item, lang);
      return;
    }
  }

  if (currentStep === "WAITING_QUANTITY") {
    await showQuantity(to, lang);
    return;
  }

  if (currentStep === "WAITING_AREA") {
    await showZones(to, lang);
    return;
  }

  if (currentStep === "WAITING_ADDRESS") {
    await sendTextMessage(
      to,
      tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address.")
    );
    await sendControlButtons(to, lang);
    return;
  }

  if (currentStep === "WAITING_TIME") {
    await showTimeOptions(to, lang);
    return;
  }

  if (currentStep === "WAITING_TIME_SLOT") {
    await showTimeSlots(to, lang);
    return;
  }

  if (currentStep === "WAITING_PAYMENT") {
    await showPaymentOptions(to, lang);
    return;
  }

  if (currentStep === "WAITING_NOTES_DECISION") {
    await showNotesOptions(to, lang);
    return;
  }

  if (currentStep === "WAITING_NOTES_TEXT") {
    await sendTextMessage(
      to,
      tr(lang, "أرسل الملاحظة من فضلك.", "Please send your note.")
    );
    await sendControlButtons(to, lang);
    return;
  }

  if (currentStep === "WAITING_CUSTOM_QUANTITY") {
    await sendTextMessage(
      to,
      tr(lang, "أرسل الكمية المطلوبة بالأرقام من فضلك.", "Please send the quantity in numbers.")
    );
    await sendControlButtons(to, lang);
    return;
  }

  if (currentStep === "WAITING_CUSTOM_AREA") {
    await sendTextMessage(
      to,
      tr(lang, "أرسل اسم المنطقة من فضلك.", "Please send the area name.")
    );
    await sendControlButtons(to, lang);
    return;
  }

  if (currentStep === "WAITING_PAUSE_REASON") {
    await showPauseReasons(to, lang);
    return;
  }

  await showHome(to, lang);
}

async function sendToAdminAndSaveOrder(from, customer, stateRow, lang = "ar") {
  const context = stripSystemContext(stateRow?.context || {});

  const order = await createDraftOrder({
    phone: from,
    customerId: customer?.id || null,
    items: [
      {
        dish: context.dish_name || context.dish || null,
        protein: context.protein || null,
        quantity: context.quantity || null,
      },
    ],
    subtotal: null,
    deliveryArea: context.area || null,
    deliveryAddress: context.address || null,
    paymentMethod: context.paymentMethod || null,
    requestedDeliveryTime: context.deliveryTime || null,
    customerNotes: context.notes || null,
  });

  await saveCustomerFact(from, "last_area", { area: context.area || null });
  await saveCustomerFact(from, "favorite_dish_candidate", {
    dish: context.dish_name || context.dish || null,
    protein: context.protein || null,
  });
  await saveCustomerFact(from, "last_draft_order", {
    order_id: order?.id || null,
    context,
  });

  await notifyAdmins(buildAdminDraftText(from, context, lang));

  const nextContext = setContextStep(
    {
      ...stateRow.context,
      order_id: order?.id || null,
      last_submitted_at: new Date().toISOString(),
    },
    "AWAITING_INTERNAL_REVIEW"
  );

  await writeChatState(from, "AWAITING_INTERNAL_REVIEW", nextContext);

  await sendTextMessage(from, buildFinalReviewText(context, lang));

  await sendButtonsMessage(
    from,
    tr(
      lang,
      "اختر الإجراء المناسب 👇",
      "Choose the next action 👇"
    ),
    [
      { id: "final:confirm", title: tr(lang, "تثبيت الطلب", "Confirm") },
      { id: "final:modify", title: tr(lang, "تعديل", "Modify") },
      { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
    ]
  );

  return order;
}

async function handoffToEmployee(from, stateRow, lang = "ar") {
  const context = stateRow?.context || {};
  await saveCustomerFact(from, "needs_human_handoff", {
    value: true,
    requested_at: new Date().toISOString(),
    context: stripSystemContext(context),
  });

  await notifyAdmins(
    `طلب تحويل لموظف
العميل: ${from}
الحالة الحالية: ${stateRow?.state || "START"}
الخطوة: ${context?._current_step || "-"}`
  );

  await sendTextMessage(
    from,
    tr(
      lang,
      "تم تحويل طلبك إلى أحد الموظفين، وسيتم متابعته معك.",
      "Your request has been handed to an employee."
    )
  );

  return true;
}

async function handleControlAction({ from, id, stateRow, lang }) {
  if (id === "nav:handoff") {
    await handoffToEmployee(from, stateRow, lang);
    return true;
  }

  if (id === "nav:exit") {
    const ctx = stateRow?.context || {};
    const hasDraft = Boolean(
      ctx?.dish || ctx?.dish_name || ctx?.address || ctx?.quantity
    );

    if (hasDraft) {
      const nextContext = setContextStep(
        {
          ...ctx,
          paused_at: new Date().toISOString(),
        },
        "WAITING_PAUSE_REASON"
      );
      await writeChatState(from, "WAITING_PAUSE_REASON", nextContext);
      await showPauseReasons(from, lang);
    } else {
      await clearChatState(from);
      await sendTextMessage(
        from,
        tr(
          lang,
          "تم إنهاء العملية الحالية. يسعدني خدمتك في أي وقت 🌿",
          "The current flow was closed."
        )
      );
      await showHome(from, lang);
    }
    return true;
  }

  if (id === "nav:back") {
    const ctx = stateRow?.context || {};
    const applied = applyBackStep(stateRow?.state || "START", ctx);
    await writeChatState(from, applied.state, applied.context);
    const newState = await readChatState(from);
    await resumeStepView(from, newState, lang);
    return true;
  }

  return false;
}

async function handleTextByState({ from, text, stateRow, lang, customer }) {
  const state = stateRow?.state || "START";
  const context = { ...(stateRow?.context || {}) };
  const cleaned = cleanText(text);

  if (state === "WAITING_CUSTOM_QUANTITY") {
    const q = parseNumericQuantity(cleaned);
    if (!q) {
      await sendTextMessage(
        from,
        tr(lang, "أرسل رقم الكمية فقط من فضلك.", "Please send the quantity as a number only.")
      );
      await sendControlButtons(from, lang);
      return true;
    }

    const nextContext = setContextStep(
      {
        ...context,
        quantity: q,
      },
      "WAITING_AREA"
    );

    await writeChatState(from, "WAITING_AREA", nextContext);
    await showZones(from, lang);
    return true;
  }

  if (state === "WAITING_CUSTOM_AREA") {
    const nextContext = setContextStep(
      {
        ...context,
        area: cleaned,
      },
      "WAITING_ADDRESS"
    );
    await writeChatState(from, "WAITING_ADDRESS", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (state === "WAITING_ADDRESS") {
    const nextContext = setContextStep(
      {
        ...context,
        address: cleaned,
      },
      "WAITING_TIME"
    );
    await writeChatState(from, "WAITING_TIME", nextContext);
    await showTimeOptions(from, lang);
    return true;
  }

  if (state === "WAITING_NOTES_TEXT") {
    const nextContext = setContextStep(
      {
        ...context,
        notes: cleaned,
      },
      "AWAITING_INTERNAL_REVIEW"
    );
    await writeChatState(from, "READY_TO_SUBMIT", nextContext);
    const latest = await readChatState(from);
    await sendToAdminAndSaveOrder(from, customer, latest, lang);
    return true;
  }

  if (state === "WAITING_PAUSE_REASON") {
    const nextContext = setContextStep(
      {
        ...context,
        abandoned_reason: cleaned,
        paused_reason_at: new Date().toISOString(),
      },
      "START"
    );
    await saveCustomerFact(from, "abandoned_reason", {
      reason: cleaned,
      at: new Date().toISOString(),
      context: stripSystemContext(context),
    });
    await writeChatState(from, "START", nextContext);
    await sendTextMessage(
      from,
      tr(
        lang,
        "تم حفظ سبب التوقف. يمكنك العودة وإكمال الطلب في أي وقت.",
        "The pause reason has been saved. You can continue anytime."
      )
    );
    await showHome(from, lang);
    return true;
  }

  if (state === "START") {
    if (isGreeting(cleaned)) {
      await showHome(from, lang);
      return true;
    }

    const knowledge = await getKnowledgeAnswer(cleaned);
    if (knowledge) {
      await sendTextMessage(from, knowledge);
      await sendControlButtons(from, lang);
      return true;
    }

    if (!isInsideOperatingWindow() && isOrderLikeText(cleaned)) {
      const last = await getLastOpenDraftOrder(from);
      const body = last
        ? tr(
            lang,
            "خارج وقت التشغيل حاليًا، ويمكنني حفظ أو استكمال طلبك مبدئيًا لحين المتابعة.",
            "Outside operating hours. I can save or resume your draft order."
          )
        : tr(
            lang,
            "خارج وقت التشغيل حاليًا، ويمكنني تسجيل طلبك مبدئيًا لحين المتابعة.",
            "Outside operating hours. I can save your order as a draft."
          );

      await sendButtonsMessage(
        from,
        body,
        [
          { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
          { id: "home:menu", title: tr(lang, "المنيو", "Menu") },
          { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
        ]
      );
      return true;
    }
  }

  return false;
}

async function handleInteractiveSelection({ from, id, lang, customer }) {
  const stateRow = await readChatState(from);
  const current = getStateEnvelope(stateRow);
  const context = { ...current.context };

  if (isControlId(id)) {
    return handleControlAction({ from, id, stateRow, lang });
  }

  if (id === "home:start_order") {
    const nextContext = setContextStep(
      {
        ...context,
        flow: "order",
      },
      "VIEWING_ORDER_CATEGORIES"
    );
    await writeChatState(from, "VIEWING_ORDER_CATEGORIES", nextContext);
    await showOrderCategories(from, lang);
    return true;
  }

  if (id === "home:menu") {
    const nextContext = setContextStep(
      {
        ...context,
        flow: "menu",
      },
      "VIEWING_MENU_CATEGORIES"
    );
    await writeChatState(from, "VIEWING_MENU_CATEGORIES", nextContext);
    await showMenuCategories(from, lang);
    return true;
  }

  if (id === "home:offers") {
    const nextContext = setContextStep(
      {
        ...context,
        flow: "offers",
      },
      "VIEWING_OFFERS"
    );
    await writeChatState(from, "VIEWING_OFFERS", nextContext);
    await showOffers(from, lang);
    return true;
  }

  if (id === "home:track") {
    const last = await getLastOpenDraftOrder(from);
    if (!last) {
      await sendTextMessage(
        from,
        tr(lang, "لا يوجد طلب حديث ظاهر حاليًا.", "No recent order was found.")
      );
      await showHome(from, lang);
      return true;
    }

    await sendTextMessage(
      from,
      tr(
        lang,
        `آخر طلب:
• الرقم: ${last.order_code || last.shortcode || last.id || "-"}
• الحالة: ${last.status_label || last.status || "-"}
• الوقت: ${last.delivery_time || last.requested_time || "-"}
• المنطقة: ${last.delivery_area_name || last.delivery_area || last.area || "-"}
`,
        `Latest order found.`
      )
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id === "home:support") {
    await sendButtonsMessage(
      from,
      tr(
        lang,
        "يسعدني خدمتك. اختر الإجراء المناسب 👇",
        "Choose the support action 👇"
      ),
      [
        { id: "support:product", title: tr(lang, "استفسار صنف", "Product") },
        { id: "support:delivery", title: tr(lang, "التوصيل", "Delivery") },
        { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
      ]
    );
    return true;
  }

  if (id.startsWith("support:")) {
    await handoffToEmployee(from, stateRow, lang);
    return true;
  }

  if (id.startsWith("menu:category:")) {
    const categoryKey = id.replace("menu:category:", "");
    const nextContext = setContextStep(
      {
        ...context,
        flow: "menu",
        category_key: categoryKey,
      },
      "VIEWING_ITEMS"
    );
    await writeChatState(from, "VIEWING_ITEMS", nextContext);
    await showItemsByCategory(from, categoryKey, lang);
    return true;
  }

  if (id.startsWith("order:category:")) {
    const categoryKey = id.replace("order:category:", "");
    const nextContext = setContextStep(
      {
        ...context,
        flow: "order",
        category_key: categoryKey,
      },
      "VIEWING_ITEMS"
    );
    await writeChatState(from, "VIEWING_ITEMS", nextContext);
    await showItemsByCategory(from, categoryKey, lang);
    return true;
  }

  if (id.startsWith("order:item:")) {
    const itemKey = id.replace("order:item:", "");
    const item = await getMenuItemByKey(itemKey);

    if (!item) {
      await sendTextMessage(
        from,
        tr(lang, "هذا الصنف غير متاح حاليًا.", "This item is not available right now.")
      );
      return true;
    }

    const nextContext = buildOrderContextFromItem(item, context);

    if (needsProteinChoice(item)) {
      const ctx = setContextStep(nextContext, "WAITING_PROTEIN");
      await writeChatState(from, "WAITING_PROTEIN", ctx);
      await showItemProtein(from, item, lang);
      return true;
    }

    const ctx = setContextStep(nextContext, "WAITING_QUANTITY");
    await writeChatState(from, "WAITING_QUANTITY", ctx);
    await showQuantity(from, lang);
    return true;
  }

  if (id === "order:protein:chicken" || id === "order:protein:meat") {
    const protein = id.endsWith("chicken") ? "دجاج" : "لحم";
    const nextContext = setContextStep(
      {
        ...context,
        protein,
      },
      "WAITING_QUANTITY"
    );
    await writeChatState(from, "WAITING_QUANTITY", nextContext);
    await showQuantity(from, lang);
    return true;
  }

  if (id === "order:qty:other") {
    const nextContext = setContextStep(context, "WAITING_CUSTOM_QUANTITY");
    await writeChatState(from, "WAITING_CUSTOM_QUANTITY", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "أرسل الكمية المطلوبة بالأرقام من فضلك.", "Please send the quantity in numbers.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id.startsWith("order:qty:")) {
    const qty = id.replace("order:qty:", "");
    const nextContext = setContextStep(
      {
        ...context,
        quantity: qty,
      },
      "WAITING_AREA"
    );
    await writeChatState(from, "WAITING_AREA", nextContext);
    await showZones(from, lang);
    return true;
  }

  if (id === "order:area:other") {
    const nextContext = setContextStep(context, "WAITING_CUSTOM_AREA");
    await writeChatState(from, "WAITING_CUSTOM_AREA", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "أرسل اسم المنطقة من فضلك.", "Please send the area name.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id.startsWith("order:area:")) {
    const areaKey = id.replace("order:area:", "");
    const zones = await getDeliveryZones();
    const zone = zones.find((z) => normalizeKey(z?.zone_key || z?.slug || z?.id) === normalizeKey(areaKey));
    const areaName =
      zone?.name_ar ||
      zone?.title_ar ||
      zone?.area_name ||
      zone?.name ||
      areaKey;

    const nextContext = setContextStep(
      {
        ...context,
        area: areaName,
        area_key: areaKey,
      },
      "WAITING_ADDRESS"
    );

    await writeChatState(from, "WAITING_ADDRESS", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "أرسل العنوان بالتفصيل من فضلك.", "Please send the full address.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id === "order:time:custom_slot") {
    const nextContext = setContextStep(context, "WAITING_TIME_SLOT");
    await writeChatState(from, "WAITING_TIME_SLOT", nextContext);
    await showTimeSlots(from, lang);
    return true;
  }

  if (id === "order:time:asap" || id === "order:time:today" || id === "order:time:tomorrow") {
    const map = {
      "order:time:asap": tr(lang, "أقرب وقت متاح", "Earliest available"),
      "order:time:today": tr(lang, "اليوم", "Today"),
      "order:time:tomorrow": tr(lang, "غدًا", "Tomorrow"),
    };

    const nextContext = setContextStep(
      {
        ...context,
        deliveryTime: map[id],
      },
      "WAITING_PAYMENT"
    );
    await writeChatState(from, "WAITING_PAYMENT", nextContext);
    await showPaymentOptions(from, lang);
    return true;
  }

  if (id.startsWith("order:time_slot:")) {
    const slot = findTimeSlotByReplyId(id);
    const nextContext = setContextStep(
      {
        ...context,
        deliveryTime: slot || context.deliveryTime || null,
      },
      "WAITING_PAYMENT"
    );
    await writeChatState(from, "WAITING_PAYMENT", nextContext);
    await showPaymentOptions(from, lang);
    return true;
  }

  if (id === "order:payment:cash" || id === "order:payment:electronic") {
    const paymentMethod = id.endsWith("cash") ? "cash" : "electronic";
    const nextContext = setContextStep(
      {
        ...context,
        paymentMethod,
      },
      "WAITING_NOTES_DECISION"
    );
    await writeChatState(from, "WAITING_NOTES_DECISION", nextContext);
    await showNotesOptions(from, lang);
    return true;
  }

  if (id === "order:notes:none") {
    const nextContext = setContextStep(
      {
        ...context,
        notes: null,
      },
      "AWAITING_INTERNAL_REVIEW"
    );
    await writeChatState(from, "READY_TO_SUBMIT", nextContext);
    const latest = await readChatState(from);
    await sendToAdminAndSaveOrder(from, customer, latest, lang);
    return true;
  }

  if (id === "order:notes:add") {
    const nextContext = setContextStep(context, "WAITING_NOTES_TEXT");
    await writeChatState(from, "WAITING_NOTES_TEXT", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "أرسل الملاحظة من فضلك.", "Please send your note.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id === "final:confirm") {
    const nextContext = setContextStep(
      {
        ...context,
        customer_final_action: "confirmed",
        customer_final_action_at: new Date().toISOString(),
      },
      "CUSTOMER_CONFIRMED"
    );
    await writeChatState(from, "CUSTOMER_CONFIRMED", nextContext);
    await sendTextMessage(
      from,
      tr(
        lang,
        "رائع 🌿 تم تثبيت طلبك النهائي وبدأت إجراءات التنفيذ.",
        "Great. Your order has been confirmed and execution has started."
      )
    );
    await notifyAdmins(`تم تثبيت الطلب نهائيًا من العميل: ${from}`);
    return true;
  }

  if (id === "final:modify") {
    const nextContext = setContextStep(
      {
        ...context,
        customer_change_request: true,
      },
      "VIEWING_ORDER_CATEGORIES"
    );
    await writeChatState(from, "VIEWING_ORDER_CATEGORIES", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "سنقوم بإعادة فتح الطلب للتعديل.", "We will reopen the order for modification.")
    );
    await showOrderCategories(from, lang);
    return true;
  }

  if (id === "pause:reason:other") {
    const nextContext = setContextStep(context, "WAITING_PAUSE_REASON");
    await writeChatState(from, "WAITING_PAUSE_REASON", nextContext);
    await sendTextMessage(
      from,
      tr(lang, "اكتب سبب التوقف من فضلك.", "Please type the reason for pausing.")
    );
    await sendControlButtons(from, lang);
    return true;
  }

  if (id.startsWith("pause:reason:")) {
    const reasonMap = {
      "pause:reason:price": tr(lang, "السعر", "Price"),
      "pause:reason:time": tr(lang, "الوقت", "Time"),
      "pause:reason:delivery": tr(lang, "التوصيل", "Delivery"),
      "pause:reason:thinking": tr(lang, "أحتاج أفكر", "Need Time"),
      "pause:reason:employee": tr(lang, "أفضل موظف", "Prefer Employee"),
    };
    const reason = reasonMap[id] || id;

    await saveCustomerFact(from, "abandoned_reason", {
      reason,
      at: new Date().toISOString(),
      context: stripSystemContext(context),
    });

    const nextContext = setContextStep(
      {
        ...context,
        abandoned_reason: reason,
      },
      "START"
    );

    await writeChatState(from, "START", nextContext);

    if (id === "pause:reason:employee") {
      await handoffToEmployee(from, stateRow, lang);
      return true;
    }

    await sendTextMessage(
      from,
      tr(
        lang,
        "تم حفظ سبب التوقف، ويمكنك العودة وإكمال الطلب في أي وقت.",
        "The pause reason was saved. You can continue anytime."
      )
    );
    await showHome(from, lang);
    return true;
  }

  if (id.startsWith("offer:item:")) {
    await sendTextMessage(
      from,
      tr(
        lang,
        "تم اختيار العرض. سيظهر ربط الطلب بالعروض في المرحلة التالية.",
        "Offer selected. Offer ordering will be linked in the next step."
      )
    );
    await sendButtonsMessage(
      from,
      tr(lang, "اختر الإجراء التالي 👇", "Choose the next action 👇"),
      [
        { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
        { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
        { id: "nav:back", title: tr(lang, "رجوع", "Back") },
      ]
    );
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
    await showHome(from, lang);
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
    const nextContext = setContextStep({}, "START");
    await writeChatState(from, "START", nextContext);
    await showHome(from, lang);
    await logConversation({
      customerId: customer?.id || null,
      phone: from,
      incomingText: cleaned,
      botReplyText: "home",
      messageType: "text",
      detectedLanguage: lang,
      intent: "greeting",
    });
    return { ok: true };
  }

  const knowledge = await getKnowledgeAnswer(cleaned);
  if (knowledge) {
    await sendTextMessage(from, knowledge);
    await sendControlButtons(from, lang);
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

  if (!isInsideOperatingWindow() && isOrderLikeText(cleaned)) {
    await sendButtonsMessage(
      from,
      tr(
        lang,
        "خارج وقت التشغيل حاليًا، ويمكنني تسجيل الطلب مبدئيًا أو تحويلك لموظف.",
        "Outside operating hours. I can save a draft order or hand you to an employee."
      ),
      [
        { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order") },
        { id: "nav:handoff", title: tr(lang, "موظف", "Employee") },
        { id: "nav:back", title: tr(lang, "رجوع", "Back") },
      ]
    );
    return { ok: true };
  }

  await showHome(from, lang);

  await logConversation({
    customerId: customer?.id || null,
    phone: from,
    incomingText: cleaned,
    botReplyText: "home",
    messageType: "text",
    detectedLanguage: lang,
    intent: "fallback",
  });

  return { ok: true };
}

export async function processInteractiveReply({
  from,
  interactiveId,
  interactiveTitle = "",
}) {
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
الحالة الحالية: customer_confirmed`);

  await writeChatState(
    from,
    "CUSTOMER_CONFIRMED",
    setContextStep(
      {
        ...(stateRow.context || {}),
        customer_final_action: "confirmed",
        customer_final_action_at: new Date().toISOString(),
      },
      "CUSTOMER_CONFIRMED"
    )
  );

  await sendTextMessage(
    from,
    tr(
      detectLanguage(text),
      "تم تأكيد طلبك بنجاح. نعمل الآن على متابعته حتى التسليم.",
      "Your order has been confirmed successfully."
    )
  );

  return true;
}

export async function resetConversation(from) {
  await clearChatState(from);
}
