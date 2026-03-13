import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";
import {
  buildOfferCartItem,
  buildProductCartItem,
  calculateCartSummary,
  getExclusiveOffers,
  getOfferByCode,
  getProductByKey,
  getProductsBySection,
  getSections,
  getSuggestedOffers,
  getZoneById,
  offerLabel
} from "./menu.js";
import { sendButtons, sendList, sendText } from "./meta.js";
import { analyzeCustomerText } from "./brain.js";
import {
  createCustomerFeedback,
  createFranchiseLead,
  createJobApplication,
  createOrder,
  createSupportRequest,
  getApprovalPolicySetting,
  getCustomer,
  getOrCreateCustomer,
  getOrder,
  getSession,
  logAdminAction,
  markCustomerOutgoing,
  resetSession,
  touchCustomer,
  updateOrder,
  upsertSession,
  logConversationMessage,
  listRecentConversationMessages,
  upsertCustomerFact
} from "./supabase.js";
import {
  availableSameDaySlots,
  compactText,
  formatMoney,
  isEnglishLanguage,
  isPositiveInteger,
  makeButtonId,
  normalizeLanguage,
  normalizePhone,
  orderSerialLabel,
  parseDateInput,
  parseInteractiveChoice,
  todayInTimezone
} from "./utils.js";

const db = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const GOVERNORATE_ROWS = [
  { id: "amman", title: "عمّان", description: "3.00 JOD" },
  { id: "amman_outer", title: "أطراف عمّان", description: "4.00 JOD" },
  { id: "governorates", title: "المحافظات والقرى", description: "من 5.00 JOD" }
];

const JORDAN_GOVERNORATES = [
  "إربد", "الزرقاء", "البلقاء", "مادبا", "الكرك", "الطفيلة",
  "معان", "العقبة", "جرش", "عجلون", "المفرق"
];

const SUPPORT_TYPES = [
  { key: "suggestion", ar: "اقتراح", en: "Suggestion" },
  { key: "note", ar: "ملاحظة", en: "Note" },
  { key: "complaint", ar: "شكوى", en: "Complaint" },
  { key: "thanks", ar: "شكر", en: "Thanks" }
];

const PARTNER_TYPES = [
  { key: "job_applicant", ar: "أرغب بوظيفة", en: "Job Application", contactType: "job_applicant" },
  { key: "seller", ar: "بائع", en: "Seller", contactType: "seller" },
  { key: "supplier", ar: "مورد", en: "Supplier", contactType: "supplier" }
];

function tr(lang, ar, en) {
  return isEnglishLanguage(lang) ? en : ar;
}

function parseCommand(message) {
  const raw = String(parseInteractiveChoice(message) || "").trim();
  if (!raw) return { type: "empty", value: "" };

  if (raw.startsWith("lang:")) return { type: "lang", value: raw.split(":")[1] };
  if (raw.startsWith("home:")) return { type: "home", value: raw.split(":")[1] };
  if (raw.startsWith("section:")) return { type: "section", value: raw.split(":")[1] };
  if (raw.startsWith("product:")) {
    const [, sectionId, productKey] = raw.split(":");
    return { type: "product", value: { sectionId, productKey } };
  }
  if (raw.startsWith("choice:")) {
    const parts = raw.split(":");
    return {
      type: "choice",
      value: {
        name: parts[1],
        a: parts[2] || "",
        b: parts[3] || "",
        c: parts[4] || ""
      }
    };
  }
  if (raw.startsWith("offergrp:")) return { type: "offergrp", value: raw.split(":")[1] };
  if (raw.startsWith("offer:")) return { type: "offer", value: raw.split(":")[1] };
  if (raw.startsWith("offermode:")) {
    const [, mode, code] = raw.split(":");
    return { type: "offermode", value: { mode, code } };
  }
  if (raw.startsWith("nav:back:")) return { type: "nav_back", value: raw.substring("nav:back:".length) };
  if (raw === "nav:cancel") return { type: "nav_cancel", value: "" };
  if (raw === "action:staff") return { type: "staff", value: "" };
  if (raw.startsWith("support:")) return { type: "support", value: raw.split(":")[1] };
  if (raw.startsWith("partner:")) return { type: "partner", value: raw.split(":")[1] };
  if (raw.startsWith("final:")) {
    const [, action, orderId] = raw.split(":");
    return { type: "final", value: { action, orderId } };
  }
  return { type: "text", value: raw };
}

function isStartText(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["ابدأ", "ابدء", "start", "menu", "home", "الرئيسية", "القائمة"].includes(raw);
}

async function safeSendText(to, text, meta = {}) {
  await sendText(to, text);
  await markCustomerOutgoing(to).catch(() => null);
  await logConversationMessage({ customerPhone: to, direction: 'outbound', text, intent: meta.intent || null, payload: meta }).catch(() => null);
}

async function safeSendButtons(to, body, buttons, footer = null, meta = {}) {
  await sendButtons(to, body, buttons, footer);
  await markCustomerOutgoing(to).catch(() => null);
  await logConversationMessage({ customerPhone: to, direction: 'outbound', text: body, messageType: 'interactive_buttons', intent: meta.intent || null, payload: { ...meta, buttons, footer } }).catch(() => null);
}

async function safeSendList(to, body, buttonText, sections, footer = null, meta = {}) {
  await sendList(to, body, buttonText, sections, footer);
  await markCustomerOutgoing(to).catch(() => null);
  await logConversationMessage({ customerPhone: to, direction: 'outbound', text: body, messageType: 'interactive_list', intent: meta.intent || null, payload: { ...meta, buttonText, sections, footer } }).catch(() => null);
}


async function sendControlButtons(to, lang, backContext, includeStaff = false) {
  const buttons = [];
  if (backContext) buttons.push({ id: `nav:back:${backContext}`, title: tr(lang, "رجوع", "Back") });
  buttons.push({ id: "nav:cancel", title: tr(lang, "خروج", "Exit") });

  return safeSendButtons(
    to,
    tr(lang, "اختر الإجراء المناسب 👇", "Choose the next action 👇"),
    buttons
  );
}

function homeRows(lang) {
  return [
    { id: "home:start_order", title: tr(lang, "ابدأ الطلب", "Start Order"), description: tr(lang, "الطلب المباشر من المنيو", "Order directly from the menu") },
    { id: "home:prices_menu", title: tr(lang, "الأسعار والمنيو", "Prices & Menu"), description: tr(lang, "استعراض الأصناف والأسعار", "Browse products and prices") },
    { id: "home:exclusive_offers", title: tr(lang, "العروض الحصرية", "Exclusive Offers"), description: tr(lang, "عروض خاصة وحصرية", "Exclusive special offers") },
    { id: "home:track_order", title: tr(lang, "تتبع طلبي", "Track My Order"), description: tr(lang, "آخر حالة للطلب", "See the latest order status") },
    { id: "home:franchise", title: tr(lang, "امتياز العلامة التجارية", "Franchise"), description: tr(lang, "طلب امتياز داخل الأردن أو خارجه", "Franchise interest inside or outside Jordan") },
    { id: "home:partners", title: tr(lang, "وظائف وتعاون", "Jobs & Partnerships"), description: tr(lang, "وظيفة أو بائع أو مورد", "Job, seller, or supplier") }
  ];
}

function supportTypeLabel(lang, key) {
  const found = SUPPORT_TYPES.find((item) => item.key === key);
  return found ? tr(lang, found.ar, found.en) : key;
}

async function sendLanguageMenu(to) {
  return safeSendButtons(
    to,
    compactText([
      `أهلًا بك في ${CONFIG.business.name} 🌿`,
      "اختر اللغة المناسبة للمتابعة",
      "",
      "Choose your preferred language"
    ]),
    [
      { id: "lang:ar", title: "العربية" },
      { id: "lang:en", title: "English" }
    ]
  );
}

async function sendHomeMenu(to, lang) {
  return safeSendList(
    to,
    tr(
      lang,
      compactText([
        "أهلًا بك من جديد 🌿",
        "شيف اليوم جاهز يرتّب طلبك بكل ذوق وجودة وخدمة تليق بك.",
        "",
        "اختر ما يناسبك من القائمة التالية 💛"
      ]),
      compactText([
        "Welcome back 🌿",
        "Chef Alyoum is ready to arrange your order with quality, care, and smooth service.",
        "",
        "Choose what suits you from the menu below 💛"
      ])
    ),
    tr(lang, "القائمة الرئيسية", "Main Menu"),
    [{ title: tr(lang, "خيارات الخدمة", "Service Options"), rows: homeRows(lang) }],
    CONFIG.business.name
  );
}

