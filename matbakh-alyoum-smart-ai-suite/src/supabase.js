import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

export const supabase = createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export function normalizePhone(phone = "") {
  return String(phone).replace(/\D+/g, "");
}

export function detectLanguage(text = "") {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

export async function findCustomerByPhone(phone) {
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("phone", normalized)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("FIND_CUSTOMER_ERROR", error.message);
    return null;
  }

  return data || null;
}

export async function createCustomerIfMissing(
  phone,
  name = null,
  preferredLanguage = "ar"
) {
  const normalized = normalizePhone(phone);
  const existing = await findCustomerByPhone(normalized);
  if (existing) return existing;

  const now = new Date().toISOString();

  const payload = {
    phone: normalized,
    name,
    display_name: name,
    preferred_language: preferredLanguage,
    customer_status: "new",
    channel: "whatsapp",
    source_channel: "whatsapp",
    channel_user_id: normalized,
    is_active_customer: true,
    created_at: now,
    updated_at: now,
    last_seen_at: now,
    last_incoming_at: now,
  };

  const { data, error } = await supabase
    .from("customers")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("CREATE_CUSTOMER_ERROR", error.message);
    return null;
  }

  return data;
}

/**
 * معطل مؤقتًا لتثبيت التشغيل
 * لأن جدول conversations عنده قيود غير محسومة حاليًا
 */
export async function logConversation(_payload) {
  return true;
}

/**
 * نعتمد customer_facts كذاكرة المحادثة الرسمية
 * بدل chat_state لتفادي مشاكل المفاتيح والقيود الحالية
 */
export async function readChatState(phone) {
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("customer_facts")
    .select("*")
    .eq("phone", normalized)
    .eq("fact_key", "chat_state")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("READ_CHAT_STATE_ERROR", error.message);
  }

  if (data?.fact_value) {
    return {
      phone_normalized: normalized,
      state: data.fact_value.state || "START",
      context: data.fact_value.context || {},
      updated_at: data.updated_at || null,
    };
  }

  return {
    phone_normalized: normalized,
    state: "START",
    context: {},
    updated_at: null,
  };
}

export async function writeChatState(phone, state, context = {}) {
  const normalized = normalizePhone(phone);
  const customer = await findCustomerByPhone(normalized);

  const payload = {
    customer_id: customer?.id || null,
    phone: normalized,
    fact_key: "chat_state",
    fact_value: {
      state,
      context,
      last_activity_at: new Date().toISOString(),
    },
    source: "bot",
    confidence: 0.99,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabase
    .from("customer_facts")
    .select("id")
    .eq("phone", normalized)
    .eq("fact_key", "chat_state")
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    const { error } = await supabase
      .from("customer_facts")
      .update(payload)
      .eq("id", existing.data.id);

    if (error) {
      console.error("WRITE_CHAT_STATE_ERROR", error.message);
      return false;
    }

    return true;
  }

  const { error } = await supabase.from("customer_facts").insert(payload);

  if (error) {
    console.error("WRITE_CHAT_STATE_ERROR", error.message);
    return false;
  }

  return true;
}

export async function clearChatState(phone) {
  return writeChatState(phone, "START", {});
}

export async function saveCustomerFact(phone, key, value) {
  const normalized = normalizePhone(phone);
  const customer = await findCustomerByPhone(normalized);

  const payload = {
    customer_id: customer?.id || null,
    phone: normalized,
    fact_key: key,
    fact_value: value,
    source: "bot",
    confidence: 0.95,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabase
    .from("customer_facts")
    .select("id")
    .eq("phone", normalized)
    .eq("fact_key", key)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    const { error } = await supabase
      .from("customer_facts")
      .update(payload)
      .eq("id", existing.data.id);

    if (error) {
      console.error("SAVE_CUSTOMER_FACT_ERROR", error.message);
    }
    return;
  }

  const { error } = await supabase.from("customer_facts").insert(payload);

  if (error) {
    console.error("SAVE_CUSTOMER_FACT_ERROR", error.message);
  }
}

