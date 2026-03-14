import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

export const supabase = createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

export function normalizePhone(phone = "") {
  return String(phone).replace(/\D+/g, "");
}

export function detectLanguage(text = "") {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

async function ensureCustomerPhoneColumn(phone) {
  const normalized = normalizePhone(phone);

  // جدول customers عندك يحتوي phone وليس phone_normalized
  // لذلك نبحث أولاً في phone، ثم نحاول phone_normalized احتياطياً إن وُجد لاحقاً
  const byPhone = await supabase
    .from("customers")
    .select("*")
    .eq("phone", normalized)
    .limit(1)
    .maybeSingle();

  if (!byPhone.error && byPhone.data) return byPhone.data;

  const byAlt = await supabase
    .from("customers")
    .select("*")
    .eq("phone_normalized", normalized)
    .limit(1)
    .maybeSingle();

  if (!byAlt.error && byAlt.data) return byAlt.data;

  return null;
}

export async function findCustomerByPhone(phone) {
  return ensureCustomerPhoneColumn(phone);
}

export async function createCustomerIfMissing(
  phone,
  name = null,
  preferredLanguage = "ar"
) {
  const normalized = normalizePhone(phone);
  const existing = await findCustomerByPhone(normalized);
  if (existing) return existing;

  const payload = {
    phone: normalized,
    preferred_language: preferredLanguage,
    customer_status: "new",
    name,
    display_name: name,
    channel: "whatsapp",
    contact_type: "customer",
    source_channel: "whatsapp",
    is_active_customer: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
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

export async function logConversation({
  customerId = null,
  phone,
  incomingText = null,
  botReplyText = null,
  messageType = "text",
  detectedLanguage = "ar",
  intent = null,
}) {
  const payload = {
    customer_id: customerId,
    message: incomingText || botReplyText || "",
    direction: incomingText ? "inbound" : "outbound",
    created_at: new Date().toISOString(),
    msg_type: messageType,
    meta: {
      phone_normalized: normalizePhone(phone),
      source: "whatsapp",
      bot_reply_text: botReplyText,
    },
    bot_reply_text: botReplyText,
    intent,
    detected_language: detectedLanguage,
  };

  const { error } = await supabase.from("conversations").insert(payload);
  if (error) {
    console.error("LOG_CONVERSATION_ERROR", error.message);
  }
}

export async function readChatState(phone) {
  const normalized = normalizePhone(phone);

  const primary = await supabase
    .from("chat_state")
    .select("*")
    .eq("phone_normalized", normalized)
    .limit(1)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return {
      ...primary.data,
      context:
        primary.data.context ||
        primary.data.data ||
        {},
    };
  }

  const fallback = await supabase
    .from("customer_facts")
    .select("*")
    .eq("phone", normalized)
    .eq("fact_key", "chat_state")
    .limit(1)
    .maybeSingle();

  if (!fallback.error && fallback.data?.fact_value) {
    return {
      phone_normalized: normalized,
      state: fallback.data.fact_value.state || "START",
      context: fallback.data.fact_value.context || fallback.data.fact_value || {},
      updated_at: fallback.data.updated_at,
    };
  }

  return {
    phone_normalized: normalized,
    state: "START",
    context: {},
  };
}

export async function writeChatState(phone, state, context = {}) {
  const normalized = normalizePhone(phone);
  const customer = await findCustomerByPhone(normalized);

  const existing = await supabase
    .from("chat_state")
    .select("id")
    .eq("phone_normalized", normalized)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    const { error } = await supabase
      .from("chat_state")
      .update({
        customer_id: customer?.id || null,
        state,
        context,
        data: context,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.data.id);

    if (!error) return true;
    console.error("WRITE_CHAT_STATE_UPDATE_ERROR", error.message);
  } else {
    const { error } = await supabase
      .from("chat_state")
      .insert({
        customer_id: customer?.id || null,
        phone_normalized: normalized,
        state,
        context,
        data: context,
        tries: 0,
        updated_at: new Date().toISOString(),
      });

    if (!error) return true;
    console.error("WRITE_CHAT_STATE_INSERT_ERROR", error.message);
  }

  // fallback احتياطي
  const fallbackPayload = {
    customer_id: customer?.id || null,
    phone: normalized,
    fact_key: "chat_state",
    fact_value: {
      state,
      context,
    },
    source: "bot",
    confidence: 0.9,
    updated_at: new Date().toISOString(),
  };

  // إذا كان customer_id موجودًا استخدم onConflict المعتاد
  if (customer?.id) {
    const { error } = await supabase.from("customer_facts").upsert(
      fallbackPayload,
      { onConflict: "customer_id,fact_key" }
    );

    if (error) {
      console.error("WRITE_CHAT_STATE_ERROR", error.message);
      return false;
    }

    return true;
  }

  // إذا لا يوجد customer_id، حدّث/أنشئ حسب phone
  const existingFallback = await supabase
    .from("customer_facts")
    .select("id")
    .eq("phone", normalized)
    .eq("fact_key", "chat_state")
    .limit(1)
    .maybeSingle();

  if (!existingFallback.error && existingFallback.data?.id) {
    const { error } = await supabase
      .from("customer_facts")
      .update(fallbackPayload)
      .eq("id", existingFallback.data.id);

    if (error) {
      console.error("WRITE_CHAT_STATE_ERROR", error.message);
      return false;
    }

    return true;
  }

  const { error } = await supabase
    .from("customer_facts")
    .insert(fallbackPayload);

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
    confidence: 0.9,
    updated_at: new Date().toISOString(),
  };

  if (customer?.id) {
    const { error } = await supabase
      .from("customer_facts")
      .upsert(payload, { onConflict: "customer_id,fact_key" });

    if (error) {
      console.error("SAVE_CUSTOMER_FACT_ERROR", error.message);
    }
    return;
  }

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

  const { error } = await supabase
    .from("customer_facts")
    .insert(payload);

  if (error) {
    console.error("SAVE_CUSTOMER_FACT_ERROR", error.message);
  }
}

export async function getKnowledgeAnswer(text) {
  const cleaned = String(text || "").trim();

  const exact = await supabase
    .from("bot_knowledge_entries")
    .select("question, answer, category, priority")
    .eq("question", cleaned)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!exact.error && exact.data?.answer) return exact.data.answer;

  const keywordsMap = [
    { test: /مطبوخ/, q: "هل الأكل مطبوخ؟" },
    { test: /موقع|عنوان|وين/, q: "وين موقعكم؟" },
    { test: /توصيل|دليفري|يوصل/, q: "هل يوجد توصيل؟" },
  ];

  const matched = keywordsMap.find((k) => k.test.test(cleaned));
  if (!matched) return null;

  const mapped = await supabase
    .from("bot_knowledge_entries")
    .select("question, answer, category, priority")
    .eq("question", matched.q)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mapped.error && mapped.data?.answer) return mapped.data.answer;
  return null;
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

  const payload = {
    customer_id: customer?.id || null,
    phone_normalized: normalized,
    order_type: "whatsapp",
    ramadan_meal_type: "iftar",
    items_json: items,
    subtotal,
    delivery_area: deliveryArea,
    delivery_address: deliveryAddress,
    delivery_fee: null,
    final_total: null,
    payment_method: paymentMethod,
    requested_delivery_time: requestedDeliveryTime,
    customer_notes: customerNotes,
    approval_status: "pending_review",
    customer_confirmation_status: "awaiting_customer_confirmation",
    order_status: "awaiting_internal_review",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