async function sendSectionMenu(to, lang, backContext = "home") {
  const sections = await getSections();

  await safeSendList(
    to,
    tr(lang, "اختر القسم المطلوب 👇", "Choose the section you want 👇"),
    tr(lang, "الأقسام", "Sections"),
    [
      {
        title: tr(lang, "أقسام الطلب", "Order Sections"),
        rows: sections.map((section) => ({
          id: `section:${section.id}`,
          title: section.title,
          description: tr(lang, "عرض الأصناف", "View products")
        }))
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, backContext, true);
}

function descriptionForProduct(product, lang) {
  if (product.kind === "chicken") {
    return tr(lang, `يبدأ من ${formatMoney(product.oneUnitPrice, CONFIG.business.currency)}`, `Starts from ${formatMoney(product.oneUnitPrice, CONFIG.business.currency)}`);
  }
  if (product.kind === "main") {
    return tr(lang, `سعر 4 أشخاص: ${formatMoney(product.fourPeoplePrice || 0, CONFIG.business.currency)}`, `4 people price: ${formatMoney(product.fourPeoplePrice || 0, CONFIG.business.currency)}`);
  }
  if (product.kind === "meat") {
    const firstType = Object.values(product.meatTypes || {})[0];
    return tr(lang, `يبدأ من ${formatMoney(firstType?.oneKgPrice || 0, CONFIG.business.currency)} / 1 كيلو`, `Starts from ${formatMoney(firstType?.oneKgPrice || 0, CONFIG.business.currency)} / 1 kg`);
  }
  if (product.kind === "mahashi") {
    return tr(lang, `${formatMoney(product.oneKgPrice || 0, CONFIG.business.currency)} / 1 كيلو`, `${formatMoney(product.oneKgPrice || 0, CONFIG.business.currency)} / 1 kg`);
  }
  if (product.kind === "simple") {
    const firstSize = product.sizes?.[0];
    return tr(lang, `يبدأ من ${formatMoney(firstSize?.unitPrice || 0, CONFIG.business.currency)}`, `Starts from ${formatMoney(firstSize?.unitPrice || 0, CONFIG.business.currency)}`);
  }
  return "";
}

async function sendProductsMenu(to, lang, sectionId, backContext = "sections") {
  const products = await getProductsBySection(sectionId);

  await safeSendList(
    to,
    tr(lang, "اختر الصنف المطلوب 👇", "Choose the required item 👇"),
    tr(lang, "الأصناف", "Products"),
    [
      {
        title: tr(lang, "الأصناف المتاحة", "Available Products"),
        rows: products.slice(0, 10).map((product) => ({
          id: `product:${sectionId}:${product.key}`,
          title: product.title,
          description: descriptionForProduct(product, lang)
        }))
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, backContext, true);
}

async function sendChickenCountMenu(to, lang, product) {
  await safeSendList(
    to,
    tr(lang, `اختر عدد الدجاج لـ ${product.title} 👇`, `Choose the chicken count for ${product.title} 👇`),
    tr(lang, "عدد الدجاج", "Chicken Count"),
    [
      {
        title: tr(lang, "الخيارات المتاحة", "Available Options"),
        rows: [
          { id: `choice:chicken_qty:${product.key}:1`, title: tr(lang, "1 دجاجة", "1 Chicken"), description: `${formatMoney(product.oneUnitPrice, CONFIG.business.currency)} • ${tr(lang, "تكفي 3-4 أشخاص", "Serves 3-4")}` },
          { id: `choice:chicken_qty:${product.key}:2`, title: tr(lang, "2 دجاجة", "2 Chickens"), description: `${formatMoney(product.oneUnitPrice * 2, CONFIG.business.currency)}` },
          { id: `choice:chicken_qty:${product.key}:3`, title: tr(lang, "3 دجاجات", "3 Chickens"), description: `${formatMoney(product.oneUnitPrice * 3, CONFIG.business.currency)}` }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "products:chicken", true);
}

async function sendMainPeopleMenu(to, lang, product) {
  await safeSendList(
    to,
    tr(lang, `اختر عدد الأشخاص لـ ${product.title} 👇`, `Choose the number of people for ${product.title} 👇`),
    tr(lang, "عدد الأشخاص", "People Count"),
    [
      {
        title: tr(lang, "الخيارات المتاحة", "Available Options"),
        rows: [
          { id: `choice:main_people:${product.key}:2`, title: tr(lang, "لشخصين", "2 People"), description: `${formatMoney(product.perPersonPrice * 2, CONFIG.business.currency)}` },
          { id: `choice:main_people:${product.key}:4`, title: tr(lang, "4 أشخاص", "4 People"), description: `${formatMoney(product.perPersonPrice * 4, CONFIG.business.currency)}` },
          { id: `choice:main_people:${product.key}:6`, title: tr(lang, "6 أشخاص", "6 People"), description: `${formatMoney(product.perPersonPrice * 6, CONFIG.business.currency)}` },
          { id: `choice:main_people_custom:${product.key}:custom`, title: tr(lang, "أدخل رقم", "Enter Number"), description: tr(lang, "سعر الفرد = سعر 4 أشخاص ÷ 4", "Per person = 4 people price ÷ 4") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "products:main", true);
}

async function sendMeatTypeMenu(to, lang, product) {
  const rows = [];

  if (product.meatTypes?.baladi) rows.push({ id: `choice:meat_type:${product.key}:baladi`, title: "بلدي", description: `${formatMoney(product.meatTypes.baladi.oneKgPrice || 0, CONFIG.business.currency)} / 1 كيلو` });
  rows.push({ id: `choice:meat_type:${product.key}:romani`, title: "روماني", description: product.meatTypes?.romani ? `${formatMoney(product.meatTypes.romani.oneKgPrice || 0, CONFIG.business.currency)} / 1 كيلو` : tr(lang, "متابعة مع موظف", "Staff follow-up") });
  rows.push({ id: `choice:meat_type:${product.key}:new_zealand`, title: "نيوزلندي", description: tr(lang, "متابعة مع موظف", "Staff follow-up") });
  rows.push({ id: `choice:meat_type:${product.key}:other`, title: tr(lang, "نوع آخر", "Other Type"), description: tr(lang, "كتابة النوع المطلوب", "Write the requested type") });

  await safeSendList(
    to,
    tr(lang, `اختر نوع اللحم لـ ${product.title} 👇`, `Choose the meat type for ${product.title} 👇`),
    tr(lang, "نوع اللحم", "Meat Type"),
    [{ title: tr(lang, "أنواع اللحم", "Meat Types"), rows }],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, `products:meat`, true);
}

async function sendMeatKgMenu(to, lang, product, meatType) {
  const typeMeta = product.meatTypes?.[meatType];

  if (!typeMeta?.oneKgPrice) {
    await safeSendText(
      to,
      tr(lang, "هذا النوع يحتاج متابعة مباشرة مع موظف الطلب والحجز 🌿", "This type needs direct follow-up with the booking staff 🌿")
    );
    return handleStaffShortcut(to, lang, { product, meatType });
  }

  const p1 = Number(typeMeta.oneKgPrice || 0);
  const p2 = Number(typeMeta.twoKgPrice || (p1 * 2));
  const p3 = Number(typeMeta.threeKgPrice || (p1 * 3));

  await safeSendList(
    to,
    tr(lang, `اختر الكمية بالكيلو لـ ${product.title} - ${typeMeta.title} 👇`, `Choose the kilograms for ${product.title} - ${typeMeta.title} 👇`),
    tr(lang, "الكمية بالكيلو", "Weight"),
    [
      {
        title: tr(lang, "الكميات المتاحة", "Available Weights"),
        rows: [
          { id: `choice:meat_kg:${product.key}:${meatType}:1`, title: tr(lang, "1 كيلو", "1 Kg"), description: `${formatMoney(p1, CONFIG.business.currency)}` },
          { id: `choice:meat_kg:${product.key}:${meatType}:2`, title: tr(lang, "2 كيلو", "2 Kg"), description: `${formatMoney(p2, CONFIG.business.currency)}` },
          { id: `choice:meat_kg:${product.key}:${meatType}:3`, title: tr(lang, "3 كيلو", "3 Kg"), description: `${formatMoney(p3, CONFIG.business.currency)}` },
          { id: `choice:meat_kg_custom:${product.key}:${meatType}:custom`, title: tr(lang, "كميات أخرى", "Other Quantities"), description: tr(lang, "أدخل العدد المطلوب", "Enter the required number") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, `meattype:${product.key}`, true);
}

async function sendMahashiKgMenu(to, lang, product) {
  const oneKg = Number(product.oneKgPrice || 0);

  await safeSendList(
    to,
    tr(lang, `اختر الكمية بالكيلو لـ ${product.title} 👇`, `Choose the kilograms for ${product.title} 👇`),
    tr(lang, "الكمية بالكيلو", "Weight"),
    [
      {
        title: tr(lang, "الخيارات المتاحة", "Available Options"),
        rows: [
          { id: `choice:mahashi_kg:${product.key}:1`, title: tr(lang, "1 كيلو", "1 Kg"), description: `${formatMoney(oneKg, CONFIG.business.currency)}` },
          { id: `choice:mahashi_kg:${product.key}:2`, title: tr(lang, "2 كيلو", "2 Kg"), description: `${formatMoney(oneKg * 2, CONFIG.business.currency)}` },
          { id: `choice:mahashi_kg:${product.key}:3`, title: tr(lang, "3 كيلو", "3 Kg"), description: `${formatMoney(oneKg * 3, CONFIG.business.currency)}` }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, `products:mahashi`, true);
}

async function sendSimpleSizeOrQtyMenu(to, lang, product, sectionId) {
  const rows = [];

  if ((product.sizes || []).length > 1) {
    for (const size of product.sizes) {
      rows.push({
        id: `choice:simple_size:${product.key}:${size.key}`,
        title: `${product.title} - ${size.title}`,
        description: `${formatMoney(size.unitPrice, CONFIG.business.currency)}`
      });
    }
  } else {
    rows.push(
      { id: `choice:simple_qty:${product.key}:1`, title: tr(lang, "1", "1"), description: `${formatMoney(product.sizes?.[0]?.unitPrice || 0, CONFIG.business.currency)}` },
      { id: `choice:simple_qty:${product.key}:2`, title: tr(lang, "2", "2"), description: `${formatMoney((product.sizes?.[0]?.unitPrice || 0) * 2, CONFIG.business.currency)}` },
      { id: `choice:simple_qty:${product.key}:3`, title: tr(lang, "3", "3"), description: `${formatMoney((product.sizes?.[0]?.unitPrice || 0) * 3, CONFIG.business.currency)}` },
      { id: `choice:simple_qty_custom:${product.key}:custom`, title: tr(lang, "أدخل رقم", "Enter Number"), description: tr(lang, "للكميات الأكبر", "For larger quantities") }
    );
  }

  await safeSendList(
    to,
    tr(lang, `اختر المطلوب لـ ${product.title} 👇`, `Choose the option for ${product.title} 👇`),
    tr(lang, "الخيارات", "Options"),
    [{ title: tr(lang, "الخيارات المتاحة", "Available Options"), rows }],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, `products:${sectionId}`, true);
}

async function sendSimpleQuantityMenu(to, lang, product, sizeKey) {
  const size = (product.sizes || []).find((s) => String(s.key) === String(sizeKey)) || product.sizes?.[0];
  const unitPrice = Number(size?.unitPrice || 0);

  await safeSendList(
    to,
    tr(lang, `اختر الكمية لـ ${product.title} - ${size?.title || ""} 👇`, `Choose the quantity for ${product.title} - ${size?.title || ""} 👇`),
    tr(lang, "الكمية", "Quantity"),
    [
      {
        title: tr(lang, "الخيارات المتاحة", "Available Options"),
        rows: [
          { id: `choice:simple_size_qty:${product.key}:${sizeKey}:1`, title: "1", description: `${formatMoney(unitPrice, CONFIG.business.currency)}` },
          { id: `choice:simple_size_qty:${product.key}:${sizeKey}:2`, title: "2", description: `${formatMoney(unitPrice * 2, CONFIG.business.currency)}` },
          { id: `choice:simple_size_qty:${product.key}:${sizeKey}:3`, title: "3", description: `${formatMoney(unitPrice * 3, CONFIG.business.currency)}` },
          { id: `choice:simple_size_qty_custom:${product.key}:${sizeKey}:custom`, title: tr(lang, "أدخل رقم", "Enter Number"), description: tr(lang, "للكميات الأكبر", "For larger quantities") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "products:simple", true);
}

async function sendOffersGroupsMenu(to, lang) {
  await safeSendList(
    to,
    tr(lang, "اختر نوع العروض 👇", "Choose the offers type 👇"),
    tr(lang, "العروض", "Offers"),
    [
      {
        title: tr(lang, "أنواع العروض", "Offers Types"),
        rows: [
          { id: "offergrp:exclusive", title: tr(lang, "العروض الحصرية", "Exclusive Offers"), description: tr(lang, "العروض الخاصة بكم", "Your exclusive offers") },
          { id: "offergrp:suggested", title: tr(lang, "عروض مقترحة", "Suggested Offers"), description: tr(lang, "عروض إضافية متناسقة", "Additional suggested offers") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "home", true);
}

async function sendOffersMenu(to, lang, groupType) {
  const offers = groupType === "exclusive" ? await getExclusiveOffers() : await getSuggestedOffers();
  const title = groupType === "exclusive"
    ? tr(lang, "العروض الحصرية", "Exclusive Offers")
    : tr(lang, "العروض المقترحة", "Suggested Offers");

  await safeSendList(
    to,
    tr(lang, "اختر العرض المطلوب 👇", "Choose the offer 👇"),
    title,
    [
      {
        title,
        rows: offers.slice(0, 10).map((offer) => ({
          id: `offer:${offer.code}`,
          title: offer.title,
          description: `${formatMoney(offer.final_price, CONFIG.business.currency)}${offer.original_price ? ` • ${tr(lang, `بدل ${formatMoney(offer.original_price, CONFIG.business.currency)}`, `Was ${formatMoney(offer.original_price, CONFIG.business.currency)}`)}` : ""}`
        }))
      }
    ],
    tr(lang, "الأسعار لا تشمل التوصيل", "Prices do not include delivery")
  );

  await sendControlButtons(to, lang, "offersgroups", true);
}

async function sendOfferModeMenu(to, lang, offer) {
  await safeSendList(
    to,
    compactText([
      offerLabel(offer),
      offer.description || "",
      "",
      tr(lang, "اختر نوع الطلب لهذا العرض 👇", "Choose the type for this offer 👇")
    ]),
    tr(lang, "نوع العرض", "Offer Type"),
    [
      {
        title: tr(lang, "خيارات الطلب", "Order Options"),
        rows: [
          { id: `offermode:full:${offer.code}`, title: tr(lang, "عرض كامل", "Full Offer"), description: `${formatMoney(offer.final_price, CONFIG.business.currency)}` },
          { id: `offermode:half:${offer.code}`, title: tr(lang, "نص عرض", "Half Offer"), description: `${formatMoney(offer.half_final_price || 0, CONFIG.business.currency)}` }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "offersgroups", true);
}

async function sendPostItemMenu(to, lang, cart) {
  await safeSendList(
    to,
    compactText([
      tr(lang, "تمت إضافة العنصر إلى السلة ✅", "The item has been added to your cart ✅"),
      "",
      buildCartText(cart, lang),
      "",
      tr(lang, "اختر الخطوة التالية 👇", "Choose the next step 👇")
    ]),
    tr(lang, "الخطوة التالية", "Next Step"),
    [
      {
        title: tr(lang, "خيارات المتابعة", "Continue Options"),
        rows: [
          { id: "home:start_order", title: tr(lang, "إضافة صنف آخر", "Add Another Item"), description: tr(lang, "العودة للأقسام", "Back to sections") },
          { id: "home:exclusive_offers", title: tr(lang, "إضافة عرض", "Add Offer"), description: tr(lang, "الانتقال إلى العروض", "Go to offers") },
          { id: "choice:go_schedule:cart:next", title: tr(lang, "متابعة الطلب", "Continue Order"), description: tr(lang, "إكمال التوقيت والتوصيل", "Continue to timing and delivery") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "home", true);
}

async function sendScheduleTypeMenu(to, lang) {
  const sameDayAvailable = availableSameDaySlots(CONFIG.orderFlow.timeSlots, CONFIG.timezone).length > 0;

  const rows = [];
  if (sameDayAvailable) {
    rows.push({
      id: "choice:schedule:same_day",
      title: tr(lang, "اليوم", "Today"),
      description: tr(lang, "حسب المواعيد المتاحة", "Subject to available slots")
    });
  }

  rows.push({
    id: "choice:schedule:another_day",
    title: tr(lang, "يوم آخر", "Another Day"),
    description: tr(lang, "اختر تاريخًا آخر", "Choose another date")
  });

  await safeSendList(
    to,
    sameDayAvailable
      ? tr(lang, "حدد يوم الطلب 👇", "Choose the order day 👇")
      : tr(lang, "لأننا نهتم أن يصلك الطلب بالجودة التي تستحقها 🌿 تم إغلاق مواعيد اليوم، ويسعدنا تجهيز طلبك لليوم التالي بكل حب واهتمام.", "Because quality matters to us 🌿 today's slots are closed, and we would be happy to prepare your order for the next day with care."),
    tr(lang, "يوم الطلب", "Order Day"),
    [{ title: tr(lang, "الخيارات المتاحة", "Available Options"), rows }],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "home", true);
}

async function sendDeliveryMethodMenu(to, lang) {
  await safeSendList(
    to,
    tr(lang, "حدد طريقة الطلب 👇", "Choose the order method 👇"),
    tr(lang, "طريقة الطلب", "Order Method"),
    [
      {
        title: tr(lang, "خيارات الطلب", "Order Options"),
        rows: [
          { id: "choice:delivery_method:DELIVERY", title: tr(lang, "توصيل", "Delivery"), description: tr(lang, "إضافة رسوم التوصيل حسب المنطقة", "Delivery fee will be added by area") },
          { id: "choice:delivery_method:PICKUP", title: tr(lang, "استلام", "Pickup"), description: tr(lang, "استلام من المطبخ", "Pickup from kitchen") }
        ]
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "schedule", true);
}

async function sendDeliveryAreaMenu(to, lang) {
  await safeSendList(
    to,
    tr(lang, "اختر منطقة التوصيل 👇", "Choose the delivery area 👇"),
    tr(lang, "منطقة التوصيل", "Delivery Area"),
    [
      {
        title: tr(lang, "الخيارات المتاحة", "Available Options"),
        rows: GOVERNORATE_ROWS.map((row) => ({
          id: `choice:delivery_area:${row.id}`,
          title: row.title,
          description: row.description
        }))
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "deliverymethod", true);
}

async function sendGovernorateListMenu(to, lang) {
  await safeSendList(
    to,
    tr(lang, "اختر المحافظة 👇", "Choose the governorate 👇"),
    tr(lang, "المحافظة", "Governorate"),
    [
      {
        title: tr(lang, "المحافظات", "Governorates"),
        rows: JORDAN_GOVERNORATES.slice(0, 10).map((gov) => ({
          id: `choice:govlist:${encodeURIComponent(gov)}`,
          title: gov,
          description: `${formatMoney(5, CONFIG.business.currency)}+`
        }))
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "deliveryarea", true);
}

async function sendTimeSlotsMenu(to, lang, scheduleType) {
  const slots = scheduleType === "same_day"
    ? availableSameDaySlots(CONFIG.orderFlow.timeSlots, CONFIG.timezone)
    : CONFIG.orderFlow.timeSlots;

  await safeSendList(
    to,
    tr(lang, "اختر الموعد المناسب 👇", "Choose the suitable time 👇"),
    tr(lang, "الموعد", "Time Slot"),
    [
      {
        title: tr(lang, "المواعيد المتاحة", "Available Slots"),
        rows: slots.map((slot) => ({
          id: `choice:slot:${encodeURIComponent(slot)}`,
          title: slot,
          description: tr(lang, "اختيار هذا الموعد", "Choose this time")
        }))
      }
    ],
    CONFIG.business.name
  );

  await sendControlButtons(to, lang, "deliveryarea", true);
}

async function sendBeforeSubmitMenu(to, lang, zone, data, totals) {
  await safeSendText(to, buildSummaryText(lang, zone, data, totals));

  await safeSendList(
    to,
    tr(lang, "اختر الإجراء المناسب 👇", "Choose the suitable action 👇"),
    tr(lang, "تأكيد الطلب", "Confirm Order"),
    [
      {
        title: tr(lang, "خيارات الطلب", "Order Actions"),
        rows: [
          { id: "choice:submit_order:yes", title: tr(lang, "تأكيد إرسال الطلب", "Send Order"), description: tr(lang, "إرسال الطلب إلى الإدارة", "Send the order to admin") },
          { id: "home:start_order", title: tr(lang, "تعديل الطلب", "Edit Order"), description: tr(lang, "العودة لاختيار الأصناف", "Return to choose items") },
                    { id: "nav:back:schedule", title: tr(lang, "رجوع", "Back"), description: tr(lang, "الرجوع للخطوة السابقة", "Go back") },
          { id: "nav:cancel", title: tr(lang, "إلغاء / خروج", "Cancel / Exit"), description: tr(lang, "إلغاء الطلب الحالي", "Cancel the current order") }
        ]
      }
    ],
    CONFIG.business.name
  );
}

function buildSummaryText(lang, zone, data, totals) {
  return tr(
    lang,
    compactText([
      `ملخص طلبك ${data.tempOrderNumber || ""} 🧾`,
      "",
      buildCartText(data.cart || [], lang),
      "",
      `التاريخ: ${data.requestedDate || "-"}`,
      `الموعد: ${data.requestedTime || "-"}`,
      `طريقة الطلب: ${data.deliveryMethod === "DELIVERY" ? "توصيل" : "استلام"}`,
      data.deliveryAreaLabel ? `منطقة التوصيل: ${data.deliveryAreaLabel}` : "",
      data.governorateLabel ? `المحافظة: ${data.governorateLabel}` : "",
      data.addressText ? `العنوان التفصيلي: ${data.addressText}` : "",
      data.customerNote ? `ملاحظاتك: ${data.customerNote}` : "",
      "",
      `المجموع الفرعي: ${formatMoney(totals.subtotal, CONFIG.business.currency)}`,
      `رسوم التوصيل: ${formatMoney(totals.deliveryFee, CONFIG.business.currency)}`,
      `الإجمالي النهائي: ${formatMoney(totals.total, CONFIG.business.currency)}`,
      "",
      "شيف اليوم يتابع طلبك بذوق وخدمة وجودة تليق بك 🌿"
    ]),
    compactText([
      "Your Order Summary 🧾",
      "",
      buildCartText(data.cart || [], lang),
      "",
      `Date: ${data.requestedDate || "-"}`,
      `Time: ${data.requestedTime || "-"}`,
      `Method: ${data.deliveryMethod === "DELIVERY" ? "Delivery" : "Pickup"}`,
      data.deliveryAreaLabel ? `Delivery Area: ${data.deliveryAreaLabel}` : "",
      data.governorateLabel ? `Governorate: ${data.governorateLabel}` : "",
      data.addressText ? `Detailed Address: ${data.addressText}` : "",
      data.customerNote ? `Your Notes: ${data.customerNote}` : "",
      "",
      `Subtotal: ${formatMoney(totals.subtotal, CONFIG.business.currency)}`,
      `Delivery Fee: ${formatMoney(totals.deliveryFee, CONFIG.business.currency)}`,
      `Final Total: ${formatMoney(totals.total, CONFIG.business.currency)}`,
      "",
      "Chef Alyoum is following your order with care, quality, and elegant service 🌿"
    ])
  );
}

function buildCartText(cart, lang) {
  if (!cart?.length) {
    return tr(lang, "السلة فارغة حاليًا.", "Your cart is currently empty.");
  }

  return cart.map((item, index) => compactText([
    `${index + 1}) ${item.title}`,
    tr(lang, `الكمية: ${item.qty}`, `Qty: ${item.qty}`),
    tr(lang, `السعر: ${formatMoney(item.lineTotal, CONFIG.business.currency)}`, `Price: ${formatMoney(item.lineTotal, CONFIG.business.currency)}`),
    item.notes ? tr(lang, `ملاحظات: ${item.notes}`, `Notes: ${item.notes}`) : ""
  ])).join("\n\n");
}

async function handleStaffShortcut(phone, lang, draft = {}) {
  await createSupportRequest({
    requestType: "staff_booking",
    phone,
    language: lang,
    notes: "طلب التحدث مع موظف الطلب والحجز",
    payload: { draft }
  }).catch(() => null);

  await notifyAdmins(compactText([
    "📞 طلب تواصل مع موظف الطلب والحجز",
    `الهاتف: ${phone}`,
    draft?.sectionLabel ? `القسم الحالي: ${draft.sectionLabel}` : "",
    draft?.currentProductTitle ? `الصنف الحالي: ${draft.currentProductTitle}` : ""
  ]));

  await safeSendText(
    phone,
    tr(
      lang,
      `تم تحويل طلبك إلى قسم الطلب والحجز 🌿 للتواصل السريع يمكنك الاتصال على ${CONFIG.business.phone}`,
      `Your request has been forwarded to the order & booking team 🌿 For faster response, you can call ${CONFIG.business.phone}`
    )
  );

  await sendHomeMenu(phone, lang);
}

async function notifyAdmins(text) {
  for (const adminPhone of CONFIG.wa.adminNumbers) {
    try {
      await sendText(adminPhone, text);
    } catch (error) {
      console.error("ADMIN_NOTIFY_ERROR", adminPhone, error?.response || error.message);
    }
  }
}

async function notifyAdminsWithButtons(text, buttons) {
  for (const adminPhone of CONFIG.wa.adminNumbers) {
    try {
      await sendButtons(adminPhone, text, buttons);
    } catch (error) {
      console.error("ADMIN_NOTIFY_BUTTONS_ERROR", adminPhone, error?.response || error.message);
    }
  }
}

async function getLatestOrderForPhone(phone) {
  const normalized = normalizePhone(phone);

  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("customer_phone", normalized)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

function formatTrackedStatus(status) {
  const s = String(status || "").toLowerCase();

  if (s.includes("pending_admin")) return "طلبك قيد المراجعة الآن";
  if (s.includes("approved")) return "تمت الموافقة المبدئية على طلبك";
  if (s.includes("customer_confirm")) return "بانتظار تثبيتك النهائي";
  if (s.includes("in_preparation")) return "طلبك قيد التحضير";
  if (s.includes("ready")) return "طلبك جاهز";
  if (s.includes("waiting_for_driver")) return "طلبك بانتظار نشمي التوصيل";
  if (s.includes("delivered")) return "تم تسليم الطلب";
  if (s.includes("picked")) return "تم استلام الطلب";
  if (s.includes("rejected")) return "لم يتم اعتماد الطلب";
  if (s.includes("cancel")) return "تم إلغاء الطلب";
  return "طلبك قيد المتابعة";
}

async function createAndSendOrder(phone, profileName, lang, data) {
  const zone = data.zoneId ? await getZoneById(data.zoneId) : null;
  const deliveryFee = data.deliveryMethod === "DELIVERY" ? Number(zone?.delivery_fee || 0) : 0;
  const totals = await calculateCartSummary(data.cart || [], deliveryFee);

  const order = await createOrder(
    {
      customer_phone: phone,
      customer_name: profileName || null,
      status: "PENDING_ADMIN",
      approval_mode: "MANUAL",
      approval_policy: "MANUAL_ONLY",
      awaiting_customer_final_confirmation: false,
      order_channel: "WHATSAPP",
      source_channel: "WHATSAPP",
      delivery_method: data.deliveryMethod,
      schedule_type: data.scheduleType,
      requested_date: data.requestedDate,
      requested_time_slot: data.requestedTime,
      delivery_zone_id: zone?.id || null,
      delivery_zone_name: data.deliveryAreaLabel || zone?.name || data.governorateLabel || null,
      address_text: data.addressText || null,
      customer_note: data.customerNote || null,
      subtotal_amount: totals.subtotal,
      delivery_fee: totals.deliveryFee,
      total_amount: totals.total,
      currency_code: CONFIG.business.currency,
      language: lang,
      draft_payload: data
    },
    data.cart || []
  );

  const adminText = compactText([
    `طلب جديد ${order.order_number} 🌿`,
    `الهاتف: ${order.customer_phone}`,
    `الطريقة: ${order.delivery_method === "DELIVERY" ? "توصيل" : "استلام"}`,
    order.delivery_zone_name ? `منطقة التوصيل: ${order.delivery_zone_name}` : "",
    order.address_text ? `العنوان: ${order.address_text}` : "",
    `التاريخ: ${order.requested_date || "-"}`,
    `الموعد: ${order.requested_time_slot || "-"}`,
    "",
    buildCartText(order.order_items || [], "ar"),
    "",
    `الإجمالي النهائي: ${formatMoney(order.total_amount, CONFIG.business.currency)}`
  ]);

  await notifyAdminsWithButtons(adminText, [
    { id: `admin:approve:${order.id}`, title: "اعتماد" },
    { id: `admin:reject:${order.id}`, title: "رفض" }
  ]);

  await resetSession(phone, { selectedLanguage: lang });

  await safeSendText(
    phone,
    tr(
      lang,
      compactText([
        `تم استلام طلبك ${order.order_number} بكل سرور ✅`,
        "شيف اليوم بدأ يرتّب طلبك بعناية.",
        "سنوافيك بخطوة التثبيت النهائية بعد مراجعة الإدارة 🌿"
      ]),
      compactText([
        `Your order ${order.order_number} has been received successfully ✅`,
        "Chef Alyoum has started arranging your order with care.",
        "We will send you the final confirmation step after admin review 🌿"
      ])
    )
  );
}

async function handleFinalAction(message, lang, action, orderId) {
  const order = await getOrder(orderId).catch(() => null);
  if (!order) {
    await safeSendText(message.from, tr(lang, "الطلب غير موجود حاليًا.", "This order could not be found."));
    return true;
  }

  if (action === "confirm") {
    const updated = await updateOrder(orderId, {
      status: "CUSTOMER_CONFIRMED_FINAL",
      awaiting_customer_final_confirmation: false,
      customer_final_action: "CONFIRMED_NO_CHANGES",
      customer_final_action_at: new Date().toISOString(),
      note: "Customer confirmed final execution",
      actor_role: "customer"
    });

    await notifyAdmins(compactText([
      "✅ العميل ثبّت الطلب والبدء تنفيذه",
      `الطلب: ${updated.order_number}`,
      `الهاتف: ${updated.customer_phone}`
    ]));

    await safeSendText(
      message.from,
      tr(
        lang,
        `رائع 🌿 تم تثبيت طلبك النهائي ${updated.order_number} وبدأت إجراءات التنفيذ.`,
        `Great 🌿 Your order ${updated.order_number} has been finalized and execution has started.`
      )
    );
    return true;
  }

  if (action === "change") {
    await upsertSession(message.from, {
      state: "await_customer_change_request",
      language: lang,
      selected_language: lang,
      pending_meta: { orderId }
    });

    await safeSendText(
      message.from,
      tr(lang, "أرسل التعديل المطلوب نصيًا بالتفصيل.", "Please send the requested changes in detail.")
    );
    return true;
  }

  if (action === "postpone") {
    await upsertSession(message.from, {
      state: "await_customer_postpone_request",
      language: lang,
      selected_language: lang,
      pending_meta: { orderId }
    });

    await safeSendText(
      message.from,
      tr(lang, "أرسل الموعد الجديد المطلوب نصيًا بالتفصيل.", "Please send the new requested timing in detail.")
    );
    return true;
  }

  if (action === "cancel") {
    const updated = await updateOrder(orderId, {
      status: "CUSTOMER_CANCELLED",
      awaiting_customer_final_confirmation: false,
      customer_final_action: "CANCELLED",
      customer_final_action_at: new Date().toISOString(),
      note: "Customer cancelled after admin approval",
      actor_role: "customer"
    });

    await notifyAdmins(compactText([
      "❌ العميل ألغى الطلب",
      `الطلب: ${updated.order_number}`,
      `الهاتف: ${updated.customer_phone}`
    ]));

    await safeSendText(
      message.from,
      tr(lang, "تم إلغاء الطلب بناءً على رغبتك، ويسعدنا خدمتك في أي وقت 🌿", "The order has been cancelled as requested, and we would be happy to serve you anytime 🌿")
    );
    return true;
  }

  if (action === "call") {
    const updated = await updateOrder(orderId, {
      status: "CUSTOMER_WANTS_CALL",
      awaiting_customer_final_confirmation: false,
      customer_final_action: "WANTS_CALL",
      customer_final_action_at: new Date().toISOString(),
      customer_requested_callback: true,
      note: "Customer requested phone call",
      actor_role: "customer"
    });

    await notifyAdmins(compactText([
      "📞 العميل يرغب بالتحدث هاتفيًا",
      `الطلب: ${updated.order_number}`,
      `الهاتف: ${updated.customer_phone}`
    ]));

    await safeSendText(
      message.from,
      tr(lang, `تم تسجيل طلب الاتصال 🌿 وسيتم التواصل معك قريبًا، أو يمكنك الاتصال مباشرة على ${CONFIG.business.phone}`, `Your call request has been recorded 🌿 We will contact you shortly, or you can call ${CONFIG.business.phone} directly.`)
    );
    return true;
  }

  return false;
}

export async function processAdminAction(message) {
  const raw = String(message.interactiveId || "");
  const [, action, orderId] = raw.split(":");
  if (!action || !orderId) return false;

  const order = await getOrder(orderId).catch(() => null);
  if (!order) {
    await safeSendText(message.from, "الطلب غير موجود أو لم يعد متاحًا.");
    return true;
  }

  if (action === "approve") {
    const policy = await getApprovalPolicySetting().catch(() => ({ mode: "MANUAL_ONLY" }));
    const updated = await updateOrder(orderId, {
      status: "APPROVED_WAITING_CUSTOMER_FINAL_CONFIRMATION",
      approval_mode: "MANUAL",
      approval_policy: policy?.mode || "MANUAL_ONLY",
      awaiting_customer_final_confirmation: true,
      approved_at: new Date().toISOString(),
      approved_by_phone: message.from,
      note: "Approved by admin, waiting for customer confirmation",
      actor_role: "admin"
    });

    await logAdminAction({
      order_id: updated.id,
      order_code: updated.order_number,
      customer_phone: updated.customer_phone,
      action_type: "APPROVE",
      actor_phone: message.from,
      note: "Approved manually by admin"
    });

    const lang = normalizeLanguage(updated.meta?.language || "ar");

    await safeSendList(
      updated.customer_phone,
      tr(
        lang,
        compactText([
          "خبر جميل 🌿",
          `تمت مراجعة طلبك ${updated.order_number} مبدئيًا بنجاح.`,
          "اختر الإجراء المناسب لتثبيت التنفيذ النهائي."
        ]),
        compactText([
          "Good news 🌿",
          `Your order ${updated.order_number} has been reviewed successfully.`,
          "Choose the suitable action to finalize execution."
        ])
      ),
      tr(lang, "التثبيت النهائي", "Final Confirmation"),
      [
        {
          title: tr(lang, "خيارات التثبيت النهائي", "Final Confirmation Options"),
          rows: [
            { id: `final:confirm:${updated.id}`, title: tr(lang, "تثبيت الطلب والبدء تنفيذه", "Confirm & Start"), description: tr(lang, "تثبيت نهائي بدون تعديل", "Finalize without changes") },
            { id: `final:change:${updated.id}`, title: tr(lang, "تعديل الطلب", "Modify Order"), description: tr(lang, "إرسال تعديل قبل التنفيذ", "Send changes before execution") },
            { id: `final:postpone:${updated.id}`, title: tr(lang, "تأجيل الطلب", "Postpone"), description: tr(lang, "طلب موعد آخر", "Request another schedule") },
            { id: `final:cancel:${updated.id}`, title: tr(lang, "إلغاء الطلب", "Cancel Order"), description: tr(lang, "إلغاء الطلب الحالي", "Cancel this order") }
          ]
        }
      ],
      CONFIG.business.name
    );

    await safeSendText(message.from, `تم اعتماد الطلب ${updated.order_number} وإرسال خطوة التثبيت النهائي للعميل.`);
    return true;
  }

  if (action === "reject") {
    const updated = await updateOrder(orderId, {
      status: "REJECTED",
      approval_mode: "MANUAL",
      awaiting_customer_final_confirmation: false,
      rejected_at: new Date().toISOString(),
      approved_by_phone: message.from,
      note: "Rejected by admin",
      actor_role: "admin"
    });

    await logAdminAction({
      order_id: updated.id,
      order_code: updated.order_number,
      customer_phone: updated.customer_phone,
      action_type: "REJECT",
      actor_phone: message.from,
      note: "Rejected manually by admin"
    });

    const lang = normalizeLanguage(updated.meta?.language || "ar");

    await safeSendText(
      updated.customer_phone,
      tr(
        lang,
        compactText([
          "نعتذر منك بكل تقدير 🌿",
          "في الوقت الحالي لا نستطيع تنفيذ الطلب بالجودة التي نلتزم بها بسبب الضغط أو القدرة الإنتاجية.",
          "يسعدنا خدمتك في طلب آخر أو في موعد مختلف."
        ]),
        compactText([
          "We sincerely apologize 🌿",
          "At the moment, we are unable to fulfill the order with the quality standard we commit to due to current capacity.",
          "We would be happy to serve you with another order or at another time."
        ])
      )
    );

    await safeSendText(message.from, `تم رفض الطلب ${updated.order_number} وإبلاغ العميل.`);
    return true;
  }

  return false;
}

async function handleBack(phone, lang, context) {
  if (context === "home") return sendHomeMenu(phone, lang);
  if (context === "sections") return sendSectionMenu(phone, lang, "home");
  if (context.startsWith("products:")) {
    const sectionId = context.split(":")[1];
    return sendProductsMenu(phone, lang, sectionId, "sections");
  }
  if (context === "offersgroups") return sendOffersGroupsMenu(phone, lang);
  if (context === "schedule") return sendScheduleTypeMenu(phone, lang);
  if (context === "deliverymethod") return sendDeliveryMethodMenu(phone, lang);
  if (context === "deliveryarea") return sendDeliveryAreaMenu(phone, lang);
  if (context.startsWith("meattype:")) {
    const productKey = context.split(":")[1];
    const product = await getProductByKey("meat", productKey);
    if (product) return sendMeatTypeMenu(phone, lang, product);
  }
  return sendHomeMenu(phone, lang);
}


async function tryAiFastLane({ phone, profileName, lang, session, parsed, customerId = null }) {
  if (parsed.type !== 'text') return false;
  if (!CONFIG.ai.enabled) return false;
  const allowedStates = new Set(['idle', 'await_home', 'await_language', 'home']);
  if (!allowedStates.has(String(session?.state || 'idle'))) return false;

  const recentMessages = await listRecentConversationMessages(phone, CONFIG.ai.memoryWindow).catch(() => []);
  const analysis = await analyzeCustomerText({ text: parsed.value, recentMessages });
  if (!analysis?.handled) return false;

  if (analysis?.draftOrder?.items?.length) {
    const itemNames = analysis.draftOrder.items.map((item) => item.title).join('، ');
    await upsertCustomerFact({ customerPhone: phone, customerId, factKey: 'last_requested_items', factValue: itemNames, confidence: 0.9, source: 'ai_parser' }).catch(() => null);
  }

  await safeSendText(phone, analysis.response, { intent: analysis.intent || 'ai_reply', ai: true });
  if (analysis.intent === 'direct_order' || analysis.intent === 'order_suggestion_people') {
    await safeSendButtons(
      phone,
      tr(lang, 'يمكنك أيضاً متابعة الطلب من القائمة السريعة 👇', 'You can also continue from the quick menu 👇'),
      [
        { id: 'home:start_order', title: tr(lang, 'ابدأ الطلب', 'Start Order') },
        { id: 'home:prices_menu', title: tr(lang, 'الأسعار والمنيو', 'Prices') },
        { id: 'home:track_order', title: tr(lang, 'تتبع طلبي', 'Track Order') }
      ],
      CONFIG.business.name,
      { intent: 'ai_quick_actions' }
    );
  }

  return true;
}

export async function handleCustomerMessage(message) {
  const phone = normalizePhone(message.from);
  const profileName = message.profileName || "";
  const parsed = parseCommand(message);

  let session = await getSession(phone);
  const currentLang = normalizeLanguage(session?.selected_language || "ar");

  const customer = await getOrCreateCustomer({
    phone,
    name: profileName,
    language: currentLang,
    sourceChannel: "WHATSAPP"
  });

  await touchCustomer(phone, profileName, {
    language: currentLang,
    sourceChannel: "WHATSAPP"
  });

  await logConversationMessage({
    customerPhone: phone,
    customerId: customer?.id || null,
    direction: 'inbound',
    messageType: message.type || parsed.type || 'text',
    text: parsed.type === 'text' ? parsed.value : parseInteractiveChoice(message),
    payload: { profileName, rawType: message.type || null }
  }).catch(() => null);

  if (!session) {
    await upsertSession(phone, {
      state: "await_language",
      language: "ar",
      selected_language: "ar",
      data: { cart: [] }
    });
    await sendLanguageMenu(phone);
    return;
  }

  let lang = normalizeLanguage(session.selected_language || "ar");
  let data = session.data || { cart: [] };

  if (parsed.type === "admin") return;

  if (parsed.type === "text" && !isStartText(parsed.value)) {
    const aiHandled = await tryAiFastLane({ phone, profileName, lang, session, parsed, customerId: customer?.id || null });
    if (aiHandled) return;
  }

  if (parsed.type === "text" && isStartText(parsed.value)) {
    await upsertSession(phone, {
      state: "await_language",
      language: lang,
      selected_language: lang,
      data: { cart: [] }
    });
    await sendLanguageMenu(phone);
    return;
  }

  if (parsed.type === "nav_cancel") {
    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم إلغاء الخطوة الحالية بنجاح.", "The current step has been cancelled successfully."));
    await sendHomeMenu(phone, lang);
    return;
  }

  if (parsed.type === "nav_back") {
    await handleBack(phone, lang, parsed.value);
    return;
  }

  if (parsed.type === "staff") {
    await handleStaffShortcut(phone, lang, {
      sectionLabel: data.sectionLabel || null,
      currentProductTitle: data.currentProductTitle || null
    });
    return;
  }

  if (parsed.type === "lang") {
    lang = normalizeLanguage(parsed.value);
    await touchCustomer(phone, profileName, { language: lang });
    await upsertSession(phone, {
      state: "await_home",
      language: lang,
      selected_language: lang,
      data: { cart: [] }
    });
    await sendHomeMenu(phone, lang);
    return;
  }

  if (parsed.type === "final") {
    const handled = await handleFinalAction(message, lang, parsed.value.action, parsed.value.orderId);
    if (handled) return;
  }

  if (session.state === "await_language") {
    await sendLanguageMenu(phone);
    return;
  }

  if (parsed.type === "home") {
    if (parsed.value === "start_order") {
      await upsertSession(phone, {
        state: "await_section",
        language: lang,
        selected_language: lang,
        data: { cart: [] }
      });
      await sendSectionMenu(phone, lang, "home");
      return;
    }

    if (parsed.value === "prices_menu") {
      await upsertSession(phone, {
        state: "await_section",
        language: lang,
        selected_language: lang,
        data: { ...(data || {}), cart: data.cart || [] }
      });
      await sendSectionMenu(phone, lang, "home");
      return;
    }

    if (parsed.value === "exclusive_offers") {
      await upsertSession(phone, {
        state: "await_offer_group",
        language: lang,
        selected_language: lang,
        data: { ...(data || {}), cart: data.cart || [] }
      });
      await sendOffersGroupsMenu(phone, lang);
      return;
    }

    if (parsed.value === "track_order") {
      const order = await getLatestOrderForPhone(phone).catch(() => null);

      if (!order) {
        await safeSendText(phone, tr(lang, "لا يوجد لديك طلبات محفوظة حاليًا.", "You do not have any saved orders right now."));
        await sendHomeMenu(phone, lang);
        return;
      }

      const publicCode = order.order_code || order.shortcode || (order.serial_no ? orderSerialLabel(order.serial_no) : "طلبك الأخير");

      await safeSendText(
        phone,
        compactText([
          tr(lang, "تتبع طلبك", "Track Your Order"),
          `${tr(lang, "رقم الطلب", "Order Number")}: ${publicCode}`,
          `${tr(lang, "الحالة الحالية", "Current Status")}: ${formatTrackedStatus(order.status_label || order.status)}`,
          order.requested_date ? `${tr(lang, "التاريخ", "Date")}: ${order.requested_date}` : "",
          order.requested_time ? `${tr(lang, "الموعد", "Time")}: ${order.requested_time}` : ""
        ])
      );

      await sendHomeMenu(phone, lang);
      return;
    }

    if (parsed.value === "staff_booking") {
      await upsertSession(phone, {
        state: "await_staff_booking_details",
        language: lang,
        selected_language: lang,
        data: {}
      });

      await safeSendText(phone, tr(lang, "أرسل تفاصيل الحجز الذي ترغب بتثبيته مع موظف.", "Please send the booking details you want to arrange with a staff member."));
      return;
    }

    if (parsed.value === "support") {
      await upsertSession(phone, {
        state: "await_support_type",
        language: lang,
        selected_language: lang,
        data: {}
      });

      await safeSendList(
        phone,
        tr(lang, "اختر نوع الرسالة 👇", "Choose the message type 👇"),
        tr(lang, "المقترحات والملاحظات", "Suggestions & Feedback"),
        [
          {
            title: tr(lang, "أنواع الرسائل", "Message Types"),
            rows: SUPPORT_TYPES.map((item) => ({
              id: `support:${item.key}`,
              title: tr(lang, item.ar, item.en),
              description: tr(lang, "ستصل مباشرة إلى الإدارة", "It will be sent directly to admin")
            }))
          }
        ],
        CONFIG.business.name
      );

      await sendControlButtons(phone, lang, "home", false);
      return;
    }

    if (parsed.value === "franchise") {
      await upsertSession(phone, {
        state: "await_franchise_country",
        language: lang,
        selected_language: lang,
        data: { franchise: {} }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل الاهتمام بامتياز العلامة داخل الأردن أم خارجه؟", "Is the franchise interest inside Jordan or outside Jordan?"),
        [
          { id: "choice:fr_country:jordan", title: tr(lang, "الأردن", "Jordan") },
          { id: "choice:fr_country:outside", title: tr(lang, "خارج الأردن", "Outside Jordan") },
          { id: "nav:cancel", title: tr(lang, "خروج", "Exit") }
        ]
      );
      return;
    }

    if (parsed.value === "partners") {
      await upsertSession(phone, {
        state: "await_partner_type",
        language: lang,
        selected_language: lang,
        data: {}
      });

      await safeSendList(
        phone,
        tr(lang, "اختر نوع الطلب 👇", "Choose the request type 👇"),
        tr(lang, "وظائف وتعاون", "Jobs & Partnerships"),
        [
          {
            title: tr(lang, "الخيارات المتاحة", "Available Options"),
            rows: PARTNER_TYPES.map((item) => ({
              id: `partner:${item.key}`,
              title: tr(lang, item.ar, item.en),
              description: tr(lang, "سيصل مباشرة إلى الإدارة", "It will be sent directly to admin")
            }))
          }
        ],
        CONFIG.business.name
      );

      await sendControlButtons(phone, lang, "home", false);
      return;
    }
  }

  if (parsed.type === "section") {
    const sectionId = parsed.value;
    const sectionLabel =
      sectionId === "chicken" ? "أطباق دجاج" :
      sectionId === "meat" ? "أطباق لحم" :
      sectionId === "mahashi" ? "المحاشي" :
      sectionId === "main" ? "أطباق رئيسية" :
      sectionId === "soups" ? "الشوربات" :
      sectionId === "salads" ? "السلطات" :
      "المفرزات";

    await upsertSession(phone, {
      state: "await_product",
      language: lang,
      selected_language: lang,
      data: { ...data, sectionId, sectionLabel }
    });

    await sendProductsMenu(phone, lang, sectionId, "sections");
    return;
  }

  if (parsed.type === "product") {
    const { sectionId, productKey } = parsed.value;
    const product = await getProductByKey(sectionId, productKey);

    if (!product) {
      await safeSendText(phone, tr(lang, "الصنف غير متاح حاليًا.", "This item is not available right now."));
      await sendProductsMenu(phone, lang, sectionId, "sections");
      return;
    }

    await upsertSession(phone, {
      state: "await_product_option",
      language: lang,
      selected_language: lang,
      data: { ...data, sectionId, currentProductKey: product.key, currentProductTitle: product.title }
    });

    if (sectionId === "chicken") return sendChickenCountMenu(phone, lang, product);
    if (sectionId === "main") return sendMainPeopleMenu(phone, lang, product);
    if (sectionId === "meat") return sendMeatTypeMenu(phone, lang, product);
    if (sectionId === "mahashi") return sendMahashiKgMenu(phone, lang, product);

    return sendSimpleSizeOrQtyMenu(phone, lang, product, sectionId);
  }

  if (parsed.type === "offergrp") {
    await upsertSession(phone, {
      state: "await_offer",
      language: lang,
      selected_language: lang,
      data: { ...data, offerGroup: parsed.value }
    });

    await sendOffersMenu(phone, lang, parsed.value);
    return;
  }

  if (parsed.type === "offer") {
    const offer = await getOfferByCode(parsed.value);

    if (!offer) {
      await safeSendText(phone, tr(lang, "العرض غير متاح حاليًا.", "This offer is not available right now."));
      await sendOffersGroupsMenu(phone, lang);
      return;
    }

    await upsertSession(phone, {
      state: "await_offer_mode",
      language: lang,
      selected_language: lang,
      data: { ...data, currentOfferCode: offer.code }
    });

    await sendOfferModeMenu(phone, lang, offer);
    return;
  }

  if (parsed.type === "offermode") {
    const offer = await getOfferByCode(parsed.value.code);
    if (!offer) {
      await sendOffersGroupsMenu(phone, lang);
      return;
    }

    const cartItem = buildOfferCartItem(offer, { useHalf: parsed.value.mode === "half" });
    const newCart = [...(data.cart || []), cartItem];

    await upsertSession(phone, {
      state: "await_post_item",
      language: lang,
      selected_language: lang,
      data: { ...data, cart: newCart }
    });

    await sendPostItemMenu(phone, lang, newCart);
    return;
  }

  if (parsed.type === "choice") {
    if (parsed.value.name === "chicken_qty") {
      const product = await getProductByKey("chicken", parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, "chicken");
      const cartItem = buildProductCartItem(product, { count: Number(parsed.value.b || 1) });
      const newCart = [...(data.cart || []), cartItem];

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem, cart: data.cart || [] }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: "nav:back:products:chicken", title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "main_people") {
      const product = await getProductByKey("main", parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, "main");
      const cartItem = buildProductCartItem(product, { peopleCount: Number(parsed.value.b || 4) });

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: "nav:back:products:main", title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "main_people_custom") {
      await upsertSession(phone, {
        state: "await_custom_people_count",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: parsed.value.a, sectionId: "main" }
      });

      await safeSendText(phone, tr(lang, "أدخل عدد الأشخاص المطلوب بالأرقام فقط.", "Enter the required number of people using digits only."));
      return;
    }

    if (parsed.value.name === "meat_type") {
      const product = await getProductByKey("meat", parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, "meat");

      const type = parsed.value.b;

      if (type === "other" || type === "new_zealand" || (type === "romani" && !product.meatTypes?.romani)) {
        await handleStaffShortcut(phone, lang, { sectionLabel: "أطباق لحم", currentProductTitle: product.title });
        return;
      }

      await upsertSession(phone, {
        state: "await_meat_kg",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: product.key, sectionId: "meat", selectedMeatType: type }
      });

      await sendMeatKgMenu(phone, lang, product, type);
      return;
    }

    if (parsed.value.name === "meat_kg") {
      const product = await getProductByKey("meat", parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, "meat");

      const cartItem = buildProductCartItem(product, {
        meatType: parsed.value.b,
        kilos: Number(parsed.value.c || 1)
      });

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: `nav:back:meattype:${product.key}`, title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "meat_kg_custom") {
      await upsertSession(phone, {
        state: "await_custom_meat_kg",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: parsed.value.a, sectionId: "meat", selectedMeatType: parsed.value.b }
      });

      await safeSendText(phone, tr(lang, "أدخل الكمية المطلوبة بالكيلو بالأرقام فقط. مثال: 4", "Enter the required kilograms using digits only. Example: 4"));
      return;
    }

    if (parsed.value.name === "mahashi_kg") {
      const product = await getProductByKey("mahashi", parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, "mahashi");

      const cartItem = buildProductCartItem(product, { kilos: Number(parsed.value.b || 1) });

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: "nav:back:products:mahashi", title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "simple_qty") {
      const product = await getProductByKey(data.sectionId, parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, data.sectionId);

      const cartItem = buildProductCartItem(product, {
        sizeKey: product.sizes?.[0]?.key,
        quantity: Number(parsed.value.b || 1)
      });

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: `nav:back:products:${data.sectionId}`, title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "simple_qty_custom") {
      await upsertSession(phone, {
        state: "await_custom_simple_qty",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: parsed.value.a, sectionId: data.sectionId }
      });

      await safeSendText(phone, tr(lang, "أدخل الكمية المطلوبة بالأرقام فقط.", "Enter the required quantity using digits only."));
      return;
    }

    if (parsed.value.name === "simple_size") {
      const product = await getProductByKey(data.sectionId, parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, data.sectionId);

      await upsertSession(phone, {
        state: "await_simple_size_qty",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: product.key, sectionId: data.sectionId, selectedSizeKey: parsed.value.b }
      });

      await sendSimpleQuantityMenu(phone, lang, product, parsed.value.b);
      return;
    }

    if (parsed.value.name === "simple_size_qty") {
      const product = await getProductByKey(data.sectionId, parsed.value.a);
      if (!product) return sendProductsMenu(phone, lang, data.sectionId);

      const cartItem = buildProductCartItem(product, {
        sizeKey: parsed.value.b,
        quantity: Number(parsed.value.c || 1)
      });

      await upsertSession(phone, {
        state: "await_note",
        language: lang,
        selected_language: lang,
        data: { ...data, pendingCartItem: cartItem }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
        [
          { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
          { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
          { id: `nav:back:products:${data.sectionId}`, title: tr(lang, "رجوع", "Back") }
        ]
      );
      return;
    }

    if (parsed.value.name === "simple_size_qty_custom") {
      await upsertSession(phone, {
        state: "await_custom_simple_size_qty",
        language: lang,
        selected_language: lang,
        data: { ...data, currentProductKey: parsed.value.a, sectionId: data.sectionId, selectedSizeKey: parsed.value.b }
      });

      await safeSendText(phone, tr(lang, "أدخل الكمية المطلوبة بالأرقام فقط.", "Enter the required quantity using digits only."));
      return;
    }

    if (parsed.value.name === "item_note") {
      if (parsed.value.a === "none") {
        const cartItem = { ...(data.pendingCartItem || {}) };
        const newCart = [...(data.cart || []), cartItem];

        await upsertSession(phone, {
          state: "await_post_item",
          language: lang,
          selected_language: lang,
          data: { ...data, pendingCartItem: null, cart: newCart }
        });

        await sendPostItemMenu(phone, lang, newCart);
        return;
      }

      await upsertSession(phone, {
        state: "await_item_note_text",
        language: lang,
        selected_language: lang,
        data
      });

      await safeSendText(phone, tr(lang, "أرسل ملاحظتك على هذا الصنف نصيًا.", "Please send your note for this item as text."));
      return;
    }

    if (parsed.value.name === "go_schedule") {
      await upsertSession(phone, {
        state: "await_schedule_type",
        language: lang,
        selected_language: lang,
        data
      });

      await sendScheduleTypeMenu(phone, lang);
      return;
    }

    if (parsed.value.name === "schedule") {
      if (parsed.value.a === "same_day") {
        const sameDaySlots = availableSameDaySlots(CONFIG.orderFlow.timeSlots, CONFIG.timezone);
        if (!sameDaySlots.length) {
          await safeSendText(phone, tr(lang, "تم إغلاق مواعيد اليوم، ويسعدنا تجهيز طلبك لليوم التالي بكل عناية 🌿", "Today's slots are closed, and we would be happy to prepare your order for the next day with care 🌿"));
          await sendScheduleTypeMenu(phone, lang);
          return;
        }

        await upsertSession(phone, {
          state: "await_delivery_method",
          language: lang,
          selected_language: lang,
          data: { ...data, scheduleType: "same_day", requestedDate: todayInTimezone(CONFIG.timezone) }
        });

        await sendDeliveryMethodMenu(phone, lang);
        return;
      }

      await upsertSession(phone, {
        state: "await_custom_date",
        language: lang,
        selected_language: lang,
        data: { ...data, scheduleType: "another_day" }
      });

      await safeSendText(phone, tr(lang, "أرسل تاريخ الطلب بصيغة YYYY-MM-DD أو DD/MM/YYYY", "Send the order date in YYYY-MM-DD or DD/MM/YYYY format."));
      return;
    }

    if (parsed.value.name === "delivery_method") {
      const method = parsed.value.a;

      if (method === "DELIVERY") {
        await upsertSession(phone, {
          state: "await_delivery_area",
          language: lang,
          selected_language: lang,
          data: { ...data, deliveryMethod: "DELIVERY" }
        });

        await sendDeliveryAreaMenu(phone, lang);
        return;
      }

      await upsertSession(phone, {
        state: "await_time_slot",
        language: lang,
        selected_language: lang,
        data: { ...data, deliveryMethod: "PICKUP", zoneId: null, deliveryAreaLabel: null, governorateLabel: null, addressText: null }
      });

      await sendTimeSlotsMenu(phone, lang, data.scheduleType);
      return;
    }

    if (parsed.value.name === "delivery_area") {
      if (parsed.value.a === "amman") {
        await upsertSession(phone, {
          state: "await_time_slot",
          language: lang,
          selected_language: lang,
          data: { ...data, deliveryAreaLabel: "عمّان", zoneId: "amman-central", governorateLabel: "عمّان" }
        });
        await sendTimeSlotsMenu(phone, lang, data.scheduleType);
        return;
      }

      if (parsed.value.a === "amman_outer") {
        await upsertSession(phone, {
          state: "await_time_slot",
          language: lang,
          selected_language: lang,
          data: { ...data, deliveryAreaLabel: "أطراف عمّان", zoneId: "amman-outer", governorateLabel: "عمّان" }
        });
        await sendTimeSlotsMenu(phone, lang, data.scheduleType);
        return;
      }

      await upsertSession(phone, {
        state: "await_governorate_list",
        language: lang,
        selected_language: lang,
        data: { ...data, deliveryAreaLabel: "المحافظات والقرى" }
      });

      await sendGovernorateListMenu(phone, lang);
      return;
    }

    if (parsed.value.name === "govlist") {
      const gov = decodeURIComponent(parsed.value.a);

      await upsertSession(phone, {
        state: "await_time_slot",
        language: lang,
        selected_language: lang,
        data: { ...data, governorateLabel: gov, zoneId: "irbid" } // رسم المحافظات موحّد حاليًا
      });

      await sendTimeSlotsMenu(phone, lang, data.scheduleType);
      return;
    }

    if (parsed.value.name === "slot") {
      const slot = decodeURIComponent(parsed.value.a);

      if (data.deliveryMethod === "DELIVERY") {
        await upsertSession(phone, {
          state: "await_address_text",
          language: lang,
          selected_language: lang,
          data: { ...data, requestedTime: slot }
        });

        await safeSendText(phone, tr(lang, "أرسل العنوان التفصيلي المطلوب للتوصيل.", "Please send the detailed delivery address."));
        return;
      }

      await upsertSession(phone, {
        state: "await_general_note",
        language: lang,
        selected_language: lang,
        data: { ...data, requestedTime: slot }
      });

      await safeSendText(phone, tr(lang, "أرسل ملاحظات عامة على الطلب إن وجدت، أو أرسل 0.", "Send any general order notes if needed, or send 0."));
      return;
    }

    if (parsed.value.name === "submit_order") {
      await createAndSendOrder(phone, profileName, lang, data);
      return;
    }

    if (parsed.value.name === "fr_country") {
      if (parsed.value.a === "outside") {
        await upsertSession(phone, {
          state: "await_franchise_country_text",
          language: lang,
          selected_language: lang,
          data: { franchise: { countryChoice: "outside_jordan" } }
        });

        await safeSendText(phone, tr(lang, "أرسل اسم الدولة المطلوبة.", "Please send the target country name."));
        return;
      }

      await upsertSession(phone, {
        state: "await_franchise_governorate",
        language: lang,
        selected_language: lang,
        data: { franchise: { countryChoice: "jordan" } }
      });

      await safeSendList(
        phone,
        tr(lang, "اختر المحافظة المطلوبة 👇", "Choose the governorate 👇"),
        tr(lang, "المحافظة", "Governorate"),
        [
          {
            title: tr(lang, "محافظات الأردن", "Jordan Governorates"),
            rows: ["عمّان", ...JORDAN_GOVERNORATES].slice(0, 10).map((gov) => ({
              id: `choice:fr_gov:${encodeURIComponent(gov)}`,
              title: gov,
              description: " "
            }))
          }
        ],
        CONFIG.business.name
      );
      await sendControlButtons(phone, lang, "home", false);
      return;
    }

    if (parsed.value.name === "fr_gov") {
      const gov = decodeURIComponent(parsed.value.a);
      if (gov === "عمّان") {
        await upsertSession(phone, {
          state: "await_franchise_amman_area",
          language: lang,
          selected_language: lang,
          data: { franchise: { ...(data.franchise || {}), governorate: gov } }
        });

        await safeSendList(
          phone,
          tr(lang, "اختر منطقة عمّان 👇", "Choose the Amman area 👇"),
          tr(lang, "منطقة عمّان", "Amman Area"),
          [
            {
              title: tr(lang, "مناطق عمّان", "Amman Areas"),
              rows: ["غرب عمّان", "شرق عمّان", "أم السماق", "الصويفية", "دابوق", "خلدا", "الجبيهة", "تلاع العلي", "مرج الحمام", "عبدون"].map((area) => ({
                id: `choice:fr_area:${encodeURIComponent(area)}`,
                title: area,
                description: " "
              }))
            }
          ],
          CONFIG.business.name
        );
        await sendControlButtons(phone, lang, "home", false);
        return;
      }

      await upsertSession(phone, {
        state: "await_franchise_branch",
        language: lang,
        selected_language: lang,
        data: { franchise: { ...(data.franchise || {}), governorate: gov } }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل ترغب بفرع واحد أم أكثر من فرع؟", "Are you interested in one branch or multiple branches?"),
        [
          { id: "choice:fr_branch:1", title: tr(lang, "فرع واحد", "One Branch") },
          { id: "choice:fr_branch:more", title: tr(lang, "أكثر من فرع", "Multiple") },
          { id: "nav:cancel", title: tr(lang, "خروج", "Exit") }
        ]
      );
      return;
    }

    if (parsed.value.name === "fr_area") {
      const area = decodeURIComponent(parsed.value.a);

      await upsertSession(phone, {
        state: "await_franchise_branch",
        language: lang,
        selected_language: lang,
        data: { franchise: { ...(data.franchise || {}), governorate: "عمّان", ammanArea: area } }
      });

      await safeSendButtons(
        phone,
        tr(lang, "هل ترغب بفرع واحد أم أكثر من فرع؟", "Are you interested in one branch or multiple branches?"),
        [
          { id: "choice:fr_branch:1", title: tr(lang, "فرع واحد", "One Branch") },
          { id: "choice:fr_branch:more", title: tr(lang, "أكثر من فرع", "Multiple") },
          { id: "nav:cancel", title: tr(lang, "خروج", "Exit") }
        ]
      );
      return;
    }

    if (parsed.value.name === "fr_branch") {
      await upsertSession(phone, {
        state: "await_franchise_notes",
        language: lang,
        selected_language: lang,
        data: { franchise: { ...(data.franchise || {}), branchCount: parsed.value.a === "1" ? 1 : 2 } }
      });

      await safeSendText(phone, tr(lang, "أرسل أي ملاحظات أو معلومات إضافية، أو أرسل 0.", "Send any notes or extra information, or send 0."));
      return;
    }
  }

  if (parsed.type === "support") {
    await upsertSession(phone, {
      state: "await_support_message",
      language: lang,
      selected_language: lang,
      data: { supportType: parsed.value }
    });

    await safeSendText(phone, tr(lang, `أرسل ${supportTypeLabel(lang, parsed.value)}ك الآن نصيًا.`, `Please send your ${supportTypeLabel(lang, parsed.value).toLowerCase()} now as text.`));
    return;
  }

  if (parsed.type === "partner") {
    const meta = PARTNER_TYPES.find((item) => item.key === parsed.value);
    if (!meta) {
      await sendHomeMenu(phone, lang);
      return;
    }

    await upsertSession(phone, {
      state: "await_partner_message",
      language: lang,
      selected_language: lang,
      data: { partnerType: meta.key }
    });

    await safeSendText(phone, tr(lang, `أرسل تفاصيل طلب ${meta.ar} نصيًا.`, `Please send the details of your ${meta.en.toLowerCase()} request.`));
    return;
  }

  if (session.state === "await_custom_people_count") {
    if (parsed.type !== "text" || !isPositiveInteger(parsed.value)) {
      await safeSendText(phone, tr(lang, "أدخل عدد الأشخاص بالأرقام فقط.", "Enter the number of people using digits only."));
      return;
    }

    const product = await getProductByKey("main", data.currentProductKey);
    if (!product) return sendProductsMenu(phone, lang, "main");

    const cartItem = buildProductCartItem(product, { peopleCount: Number(parsed.value) });

    await upsertSession(phone, {
      state: "await_note",
      language: lang,
      selected_language: lang,
      data: { ...data, pendingCartItem: cartItem }
    });

    await safeSendButtons(
      phone,
      tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
      [
        { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
        { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
        { id: "nav:back:products:main", title: tr(lang, "رجوع", "Back") }
      ]
    );
    return;
  }

  if (session.state === "await_custom_meat_kg") {
    if (parsed.type !== "text" || !isPositiveInteger(parsed.value)) {
      await safeSendText(phone, tr(lang, "أدخل الكمية بالكيلو بالأرقام فقط.", "Enter the kilograms using digits only."));
      return;
    }

    const product = await getProductByKey("meat", data.currentProductKey);
    if (!product) return sendProductsMenu(phone, lang, "meat");

    const cartItem = buildProductCartItem(product, {
      meatType: data.selectedMeatType,
      kilos: Number(parsed.value)
    });

    await upsertSession(phone, {
      state: "await_note",
      language: lang,
      selected_language: lang,
      data: { ...data, pendingCartItem: cartItem }
    });

    await safeSendButtons(
      phone,
      tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
      [
        { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
        { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
        { id: `nav:back:meattype:${product.key}`, title: tr(lang, "رجوع", "Back") }
      ]
    );
    return;
  }

  if (session.state === "await_custom_simple_qty") {
    if (parsed.type !== "text" || !isPositiveInteger(parsed.value)) {
      await safeSendText(phone, tr(lang, "أدخل الكمية بالأرقام فقط.", "Enter the quantity using digits only."));
      return;
    }

    const product = await getProductByKey(data.sectionId, data.currentProductKey);
    if (!product) return sendProductsMenu(phone, lang, data.sectionId);

    const cartItem = buildProductCartItem(product, {
      sizeKey: product.sizes?.[0]?.key,
      quantity: Number(parsed.value)
    });

    await upsertSession(phone, {
      state: "await_note",
      language: lang,
      selected_language: lang,
      data: { ...data, pendingCartItem: cartItem }
    });

    await safeSendButtons(
      phone,
      tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
      [
        { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
        { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
        { id: `nav:back:products:${data.sectionId}`, title: tr(lang, "رجوع", "Back") }
      ]
    );
    return;
  }

  if (session.state === "await_custom_simple_size_qty") {
    if (parsed.type !== "text" || !isPositiveInteger(parsed.value)) {
      await safeSendText(phone, tr(lang, "أدخل الكمية بالأرقام فقط.", "Enter the quantity using digits only."));
      return;
    }

    const product = await getProductByKey(data.sectionId, data.currentProductKey);
    if (!product) return sendProductsMenu(phone, lang, data.sectionId);

    const cartItem = buildProductCartItem(product, {
      sizeKey: data.selectedSizeKey,
      quantity: Number(parsed.value)
    });

    await upsertSession(phone, {
      state: "await_note",
      language: lang,
      selected_language: lang,
      data: { ...data, pendingCartItem: cartItem }
    });

    await safeSendButtons(
      phone,
      tr(lang, "هل لديك ملاحظات على هذا الصنف؟", "Do you have notes for this item?"),
      [
        { id: "choice:item_note:none", title: tr(lang, "بدون ملاحظات", "No Notes") },
        { id: "choice:item_note:write", title: tr(lang, "أكتب ملاحظتي", "Write Note") },
        { id: `nav:back:products:${data.sectionId}`, title: tr(lang, "رجوع", "Back") }
      ]
    );
    return;
  }

  if (session.state === "await_item_note_text") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل ملاحظتك نصيًا.", "Please send your note as text."));
      return;
    }

    const cartItem = { ...(data.pendingCartItem || {}), notes: parsed.value };
    const newCart = [...(data.cart || []), cartItem];

    await upsertSession(phone, {
      state: "await_post_item",
      language: lang,
      selected_language: lang,
      data: { ...data, pendingCartItem: null, cart: newCart }
    });

    await sendPostItemMenu(phone, lang, newCart);
    return;
  }

  if (session.state === "await_custom_date") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل التاريخ بصيغة صحيحة.", "Please send a valid date format."));
      return;
    }

    const dateValue = parseDateInput(parsed.value, CONFIG.timezone);
    if (!dateValue) {
      await safeSendText(phone, tr(lang, "صيغة التاريخ غير صحيحة. مثال: 2026-03-15", "The date format is invalid. Example: 2026-03-15"));
      return;
    }

    await upsertSession(phone, {
      state: "await_delivery_method",
      language: lang,
      selected_language: lang,
      data: { ...data, scheduleType: "another_day", requestedDate: dateValue }
    });

    await sendDeliveryMethodMenu(phone, lang);
    return;
  }

  if (session.state === "await_address_text") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل العنوان التفصيلي نصيًا.", "Please send the detailed address as text."));
      return;
    }

    await upsertSession(phone, {
      state: "await_general_note",
      language: lang,
      selected_language: lang,
      data: { ...data, addressText: parsed.value }
    });

    await safeSendText(phone, tr(lang, "أرسل ملاحظات عامة على الطلب إن وجدت، أو أرسل 0.", "Send any general order notes if needed, or send 0."));
    return;
  }

  if (session.state === "await_general_note") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الملاحظات نصيًا أو 0.", "Send the notes as text or 0."));
      return;
    }

    const nextData = { ...data, customerNote: parsed.value === "0" ? "" : parsed.value };
    const zone = nextData.zoneId ? await getZoneById(nextData.zoneId) : null;
    const deliveryFee = nextData.deliveryMethod === "DELIVERY" ? Number(zone?.delivery_fee || 0) : 0;
    const totals = await calculateCartSummary(nextData.cart || [], deliveryFee);

    await upsertSession(phone, {
      state: "await_submit",
      language: lang,
      selected_language: lang,
      data: nextData
    });

    await sendBeforeSubmitMenu(phone, lang, zone, nextData, totals);
    return;
  }

  if (session.state === "await_support_message") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الرسالة نصيًا.", "Please send the message as text."));
      return;
    }

    const type = data.supportType || "note";
    const customer = await getCustomer(phone).catch(() => null);

    await createSupportRequest({
      requestType: type,
      phone,
      name: profileName || customer?.display_name || null,
      language: lang,
      customerId: customer?.id || null,
      notes: parsed.value,
      payload: { source: "whatsapp" }
    });

    await createCustomerFeedback({
      phone,
      customerId: customer?.id || null,
      feedbackType: type,
      message: parsed.value,
      payload: { source: "whatsapp" }
    }).catch(() => null);

    await notifyAdmins(compactText([
      `📌 رسالة جديدة: ${supportTypeLabel("ar", type)}`,
      `الاسم: ${profileName || "-"}`,
      `الهاتف: ${phone}`,
      `الرسالة: ${parsed.value}`
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "شكرًا لك 🌿 تم استلام رسالتك وتحويلها إلى الإدارة.", "Thank you 🌿 Your message has been received and forwarded to the admin team."));
    await sendHomeMenu(phone, lang);
    return;
  }

  if (session.state === "await_staff_booking_details") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل تفاصيل الحجز نصيًا.", "Please send the booking details as text."));
      return;
    }

    await upsertSession(phone, {
      state: "await_staff_booking_date",
      language: lang,
      selected_language: lang,
      data: { staffBooking: { details: parsed.value } }
    });

    await safeSendText(phone, tr(lang, "أرسل تاريخ الحجز المطلوب بصيغة YYYY-MM-DD أو DD/MM/YYYY", "Please send the requested booking date in YYYY-MM-DD or DD/MM/YYYY format."));
    return;
  }

  if (session.state === "await_staff_booking_date") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل التاريخ بصيغة صحيحة.", "Please send a valid date format."));
      return;
    }

    const dateValue = parseDateInput(parsed.value, CONFIG.timezone);
    if (!dateValue) {
      await safeSendText(phone, tr(lang, "صيغة التاريخ غير صحيحة.", "The date format is invalid."));
      return;
    }

    await upsertSession(phone, {
      state: "await_staff_booking_time",
      language: lang,
      selected_language: lang,
      data: { staffBooking: { ...(data.staffBooking || {}), requestedDate: dateValue } }
    });

    await safeSendText(phone, tr(lang, "أرسل الوقت أو الفترة التقريبية المطلوبة.", "Please send the preferred time or approximate period."));
    return;
  }

  if (session.state === "await_staff_booking_time") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الوقت نصيًا.", "Please send the time as text."));
      return;
    }

    await upsertSession(phone, {
      state: "await_staff_booking_notes",
      language: lang,
      selected_language: lang,
      data: { staffBooking: { ...(data.staffBooking || {}), requestedTime: parsed.value } }
    });

    await safeSendText(phone, tr(lang, "أرسل أي ملاحظات إضافية، أو أرسل 0 إذا لا توجد.", "Send any additional notes, or send 0 if there are none."));
    return;
  }

  if (session.state === "await_staff_booking_notes") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الملاحظات نصيًا أو 0.", "Send the notes as text or 0."));
      return;
    }

    const booking = data.staffBooking || {};
    const customer = await getCustomer(phone).catch(() => null);

    await createSupportRequest({
      requestType: "staff_booking",
      phone,
      name: profileName || customer?.display_name || null,
      language: lang,
      customerId: customer?.id || null,
      notes: parsed.value === "0" ? null : parsed.value,
      payload: {
        details: booking.details,
        requestedDate: booking.requestedDate,
        requestedTime: booking.requestedTime
      }
    });

    await notifyAdmins(compactText([
      "📞 طلب تثبيت حجز مع موظف",
      `الاسم: ${profileName || "-"}`,
      `الهاتف: ${phone}`,
      `التفاصيل: ${booking.details || "-"}`,
      `التاريخ: ${booking.requestedDate || "-"}`,
      `الوقت: ${booking.requestedTime || "-"}`,
      parsed.value !== "0" ? `ملاحظات: ${parsed.value}` : ""
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم تسجيل طلبك وسيتم التواصل معك بأقرب وقت لتثبيت الحجز.", "Your request has been recorded and the team will contact you shortly to finalize the booking."));
    await sendHomeMenu(phone, lang);
    return;
  }

  if (session.state === "await_franchise_country_text") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل اسم الدولة نصيًا.", "Please send the country name as text."));
      return;
    }

    await upsertSession(phone, {
      state: "await_franchise_notes",
      language: lang,
      selected_language: lang,
      data: { franchise: { ...(data.franchise || {}), outsideCountry: parsed.value, branchCount: 1 } }
    });

    await safeSendText(phone, tr(lang, "أرسل أي ملاحظات أو معلومات إضافية، أو أرسل 0.", "Send any notes or extra information, or send 0."));
    return;
  }

  if (session.state === "await_franchise_notes") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الملاحظات نصيًا أو 0.", "Please send the notes as text or 0."));
      return;
    }

    const customer = await getCustomer(phone).catch(() => null);
    const franchise = data.franchise || {};

    await createFranchiseLead({
      phone,
      name: profileName || customer?.display_name || null,
      language: lang,
      countryChoice: franchise.countryChoice || "jordan",
      governorate: franchise.governorate || null,
      ammanArea: franchise.ammanArea || null,
      branchCount: franchise.branchCount || 1,
      notes: parsed.value === "0" ? null : parsed.value,
      payload: { outsideCountry: franchise.outsideCountry || null }
    });

    await notifyAdmins(compactText([
      "🏷️ طلب امتياز العلامة التجارية",
      `الاسم: ${profileName || "-"}`,
      `الهاتف: ${phone}`,
      franchise.countryChoice === "outside_jordan" ? `الدولة: ${franchise.outsideCountry || "-"}` : `المحافظة: ${franchise.governorate || "-"}`,
      franchise.ammanArea ? `منطقة عمّان: ${franchise.ammanArea}` : "",
      `عدد الفروع: ${franchise.branchCount || 1}`,
      parsed.value !== "0" ? `ملاحظات: ${parsed.value}` : ""
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم تسجيل طلب الامتياز بنجاح وسيتم التواصل معك عند أقرب فرصة.", "Your franchise request has been recorded successfully and the team will contact you soon."));
    await sendHomeMenu(phone, lang);
    return;
  }

  if (session.state === "await_partner_message") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل التفاصيل نصيًا.", "Please send the details as text."));
      return;
    }

    const type = data.partnerType || "job_applicant";
    const meta = PARTNER_TYPES.find((item) => item.key === type);
    const customer = await getCustomer(phone).catch(() => null);

    if (type === "job_applicant") {
      await createJobApplication({
        phone,
        name: profileName || customer?.display_name || null,
        language: lang,
        jobType: "general",
        notes: parsed.value,
        payload: { source: "whatsapp" }
      });
    } else {
      await createSupportRequest({
        requestType: type,
        phone,
        name: profileName || customer?.display_name || null,
        language: lang,
        customerId: customer?.id || null,
        notes: parsed.value,
        payload: { category: "partner_request" }
      });
    }

    await notifyAdmins(compactText([
      `📥 طلب جديد: ${meta?.ar || type}`,
      `الاسم: ${profileName || "-"}`,
      `الهاتف: ${phone}`,
      `التفاصيل: ${parsed.value}`
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم استلام طلبك وتحويله إلى الإدارة بنجاح.", "Your request has been received and forwarded to the admin team successfully."));
    await sendHomeMenu(phone, lang);
    return;
  }

  if (session.state === "await_customer_change_request") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل تفاصيل التعديل نصيًا.", "Please send the change details as text."));
      return;
    }

    const orderId = session.pending_meta?.orderId;
    const updated = await updateOrder(orderId, {
      status: "CUSTOMER_REQUESTED_CHANGES",
      awaiting_customer_final_confirmation: false,
      customer_final_action: "REQUESTED_CHANGES",
      customer_final_action_at: new Date().toISOString(),
      customer_change_request: parsed.value,
      note: "Customer requested changes",
      actor_role: "customer"
    });

    await notifyAdmins(compactText([
      "✏️ العميل طلب تثبيت الطلب مع تعديلات",
      `الطلب: ${updated.order_number}`,
      `الهاتف: ${updated.customer_phone}`,
      `تفاصيل التعديل: ${parsed.value}`
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم استلام طلب التعديل وسيتم مراجعته من الإدارة.", "The change request has been received and will be reviewed by the admin team."));
    return;
  }

  if (session.state === "await_customer_postpone_request") {
    if (parsed.type !== "text") {
      await safeSendText(phone, tr(lang, "أرسل الموعد الجديد نصيًا.", "Please send the new requested timing as text."));
      return;
    }

    const orderId = session.pending_meta?.orderId;
    const updated = await updateOrder(orderId, {
      status: "CUSTOMER_POSTPONED",
      awaiting_customer_final_confirmation: false,
      customer_final_action: "POSTPONED",
      customer_final_action_at: new Date().toISOString(),
      customer_postponed_time: parsed.value,
      note: "Customer requested postponement",
      actor_role: "customer"
    });

    await notifyAdmins(compactText([
      "⏳ العميل طلب تأجيل الطلب",
      `الطلب: ${updated.order_number}`,
      `الهاتف: ${updated.customer_phone}`,
      `الموعد الجديد المطلوب: ${parsed.value}`
    ]));

    await resetSession(phone, { selectedLanguage: lang });
    await safeSendText(phone, tr(lang, "تم استلام طلب التأجيل وسيتم تثبيت الموعد الجديد بعد مراجعة الإدارة.", "The postponement request has been received and the new timing will be confirmed after admin review."));
    return;
  }

  await sendHomeMenu(phone, lang);
}