export async function getKnowledgeAnswer(text) {
  const cleaned = String(text || "").trim();

  if (!cleaned) return null;

  const exact = await supabase
    .from("bot_knowledge_entries")
    .select("question, answer, category, priority")
    .eq("question", cleaned)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!exact.error && exact.data?.answer) {
    return exact.data.answer;
  }

  const keywordsMap = [
    { test: /مطبوخ/, q: "هل الأكل مطبوخ؟" },
    { test: /موقع|عنوان|وين/, q: "وين موقعكم؟" },
    { test: /توصيل|دليفري|يوصل/, q: "هل يوجد توصيل؟" },
    { test: /منيو|شو عندكم|شو في|الأصناف|الاصناف/, q: "ما هي الأصناف المتوفرة؟" },
  ];

  const matched = keywordsMap.find((item) => item.test.test(cleaned));
  if (!matched) return null;

  const mapped = await supabase
    .from("bot_knowledge_entries")
    .select("question, answer, category, priority")
    .eq("question", matched.q)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mapped.error && mapped.data?.answer) {
    return mapped.data.answer;
  }

  return null;
}

export async function getMenuCategories() {
  const { data, error } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("GET_MENU_CATEGORIES_ERROR", error.message);
    return [];
  }

  return data || [];
}

export async function getMenuItemsByCategory(categoryKeyOrId) {
  let query = supabase
    .from("menu_items")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (
    typeof categoryKeyOrId === "string" &&
    categoryKeyOrId &&
    !/^\d+$/.test(categoryKeyOrId)
  ) {
    query = query.eq("category_key", categoryKeyOrId);
  } else {
    query = query.eq("category_id", categoryKeyOrId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("GET_MENU_ITEMS_BY_CATEGORY_ERROR", error.message);
    return [];
  }

  return data || [];
}

export async function getMenuItemByKey(itemKey) {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("item_key", itemKey)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("GET_MENU_ITEM_BY_KEY_ERROR", error.message);
    return null;
  }

  return data || null;
}

export async function getActiveOffers() {
  const { data, error } = await supabase
    .from("sales_offers")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("GET_ACTIVE_OFFERS_ERROR", error.message);
    return [];
  }

  return data || [];
}

export async function getDeliveryZones() {
  const { data, error } = await supabase
    .from("delivery_zones")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("GET_DELIVERY_ZONES_ERROR", error.message);
    return [];
  }

  return data || [];
}

export async function createDraftOrder({
  phone,
  customerId = null,
  items = [],
  subtotal = null,
  deliveryArea = null,
  deliveryAddress = null,
  paymentMethod = null,
  requestedDeliveryTime = null,
  customerNotes = null,
}) {
  const normalized = normalizePhone(phone);
  const customer = customerId
    ? { id: customerId }
    : await findCustomerByPhone(normalized);

  const firstItem = Array.isArray(items) && items.length ? items[0] : {};
  const now = new Date().toISOString();

  const quantityNumber =
    firstItem.quantity != null
      ? Number(String(firstItem.quantity).replace(/[^\d.]/g, "")) || null
      : null;

  const payload = {
    customer_id: customer?.id || null,
    customer_phone: normalized,

    items,
    subtotal: subtotal,
    total: subtotal,

    status: "pending",
    status_label: "بانتظار المراجعة",

    product: firstItem.dish || null,
    protein: firstItem.protein || null,
    meat_type: firstItem.protein === "لحم" ? "لحم" : null,
    chicken_count: firstItem.protein === "دجاج" ? quantityNumber : null,
    qty_meals:
      firstItem.protein !== "دجاج" && firstItem.quantity != null
        ? String(firstItem.quantity)
        : null,

    delivery_area: deliveryArea,
    area: deliveryArea,
    delivery_area_name: deliveryArea,
    delivery_address: deliveryAddress,

    requested_time: requestedDeliveryTime,
    delivery_time: requestedDeliveryTime,

    payment_method: paymentMethod,
    customer_note: customerNotes,
    notes: customerNotes,

    channel: "whatsapp",
    source_channel: "whatsapp",

    approval_mode: CONFIG.orderFlow.approvalModeDefault || "manual_first",
    approval_policy: "manual_first",
    awaiting_customer_final_confirmation: true,

    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("orders")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("CREATE_DRAFT_ORDER_ERROR", error.message);
    return null;
  }

  return data;
}

export async function getLastOpenDraftOrder(phone) {
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_phone", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("GET_LAST_OPEN_DRAFT_ORDER_ERROR", error.message);
    return null;
  }

  return data || null;
}
