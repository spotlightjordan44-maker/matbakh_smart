import { CONFIG } from "./config.js";
import {
  listActiveCategories,
  listActiveItems,
  listActiveSalesOffers,
  listActiveZones
} from "./supabase.js";

const SECTION_MAP = {
  "أطباق دجاج (حسب عدد الدجاج)": { id: "chicken", title: "أطباق دجاج" },
  "أطباق لحوم (بلدي/روماني)": { id: "meat", title: "أطباق لحم" },
  "المحاشي": { id: "mahashi", title: "المحاشي" },
  "أطباق منزلية (شخصين/4/6)": { id: "main", title: "أطباق رئيسية" },
  "الشوربات": { id: "soups", title: "الشوربات" },
  "السلطات": { id: "salads", title: "السلطات" },
  "مفرزات": { id: "frozen", title: "المفرزات" }
};

const SECTION_ORDER = ["chicken", "meat", "mahashi", "main", "soups", "salads", "frozen"];

let cache = {
  categories: [],
  items: [],
  offers: [],
  zones: [],
  grouped: {},
  lastLoadAt: 0
};

function priceOf(item) {
  if (item?.public_price !== null && item?.public_price !== undefined) return Number(item.public_price || 0);
  if (item?.base_price !== null && item?.base_price !== undefined) return Number(item.base_price || 0);
  return 0;
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} ${CONFIG.business.currency}`;
}

function safeKey(value) {
  return encodeURIComponent(String(value || "").trim().toLowerCase());
}

function decodeKey(value) {
  return decodeURIComponent(String(value || ""));
}

function normalizeSection(cat) {
  const mapped = SECTION_MAP[cat.name] || null;
  if (!mapped) return null;
  return {
    id: mapped.id,
    title: mapped.title,
    rawCategoryId: cat.id,
    rawCategoryName: cat.name
  };
}

function groupChicken(items) {
  const groups = new Map();

  for (const item of items) {
    const rawTitle = String(item.title || "").trim();
    const base = rawTitle.split(" - ")[0].trim();
    const key = safeKey(base);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind: "chicken",
        title: `${base} دجاج`,
        baseName: base,
        oneUnitPrice: 0,
        sort: item.sort_order || 999
      });
    }

    const group = groups.get(key);
    const price = priceOf(item);

    if (rawTitle.includes("دجاجة") && !rawTitle.includes("دجاجتين") && !rawTitle.includes("3")) {
      group.oneUnitPrice = price || group.oneUnitPrice;
    }

    if (!group.oneUnitPrice && price) group.oneUnitPrice = price;
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      serviceNote: "تكفي من 3 - 4 أشخاص"
    }))
    .sort((a, b) => a.sort - b.sort);
}

function groupMain(items) {
  const groups = new Map();

  for (const item of items) {
    const rawTitle = String(item.title || "").trim();
    const [base, variant] = rawTitle.split(" - ").map((x) => String(x || "").trim());
    const key = safeKey(base);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind: "main",
        title: base,
        baseName: base,
        twoPeoplePrice: null,
        fourPeoplePrice: null,
        sixPeoplePrice: null,
        sort: item.sort_order || 999
      });
    }

    const group = groups.get(key);
    const price = priceOf(item);

    if (variant.includes("شخصين")) group.twoPeoplePrice = price;
    else if (variant.includes("4")) group.fourPeoplePrice = price;
    else if (variant.includes("6")) group.sixPeoplePrice = price;
  }

  return [...groups.values()]
    .map((group) => {
      const baseFour = Number(group.fourPeoplePrice || group.twoPeoplePrice || group.sixPeoplePrice || 0);
      const perPerson = baseFour > 0 ? baseFour / 4 : 0;

      return {
        ...group,
        perPersonPrice: perPerson,
        options: [
          { key: "2", title: "لشخصين", people: 2, totalPrice: perPerson ? perPerson * 2 : group.twoPeoplePrice || 0 },
          { key: "4", title: "4 أشخاص", people: 4, totalPrice: baseFour || 0 },
          { key: "6", title: "6 أشخاص", people: 6, totalPrice: perPerson ? perPerson * 6 : group.sixPeoplePrice || 0 },
          { key: "custom", title: "أدخل رقم", people: null, totalPrice: null }
        ]
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

function groupMeat(items) {
  const groups = new Map();

  for (const item of items) {
    const rawTitle = String(item.title || "").trim();

    const meatType =
      rawTitle.includes("بلدي") ? "baladi" :
      rawTitle.includes("روماني") ? "romani" :
      rawTitle.includes("نيوزلندي") ? "new_zealand" :
      "other";

    const base = rawTitle
      .replace(" بلدي", "")
      .replace(" روماني", "")
      .replace(" نيوزلندي", "")
      .split(" - ")[0]
      .trim();

    const key = safeKey(base);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind: "meat",
        title: base,
        baseName: base,
        sort: item.sort_order || 999,
        meatTypes: {}
      });
    }

    const group = groups.get(key);

    if (!group.meatTypes[meatType]) {
      group.meatTypes[meatType] = {
        key: meatType,
        title:
          meatType === "baladi" ? "بلدي" :
          meatType === "romani" ? "روماني" :
          meatType === "new_zealand" ? "نيوزلندي" :
          "نوع آخر",
        oneKgPrice: null,
        twoKgPrice: null,
        threeKgPrice: null
      };
    }

    const price = priceOf(item);
    if (rawTitle.includes("1 كيلو")) group.meatTypes[meatType].oneKgPrice = price;
    else if (rawTitle.includes("2 كيلو")) group.meatTypes[meatType].twoKgPrice = price;
    else if (rawTitle.includes("3 كيلو")) group.meatTypes[meatType].threeKgPrice = price;
  }

  return [...groups.values()].sort((a, b) => a.sort - b.sort);
}

function groupMahashi(items) {
  const groups = new Map();

  for (const item of items) {
    const rawTitle = String(item.title || "").trim();
    const base = rawTitle.split(" - ")[0].trim();
    const key = safeKey(base);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind: "mahashi",
        title: base,
        baseName: base,
        oneKgPrice: priceOf(item),
        sort: item.sort_order || 999
      });
    }
  }

  return [...groups.values()].sort((a, b) => a.sort - b.sort);
}

function groupSimple(items, kind) {
  const groups = new Map();

  for (const item of items) {
    const rawTitle = String(item.title || "").trim();
    const parts = rawTitle.split(" - ");
    const base = parts[0].trim();
    const size = parts[1] ? parts[1].trim() : (item.unit_label || "حبة");
    const key = safeKey(base);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind,
        title: base,
        baseName: base,
        sort: item.sort_order || 999,
        sizes: []
      });
    }

    groups.get(key).sizes.push({
      key: safeKey(size),
      title: size,
      unitPrice: priceOf(item),
      unitLabel: size
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sizes: group.sizes.sort((a, b) => a.unitPrice - b.unitPrice)
    }))
    .sort((a, b) => a.sort - b.sort);
}

function buildGrouped(items, categories) {
  const categoryMap = new Map(categories.map((cat) => [String(cat.id), cat]));
  const sections = {};

  for (const item of items) {
    const cat = categoryMap.get(String(item.category_id));
    if (!cat) continue;
    const section = normalizeSection(cat);
    if (!section) continue;

    if (!sections[section.id]) sections[section.id] = [];
    sections[section.id].push(item);
  }

  return {
    chicken: groupChicken(sections.chicken || []),
    meat: groupMeat(sections.meat || []),
    mahashi: groupMahashi(sections.mahashi || []),
    main: groupMain(sections.main || []),
    soups: groupSimple(sections.soups || [], "simple"),
    salads: groupSimple(sections.salads || [], "simple"),
    frozen: groupSimple(sections.frozen || [], "simple")
  };
}

export async function getCatalog(force = false) {
  const now = Date.now();
  if (!force && cache.lastLoadAt && now - cache.lastLoadAt < 60_000) {
    return cache;
  }

  const [categories, items, offers, zones] = await Promise.all([
    listActiveCategories().catch(() => []),
    listActiveItems().catch(() => []),
    listActiveSalesOffers().catch(() => []),
    listActiveZones().catch(() => [])
  ]);

  cache = {
    categories: Array.isArray(categories) ? categories : [],
    items: Array.isArray(items) ? items : [],
    offers: Array.isArray(offers) ? offers : [],
    zones: Array.isArray(zones) ? zones : [],
    grouped: buildGrouped(items || [], categories || []),
    lastLoadAt: now
  };

  return cache;
}

export async function getSections() {
  const { grouped } = await getCatalog();
  return SECTION_ORDER
    .filter((id) => Array.isArray(grouped[id]) && grouped[id].length > 0)
    .map((id) => ({
      id,
      title:
        id === "chicken" ? "أطباق دجاج" :
        id === "meat" ? "أطباق لحم" :
        id === "mahashi" ? "المحاشي" :
        id === "main" ? "أطباق رئيسية" :
        id === "soups" ? "الشوربات" :
        id === "salads" ? "السلطات" :
        "المفرزات"
    }));
}

export async function getProductsBySection(sectionId) {
  const { grouped } = await getCatalog();
  return grouped[sectionId] || [];
}

export async function getProductByKey(sectionId, key) {
  const products = await getProductsBySection(sectionId);
  return products.find((product) => String(product.key) === String(key)) || null;
}

export async function getZones() {
  const { zones } = await getCatalog();
  return zones || [];
}

export async function getZoneById(zoneId) {
  const { zones } = await getCatalog();
  return (zones || []).find((zone) => String(zone.id) === String(zoneId)) || null;
}

export async function getExclusiveOffers() {
  const { offers } = await getCatalog();
  return (offers || []).filter((offer) => Number(offer.sort_order || 0) <= 5 && offer.is_active !== false);
}

export async function getSuggestedOffers() {
  const { offers } = await getCatalog();
  return (offers || []).filter((offer) => Number(offer.sort_order || 0) > 5 && offer.is_active !== false);
}

export async function getOfferByCode(code) {
  const { offers } = await getCatalog();
  return (offers || []).find((offer) => String(offer.code) === String(code)) || null;
}

export function itemLabel(item) {
  return `${item.title} — ${money(priceOf(item))}`;
}

export function offerLabel(offer) {
  const original = offer.original_price ? ` بدل ${money(offer.original_price)}` : "";
  return `${offer.title} — ${money(offer.final_price)}${original}`;
}

export function buildOfferCartItem(offer, { useHalf = false, notes = "" } = {}) {
  const halfAllowed = offer.allow_half === true && offer.half_final_price !== null && offer.half_final_price !== undefined;
  const lineTotal = useHalf && halfAllowed ? Number(offer.half_final_price || 0) : Number(offer.final_price || 0);

  return {
    itemId: null,
    offerCode: offer.code,
    source: "sales_offer",
    title: useHalf && halfAllowed ? `${offer.title} - نص عرض` : offer.title,
    qty: 1,
    unitPrice: lineTotal,
    unitLabel: "عرض",
    notes,
    lineTotal
  };
}

export function buildProductCartItem(product, selection = {}) {
  if (!product) return null;

  if (product.kind === "chicken") {
    const count = Number(selection.count || 1);
    const unitPrice = Number(product.oneUnitPrice || 0);
    const chickenWord = count === 1 ? "دجاجة" : count === 2 ? "دجاجتين" : `${count} دجاجات`;

    return {
      itemId: null,
      source: "menu_product",
      title: `${product.title} - ${chickenWord}`,
      qty: count,
      unitPrice,
      unitLabel: "دجاجة",
      notes: selection.notes || "",
      lineTotal: unitPrice * count
    };
  }

  if (product.kind === "main") {
    const peopleCount = Number(selection.peopleCount || 4);
    const unitPrice = Number(product.perPersonPrice || 0) * peopleCount;

    return {
      itemId: null,
      source: "menu_product",
      title: `${product.title} - ${peopleCount} أشخاص`,
      qty: 1,
      unitPrice,
      unitLabel: `${peopleCount} أشخاص`,
      notes: selection.notes || "",
      lineTotal: unitPrice
    };
  }

  if (product.kind === "meat") {
    const meatType = selection.meatType || "baladi";
    const kilos = Number(selection.kilos || 1);
    const typeMeta = product.meatTypes?.[meatType];

    if (!typeMeta) return null;

    let totalPrice = null;
    if (kilos === 1) totalPrice = Number(typeMeta.oneKgPrice || 0);
    else if (kilos === 2) totalPrice = Number(typeMeta.twoKgPrice || (Number(typeMeta.oneKgPrice || 0) * 2));
    else if (kilos === 3) totalPrice = Number(typeMeta.threeKgPrice || (Number(typeMeta.oneKgPrice || 0) * 3));
    else totalPrice = Number(typeMeta.oneKgPrice || 0) * kilos;

    return {
      itemId: null,
      source: "menu_product",
      title: `${product.title} - ${typeMeta.title} - ${kilos} كيلو`,
      qty: 1,
      unitPrice: totalPrice,
      unitLabel: `${kilos} كيلو`,
      notes: selection.notes || "",
      lineTotal: totalPrice
    };
  }

  if (product.kind === "mahashi") {
    const kilos = Number(selection.kilos || 1);
    const unitPrice = Number(product.oneKgPrice || 0);

    return {
      itemId: null,
      source: "menu_product",
      title: `${product.title} - ${kilos} كيلو`,
      qty: kilos,
      unitPrice,
      unitLabel: "كيلو",
      notes: selection.notes || "",
      lineTotal: unitPrice * kilos
    };
  }

  if (product.kind === "simple") {
    const sizeKey = selection.sizeKey || product.sizes?.[0]?.key;
    const sizeMeta = (product.sizes || []).find((size) => String(size.key) === String(sizeKey)) || product.sizes?.[0];
    const quantity = Number(selection.quantity || 1);
    const unitPrice = Number(sizeMeta?.unitPrice || 0);

    return {
      itemId: null,
      source: "menu_product",
      title: `${product.title}${sizeMeta?.title ? ` - ${sizeMeta.title}` : ""}`,
      qty: quantity,
      unitPrice,
      unitLabel: sizeMeta?.unitLabel || "",
      notes: selection.notes || "",
      lineTotal: unitPrice * quantity
    };
  }

  return null;
}

export async function calculateCartSummary(cart = [], deliveryFee = 0) {
  const subtotal = (cart || []).reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const total = subtotal + Number(deliveryFee || 0);

  return {
    subtotal,
    deliveryFee: Number(deliveryFee || 0),
    total
  };
}
