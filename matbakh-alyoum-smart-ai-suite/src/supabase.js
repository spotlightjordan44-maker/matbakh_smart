import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";
import {
  addMinutes,
  normalizeLanguage,
  normalizePhone,
  orderSerialLabel,
  randomIntBetween,
  safeJson,
  toIso
} from "./utils.js";

const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function nowIso() {
  return toIso(new Date());
}

function json(value, fallback = {}) {
  return safeJson(value, fallback);
}

function isApprovedStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return [
    "APPROVED",
    "APPROVED_MANUAL",
    "APPROVED_AUTO",
    "CONFIRMED",
    "CUSTOMER_CONFIRMED_FINAL",
    "DELIVERED",
    "PICKED_UP",
    "CLOSED",
    "SURVEY_SENT"
  ].includes(normalized);
}

function isCancelledStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return ["REJECTED", "CUSTOMER_CANCELLED", "CANCELLED"].includes(normalized);
}

function normalizeCategory(row) {
  return {
    ...row,
    id: row.id,
    slug: row.code || String(row.id),
    name: row.name_ar,
    is_active: row.active !== false
  };
}

function visibleItemPrice(row) {
  if (row?.public_price !== null && row?.public_price !== undefined) {
    return toNumber(row.public_price, 0);
  }

  if (row?.base_price !== null && row?.base_price !== undefined) {
    return toNumber(row.base_price, 0) + toNumber(row.internal_markup, 0);
  }

  return 0;
}

function normalizeItem(row) {
  const price = visibleItemPrice(row);
  return {
    ...row,
    id: row.id,
    category_id: row.category_id,
    title: row.name_ar,
    description: row.description || "",
    base_price: price,
    public_price: price,
    unit_label: row.unit_label || "",
    image_url: row.image_url || null,
    thumbnail_url: row.thumbnail_url || null,
    badge_text: row.badge_text || null,
    is_best_seller: row.is_best_seller === true,
    is_most_loved: row.is_most_loved === true,
    is_seasonal: row.is_seasonal === true,
    is_active: row.active !== false
  };
}

function normalizeZone(row) {
  return {
    ...row,
    id: row.id,
    name: row.name,
    delivery_fee: toNumber(row.delivery_fee, 0),
    min_eta_minutes: row.min_eta_minutes,
    max_eta_minutes: row.max_eta_minutes,
    is_active: row.is_active !== false
  };
}

function normalizeOfferItem(row) {
  return {
    ...row,
    item_name: row.item_name,
    qty: toNumber(row.qty, 1),
    unit_label: row.unit_label || "حبة"
  };
}

function normalizeSalesOffer(row, items = []) {
  return {
    ...row,
    code: row.code,
    title: row.title_ar,
    description: row.description || "",
    offer_kind: row.offer_kind || "bundle",
    original_price: row.original_price !== null && row.original_price !== undefined ? toNumber(row.original_price) : null,
    final_price: toNumber(row.final_price, 0),
    internal_markup: toNumber(row.internal_markup, 0),
    allow_half: row.allow_half === true,
    half_final_price: row.half_final_price !== null && row.half_final_price !== undefined ? toNumber(row.half_final_price) : null,
    allow_multiple: row.allow_multiple !== false,
    is_active: row.is_active !== false,
    image_url: row.image_url || null,
    badge_text: row.badge_text || null,
    items: items.map(normalizeOfferItem)
  };
}

function normalizeSupportRequest(row) {
  return {
    ...row,
    payload: json(row.payload, {})
  };
}

function normalizeCustomer(row) {
  if (!row) return null;
  return {
    ...row,
    phone: normalizePhone(row.phone),
    tags: Array.isArray(row.tags) ? row.tags : [],
    preferred_language: normalizeLanguage(row.preferred_language || "ar"),
    orders_count: toNumber(row.orders_count, 0),
    approved_orders_count: toNumber(row.approved_orders_count, 0),
    cancelled_orders_count: toNumber(row.cancelled_orders_count, 0),
    lifetime_value: toNumber(row.lifetime_value, 0),
    average_order_value: toNumber(row.average_order_value, 0)
  };
}

function normalizeSession(row) {
  if (!row) return null;
  return {
    ...row,
    data: json(row.draft_order, {}),
    draft_order: json(row.draft_order, {}),
    pending_meta: json(row.pending_meta, {}),
    selected_language: normalizeLanguage(row.selected_language || "ar")
  };
}

function normalizeOrderItem(row) {
  const options = json(row.options, {});
  return {
    ...row,
    item_title: row.item_name,
    quantity: toNumber(row.qty, 0),
    unit_price: toNumber(row.unit_price, 0),
    line_total: toNumber(row.line_total, 0),
    notes: options.notes || null,
    unit_label: options.unit_label || null,
    offer_code: options.offer_code || null,
    source: options.source || "menu_item"
  };
}

function normalizeOrder(row, items = [], customer = null) {
  const meta = json(row?.meta, {});
  const deliveryZoneName =
    row?.delivery_area_name ||
    row?.delivery_area ||
    row?.area ||
    row?.delivery_zone ||
    null;

  const normalizedItems = items.map(normalizeOrderItem);
  const orderNumber = row?.serial_no ? orderSerialLabel(row.serial_no) : row?.order_code || row?.shortcode || null;

  return {
    ...row,
    order_number: orderNumber,
    serial_label: orderNumber,
    customer_name:
      meta.customer_name ||
      customer?.display_name ||
      customer?.name ||
      null,
    customer_phone: normalizePhone(row?.customer_phone || customer?.phone || ""),
    delivery_zone_name: deliveryZoneName,
    requested_time_slot: row?.requested_time || row?.delivery_time || null,
    requested_date: row?.requested_date || null,
    subtotal_amount: toNumber(row?.subtotal, 0),
    total_amount: toNumber(row?.total, 0),
    delivery_fee: toNumber(row?.delivery_fee, 0),
    approval_mode: row?.approval_mode || (row?.auto_approved ? "AUTO" : "MANUAL"),
    approval_policy: row?.approval_policy || "MANUAL_ONLY",
    awaiting_customer_final_confirmation: row?.awaiting_customer_final_confirmation === true,
    order_items: normalizedItems,
    meta
  };
}

async function selectSingle(table, filterBuilder) {
  let query = supabase.from(table).select("*");
  query = filterBuilder(query);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return firstRow(data);
}

async function updateCustomerComputedStats(customerId) {
  if (!customerId) return null;

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id,status,total,created_at,delivery_area_name,delivery_area,area,delivery_zone")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = orders || [];
  const ordersCount = rows.length;
  const approvedOrdersCount = rows.filter((row) => isApprovedStatus(row.status)).length;
  const cancelledOrdersCount = rows.filter((row) => isCancelledStatus(row.status)).length;
  const lifetimeValue = rows.reduce((sum, row) => sum + toNumber(row.total, 0), 0);
  const averageOrderValue = ordersCount ? lifetimeValue / ordersCount : 0;
  const firstOrderAt = rows[0]?.created_at || null;
  const lastOrderAt = rows[rows.length - 1]?.created_at || null;
  const frequentZone =
    rows
      .map((row) => row.delivery_area_name || row.delivery_area || row.area || row.delivery_zone || null)
      .filter(Boolean)
      .at(-1) || null;

  const contactType = approvedOrdersCount >= 1 ? "customer_repeat" : "customer_first_time";

  const { data: customerRow, error: updateError } = await supabase
    .from("customers")
    .update({
      orders_count: ordersCount,
      approved_orders_count: approvedOrdersCount,
      cancelled_orders_count: cancelledOrdersCount,
      lifetime_value: lifetimeValue,
      average_order_value: averageOrderValue,
      first_order_at: firstOrderAt,
      last_order_at: lastOrderAt,
      frequent_zone: frequentZone,
      contact_type: contactType,
      updated_at: nowIso()
    })
    .eq("id", customerId)
    .select("*")
    .single();

  if (updateError) throw updateError;
  return normalizeCustomer(customerRow);
}

async function findCustomerByPhone(phone) {
  const normalized = normalizePhone(phone);
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("phone", normalized)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return normalizeCustomer(firstRow(data));
}

async function insertCustomerWithFallback(payload) {
  const attempts = [
    payload,
    { ...payload, sender_kind: "customer" },
    { ...payload, sender_kind: "CUSTOMER" },
    { ...payload, sender_kind: "user" },
    { ...payload, sender_kind: "USER" },
    { ...payload, sender_kind: "lead" },
    { ...payload, sender_kind: "LEAD" }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    const { data, error } = await supabase.from("customers").insert(attempt).select("*").single();
    if (!error) return normalizeCustomer(data);
    lastError = error;

    if (String(error.code || "") === "23505") {
      const existing = await findCustomerByPhone(payload.phone);
      if (existing) return existing;
    }
  }

  throw lastError;
}

async function getCustomerById(customerId) {
  if (!customerId) return null;
  const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).limit(1);
  if (error) throw error;
  return normalizeCustomer(firstRow(data));
}

async function findSessionByCustomerId(customerId) {
  const { data, error } = await supabase
    .from("customer_sessions")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return normalizeSession(firstRow(data));
}

function defaultReminderDueAt() {
  const minutes = randomIntBetween(
    CONFIG.orderFlow.abandonedReminderMinMinutes,
    CONFIG.orderFlow.abandonedReminderMaxMinutes
  );
  return addMinutes(new Date(), minutes).toISOString();
}

function deriveCustomerTypeFromPayload(payload = {}) {
  const requested = String(payload.contact_type || "").trim();
  if (requested) return requested;
  return "customer_first_time";
}

function mapOrderStatusForInsert(status = "PENDING_ADMIN") {
  const raw = String(status || "").trim().toUpperCase();
  if (raw === "PENDING_ADMIN") return "pending_admin_review";
  if (raw === "APPROVED_MANUAL") return "approved_manual";
  if (raw === "APPROVED_AUTO") return "approved_auto";
  if (raw === "APPROVED_WAITING_CUSTOMER_FINAL_CONFIRMATION") return "pending_customer_confirm";
  if (raw === "CUSTOMER_CONFIRMED_FINAL") return "confirmed";
  if (raw === "CUSTOMER_CANCELLED") return "customer_cancelled";
  if (raw === "REJECTED") return "rejected";
  if (raw === "IN_PREPARATION") return "in_preparation";
  if (raw === "READY") return "ready";
  if (raw === "WAITING_FOR_DRIVER") return "waiting_for_driver";
  if (raw === "DELIVERED") return "delivered";
  if (raw === "PICKED_UP") return "picked_up";
  if (raw === "SURVEY_SENT") return "survey_sent";
  return raw.toLowerCase();
}

function buildOrderInsertPayload(payload, customerId) {
  const offerCodes = uniqueStrings(
    (payload.items || [])
      .map((item) => item.offerCode || null)
      .filter(Boolean)
  );

  return {
    customer_id: customerId,
    items: Array.isArray(payload.items_summary) ? payload.items_summary.join(" | ") : null,
    status: mapOrderStatusForInsert(payload.status || "PENDING_ADMIN"),
    status_label: payload.status || "PENDING_ADMIN",
    approval_mode: payload.approval_mode || "MANUAL",
    approval_policy: payload.approval_policy || "MANUAL_ONLY",
    awaiting_customer_final_confirmation: payload.awaiting_customer_final_confirmation === true,
    delivery_fee: toNumber(payload.delivery_fee, 0),
    delivery_time: payload.requested_time_slot || null,
    shortcode: payload.order_code || null,
    notes: payload.notes || null,
    meta: {
      customer_name: payload.customer_name || null,
      draft_payload: payload.draft_payload || null,
      currency_code: payload.currency_code || CONFIG.business.currency,
      language: payload.language || "ar"
    },
    updated_at: nowIso(),
    product: payload.product || null,
    protein: payload.protein || null,
    meat_type: payload.meat_type || null,
    chicken_count: payload.chicken_count || null,
    qty_meals: payload.qty_meals || null,
    addons: payload.addons || null,
    delivery_area: payload.delivery_zone_name || null,
    requested_day: payload.schedule_type || null,
    requested_time: payload.requested_time_slot || null,
    accounting_code: payload.accounting_code || null,
    admin_notified_at: null,
    area: payload.delivery_zone_name || null,
    customer_phone: normalizePhone(payload.customer_phone),
    handled_by: null,
    subtotal: toNumber(payload.subtotal_amount, 0),
    total: toNumber(payload.total_amount, 0),
    channel: payload.order_channel || "WHATSAPP",
    source_channel: payload.source_channel || payload.order_channel || "WHATSAPP",
    source_campaign: payload.source_campaign || null,
    source_adset: payload.source_adset || null,
    source_ad: payload.source_ad || null,
    delivery_zone: payload.delivery_zone_id || null,
    delivery_area_name: payload.delivery_zone_name || null,
    payment_method: payload.payment_method || "cash",
    customer_note: payload.customer_note || null,
    admin_note: payload.admin_note || null,
    approved_by: null,
    order_code: payload.order_code || null,
    delivery_method: payload.delivery_method || "DELIVERY",
    delivery_address: payload.address_text || null,
    requested_date: payload.requested_date || null,
    auto_approved: false,
    approval_source: null,
    auto_approve_at: null,
    handled_by_phone: null,
    handled_by_role: null,
    handled_at: null,
    is_first_order: payload.is_first_order === true,
    contains_offer: offerCodes.length > 0,
    offer_codes: offerCodes,
    reminder_due_at: CONFIG.orderFlow.enableAbandonedReminder ? defaultReminderDueAt() : null
  };
}

function buildOrderUpdatePatch(patch = {}) {
  const update = { updated_at: nowIso() };

  if (patch.status !== undefined) {
    update.status = mapOrderStatusForInsert(patch.status);
    update.status_label = patch.status;
  }
  if (patch.delivery_method !== undefined) update.delivery_method = patch.delivery_method;
  if (patch.requested_date !== undefined) update.requested_date = patch.requested_date;
  if (patch.requested_time_slot !== undefined) {
    update.requested_time = patch.requested_time_slot;
    update.delivery_time = patch.requested_time_slot;
  }
  if (patch.delivery_zone_id !== undefined) update.delivery_zone = patch.delivery_zone_id;
  if (patch.delivery_zone_name !== undefined) {
    update.delivery_area_name = patch.delivery_zone_name;
    update.delivery_area = patch.delivery_zone_name;
    update.area = patch.delivery_zone_name;
  }
  if (patch.address_text !== undefined) update.delivery_address = patch.address_text;
  if (patch.subtotal_amount !== undefined) update.subtotal = toNumber(patch.subtotal_amount, 0);
  if (patch.total_amount !== undefined) update.total = toNumber(patch.total_amount, 0);
  if (patch.delivery_fee !== undefined) update.delivery_fee = toNumber(patch.delivery_fee, 0);
  if (patch.customer_note !== undefined) update.customer_note = patch.customer_note;
  if (patch.admin_note !== undefined) update.admin_note = patch.admin_note;
  if (patch.rejected_reason !== undefined) update.rejected_reason = patch.rejected_reason;
  if (patch.approval_mode !== undefined) update.approval_mode = patch.approval_mode;
  if (patch.approval_policy !== undefined) update.approval_policy = patch.approval_policy;
  if (patch.awaiting_customer_final_confirmation !== undefined) {
    update.awaiting_customer_final_confirmation = patch.awaiting_customer_final_confirmation;
  }
  if (patch.customer_final_action !== undefined) update.customer_final_action = patch.customer_final_action;
  if (patch.customer_final_action_at !== undefined) update.customer_final_action_at = patch.customer_final_action_at;
  if (patch.customer_change_request !== undefined) update.customer_change_request = patch.customer_change_request;
  if (patch.customer_requested_callback !== undefined) update.customer_requested_callback = patch.customer_requested_callback;
  if (patch.customer_postponed_date !== undefined) update.customer_postponed_date = patch.customer_postponed_date;
  if (patch.customer_postponed_time !== undefined) update.customer_postponed_time = patch.customer_postponed_time;
  if (patch.kitchen_status !== undefined) update.kitchen_status = patch.kitchen_status;
  if (patch.fulfillment_status !== undefined) update.fulfillment_status = patch.fulfillment_status;
  if (patch.closed_at !== undefined) update.closed_at = patch.closed_at;
  if (patch.survey_sent !== undefined) update.survey_sent = patch.survey_sent;
  if (patch.survey_sent_at !== undefined) update.survey_sent_at = patch.survey_sent_at;

  if (patch.approval_mode === "MANUAL") {
    update.auto_approved = false;
    update.approval_source = "MANUAL";
    update.approved_by = patch.approved_by_phone || null;
    update.handled_by_phone = patch.approved_by_phone || null;
    update.handled_by_role = "admin";
    update.handled_at = patch.approved_at || nowIso();
  }

  if (patch.approval_mode === "AUTO") {
    update.auto_approved = true;
    update.approval_source = "AUTO";
    update.handled_by_phone = "system";
    update.handled_by_role = "system";
    update.handled_at = patch.auto_approved_at || nowIso();
    update.auto_approve_at = patch.auto_approved_at || nowIso();
  }

  if (patch.rejected_at) {
    update.handled_at = patch.rejected_at;
    update.handled_by_phone = patch.approved_by_phone || patch.handled_by_phone || null;
    update.handled_by_role = "admin";
  }

  return update;
}

export async function getOrCreateCustomer({
  phone,
  name = "",
  language = "ar",
  contactType = null,
  sourceChannel = "WHATSAPP",
  sourceCampaign = null,
  sourceAdset = null,
  sourceAd = null
}) {
  const normalized = normalizePhone(phone);
  const existing = await findCustomerByPhone(normalized);
  if (existing) return existing;

  const payload = {
    phone: normalized,
    name: name || null,
    display_name: name || null,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_seen_at: nowIso(),
    last_incoming_at: nowIso(),
    channel: "whatsapp",
    source_channel: sourceChannel || "WHATSAPP",
    source_campaign: sourceCampaign,
    source_adset: sourceAdset,
    source_ad: sourceAd,
    channel_user_id: normalized,
    preferred_language: normalizeLanguage(language),
    contact_type: contactType || "customer_first_time"
  };

  return insertCustomerWithFallback(payload);
}

export async function touchCustomer(
  phone,
  name = "",
  {
    language = null,
    contactType = null,
    tags = null,
    sourceChannel = null,
    sourceCampaign = null,
    sourceAdset = null,
    sourceAd = null,
    governorate = null,
    ammanArea = null
  } = {}
) {
  const normalized = normalizePhone(phone);
  const existing = await findCustomerByPhone(normalized);
  if (!existing) {
    return getOrCreateCustomer({
      phone: normalized,
      name,
      language: language || "ar",
      contactType,
      sourceChannel: sourceChannel || "WHATSAPP",
      sourceCampaign,
      sourceAdset,
      sourceAd
    });
  }

  const nextTags = Array.isArray(tags) ? uniqueStrings([...(existing.tags || []), ...tags]) : undefined;

  const updates = {
    last_seen_at: nowIso(),
    last_incoming_at: nowIso(),
    updated_at: nowIso()
  };

  if (name) {
    updates.name = name;
    updates.display_name = name;
  }
  if (language) updates.preferred_language = normalizeLanguage(language);
  if (contactType) updates.contact_type = contactType;
  if (nextTags) updates.tags = nextTags;
  if (sourceChannel) updates.source_channel = sourceChannel;
  if (sourceCampaign) updates.source_campaign = sourceCampaign;
  if (sourceAdset) updates.source_adset = sourceAdset;
  if (sourceAd) updates.source_ad = sourceAd;
  if (governorate) updates.governorate = governorate;
  if (ammanArea) updates.amman_area = ammanArea;

  const { data, error } = await supabase
    .from("customers")
    .update(updates)
    .eq("phone", normalized)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeCustomer(data);
}

export async function markCustomerOutgoing(phone) {
  const normalized = normalizePhone(phone);
  const { error } = await supabase
    .from("customers")
    .update({ last_outgoing_at: nowIso(), updated_at: nowIso() })
    .eq("phone", normalized);

  if (error) throw error;
  return true;
}

export async function getCustomer(phone) {
  return findCustomerByPhone(phone);
}

export async function getSession(phone) {
  const customer = await findCustomerByPhone(phone);
  if (!customer) return null;
  return findSessionByCustomerId(customer.id);
}

export async function upsertSession(phone, patch = {}) {
  const customer = await getOrCreateCustomer({
    phone,
    language: patch.selected_language || patch.language || "ar"
  });

  const current = await findSessionByCustomerId(customer.id);
  const nextData = patch.data ?? current?.data ?? {};
  const nextPendingMeta = patch.pending_meta ?? current?.pending_meta ?? {};

  const payload = {
    customer_id: customer.id,
    state: patch.state ?? current?.state ?? "idle",
    draft_order: nextData,
    updated_at: nowIso(),
    preferred_language: normalizeLanguage(patch.language || current?.preferred_language || customer.preferred_language || "ar"),
    selected_language: normalizeLanguage(patch.selected_language || current?.selected_language || customer.preferred_language || "ar"),
    pending_flow: patch.pending_flow ?? current?.pending_flow ?? null,
    pending_meta: nextPendingMeta,
    reminder_due_at:
      patch.reminder_due_at !== undefined
        ? patch.reminder_due_at
        : CONFIG.orderFlow.enableAbandonedReminder
          ? defaultReminderDueAt()
          : null,
    reminder_sent_at_phase1: patch.reminder_sent_at_phase1 ?? current?.reminder_sent_at_phase1 ?? null,
    reminder_message: patch.reminder_message ?? current?.reminder_message ?? null,
    abandoned_at: patch.abandoned_at ?? current?.abandoned_at ?? null,
    human_takeover: patch.human_takeover ?? current?.human_takeover ?? false,
    assigned_agent_phone: patch.assigned_agent_phone ?? current?.assigned_agent_phone ?? null
  };

  let data;
  let error;

  if (current?.id) {
    ({ data, error } = await supabase
      .from("customer_sessions")
      .update(payload)
      .eq("id", current.id)
      .select("*")
      .single());
  } else {
    ({ data, error } = await supabase
      .from("customer_sessions")
      .insert({ ...payload, created_at: nowIso() })
      .select("*")
      .single());
  }

  if (error) throw error;
  return normalizeSession(data);
}

export async function resetSession(phone, { selectedLanguage = "ar" } = {}) {
  const customer = await getOrCreateCustomer({ phone, language: selectedLanguage });
  const current = await findSessionByCustomerId(customer.id);
  const payload = {
    customer_id: customer.id,
    state: "idle",
    draft_order: {},
    updated_at: nowIso(),
    preferred_language: normalizeLanguage(selectedLanguage),
    selected_language: normalizeLanguage(selectedLanguage),
    pending_flow: null,
    pending_meta: {},
    reminder_due_at: null,
    reminder_sent_at_phase1: null,
    reminder_message: null,
    abandoned_at: null,
    human_takeover: false,
    assigned_agent_phone: null
  };

  if (current?.id) {
    const { error } = await supabase.from("customer_sessions").update(payload).eq("id", current.id);
    if (error) throw error;
    return true;
  }

  const { error } = await supabase.from("customer_sessions").insert({ ...payload, created_at: nowIso() });
  if (error) throw error;
  return true;
}

export async function markSessionAbandoned(phone, message = null) {
  const session = await getSession(phone);
  if (!session?.id) return null;

  const { data, error } = await supabase
    .from("customer_sessions")
    .update({
      abandoned_at: nowIso(),
      reminder_message: message || session.reminder_message || null,
      updated_at: nowIso()
    })
    .eq("id", session.id)
    .select("*")
    .single();

  if (error) throw error;

  await supabase
    .from("customers")
    .update({ last_abandoned_at: nowIso(), updated_at: nowIso() })
    .eq("id", session.customer_id);

  return normalizeSession(data);
}

export async function listDueAbandonedSessions(now = new Date()) {
  const nowIsoValue = toIso(now);
  const { data, error } = await supabase
    .from("customer_sessions")
    .select("*")
    .not("reminder_due_at", "is", null)
    .is("reminder_sent_at_phase1", null)
    .lte("reminder_due_at", nowIsoValue);

  if (error) throw error;
  return (data || []).map(normalizeSession);
}

export async function markAbandonedReminderSent(sessionId, messageText = null) {
  const { data, error } = await supabase
    .from("customer_sessions")
    .update({
      reminder_sent_at_phase1: nowIso(),
      reminder_message: messageText || null,
      updated_at: nowIso()
    })
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSession(data);
}

export async function createOrder(orderPayload, items = []) {
  const customer = await getOrCreateCustomer({
    phone: orderPayload.customer_phone,
    name: orderPayload.customer_name || "",
    language: orderPayload.language || "ar",
    contactType: deriveCustomerTypeFromPayload(orderPayload),
    sourceChannel: orderPayload.source_channel || orderPayload.order_channel || "WHATSAPP",
    sourceCampaign: orderPayload.source_campaign || null,
    sourceAdset: orderPayload.source_adset || null,
    sourceAd: orderPayload.source_ad || null
  });

  const freshCustomer = await updateCustomerComputedStats(customer.id);
  const isFirstOrder = toNumber(freshCustomer?.orders_count, 0) === 0;

  const insertPayload = buildOrderInsertPayload(
    {
      ...orderPayload,
      is_first_order: isFirstOrder,
      items_summary: items.map((item) => `${item.title} × ${toNumber(item.qty, 1)}`),
      items
    },
    customer.id
  );

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .insert(insertPayload)
    .select("*")
    .single();

  if (orderError) throw orderError;

  if (items.length) {
    const insertItems = items.map((item) => ({
      order_id: orderRow.id,
      category_id: item.itemId ? String(item.itemId) : null,
      item_name: item.title,
      qty: toNumber(item.qty, 1),
      unit_price: toNumber(item.unitPrice, 0),
      line_total: toNumber(item.lineTotal, 0),
      options: {
        notes: item.notes || null,
        unit_label: item.unitLabel || null,
        offer_code: item.offerCode || null,
        source: item.source || "menu_item"
      },
      variant_name: null,
      created_at: nowIso()
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(insertItems);
    if (itemsError) throw itemsError;
  }

  await updateCustomerComputedStats(customer.id);

  await createOrderStatusEvent({
    orderId: orderRow.id,
    status: orderRow.status_label || "PENDING_ADMIN",
    actorRole: "system",
    note: "Order created"
  });

  return getOrder(orderRow.id);
}

export async function getOrder(orderId) {
  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError) throw orderError;

  const [{ data: itemsRows, error: itemsError }, customer] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", orderId).order("id", { ascending: true }),
    getCustomerById(orderRow.customer_id).catch(() => null)
  ]);

  if (itemsError) throw itemsError;

  return normalizeOrder(orderRow, itemsRows || [], customer);
}

export async function updateOrder(orderId, patch = {}) {
  const before = await getOrder(orderId);
  const update = buildOrderUpdatePatch(patch);

  const { error } = await supabase.from("orders").update(update).eq("id", orderId);
  if (error) throw error;

  const after = await getOrder(orderId);

  if (after.customer_id) {
    await updateCustomerComputedStats(after.customer_id).catch(() => null);
  }

  if (patch.status) {
    await createOrderStatusEvent({
      orderId,
      status: patch.status,
      actorPhone: patch.approved_by_phone || patch.actor_phone || patch.handled_by_phone || null,
      actorRole: patch.actor_role || "system",
      note: patch.note || null,
      meta: patch.meta || {}
    }).catch(() => null);
  }

  return after;
}

async function adminActionCandidates(actionType) {
  const upper = String(actionType || "").toUpperCase();

  if (upper === "APPROVE") return ["order_approved"];
  if (upper === "REJECT") return ["order_rejected"];
  if (upper === "SET_DELIVERY_FEE") return ["delivery_fee_set"];
  if (upper === "MESSAGE") return ["customer_messaged"];
  if (upper === "SCHEDULE") return ["order_scheduled"];
  if (upper === "NOTE") return ["note_added"];
  if (upper === "STATUS_UPDATE") return ["status_changed"];
  if (upper === "ASSIGN_CAPTAIN") return ["captain_assigned"];
  if (upper === "READY") return ["marked_ready"];
  if (upper === "OUT_FOR_DELIVERY") return ["marked_out_for_delivery"];
  if (upper === "DELIVERED") return ["marked_delivered"];
  if (upper === "REPORT") return ["report_viewed"];

  return ["note_added"];
}

export async function logAdminAction(payload = {}) {
  const base = {
    admin_phone: normalizePhone(payload.actor_phone || payload.admin_phone || "system") || "system",
    order_id: payload.order_id || null,
    order_code: payload.order_code || null,
    customer_phone: payload.customer_phone ? normalizePhone(payload.customer_phone) : null,
    details: payload.details || { note: payload.note || null, action_type: payload.action_type || null },
    created_at: nowIso(),
    action_type: payload.action_type || null,
    action_value: payload.action_value || payload.note || null,
    meta: payload.meta || {}
  };

  let lastError = null;
  const candidates = await adminActionCandidates(payload.action_type);

  for (const action of candidates) {
    const { error } = await supabase.from("admin_actions").insert({ ...base, action });
    if (!error) return true;
    lastError = error;
  }

  console.error("ADMIN_ACTION_LOG_FAILED", lastError?.message || lastError);
  return false;
}

export async function createOrderStatusEvent({
  orderId,
  status,
  actorPhone = null,
  actorRole = "system",
  note = null,
  meta = {}
}) {
  const { error } = await supabase.from("order_status_events").insert({
    order_id: orderId,
    status,
    actor_phone: actorPhone ? normalizePhone(actorPhone) : null,
    actor_role: actorRole,
    note,
    meta
  });

  if (error) throw error;
  return true;
}

export async function listOrderStatusEvents(orderId) {
  const { data, error } = await supabase
    .from("order_status_events")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listActiveCategories() {
  const { data, error } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeCategory);
}

export async function listActiveItems() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeItem);
}

export async function listActiveZones() {
  const { data, error } = await supabase
    .from("delivery_zones")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeZone);
}

export async function listActiveSalesOffers() {
  const { data: offersRows, error: offersError } = await supabase
    .from("sales_offers")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (offersError) throw offersError;
  if (!offersRows?.length) return [];

  const offerIds = offersRows.map((row) => row.id);
  const { data: itemRows, error: itemsError } = await supabase
    .from("sales_offer_items")
    .select("*")
    .in("sales_offer_id", offerIds)
    .order("sort_order", { ascending: true });

  if (itemsError) throw itemsError;

  const grouped = new Map();
  for (const row of itemRows || []) {
    const list = grouped.get(row.sales_offer_id) || [];
    list.push(row);
    grouped.set(row.sales_offer_id, list);
  }

  return offersRows.map((row) => normalizeSalesOffer(row, grouped.get(row.id) || []));
}

export async function getAdminSetting(settingKey, fallback = null) {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("*")
    .eq("setting_key", settingKey)
    .limit(1);

  if (error) throw error;
  const row = firstRow(data);
  return row ? json(row.setting_value, {}) : fallback;
}

export async function upsertAdminSetting(settingKey, settingValue) {
  const { data, error } = await supabase
    .from("admin_settings")
    .upsert({
      setting_key: settingKey,
      setting_value: settingValue,
      updated_at: nowIso()
    })
    .select("*")
    .single();

  if (error) throw error;
  return json(data.setting_value, {});
}

export async function getApprovalPolicySetting() {
  return getAdminSetting("approval_policy", {
    mode: "MANUAL_ONLY",
    auto_approve_enabled: false,
    auto_approve_start: "10:00",
    auto_approve_end: "22:00",
    notify_customer_when_delayed: true
  });
}

export async function getAbandonedReminderSetting() {
  return getAdminSetting("abandoned_reminder", {
    enabled: true,
    min_minutes: 15,
    max_minutes: 25
  });
}

export async function createSupportRequest({
  requestType,
  phone,
  name = null,
  language = "ar",
  customerId = null,
  notes = null,
  payload = {}
}) {
  const normalizedPhone = normalizePhone(phone);
  let linkedCustomerId = customerId;

  if (!linkedCustomerId) {
    const customer = await findCustomerByPhone(normalizedPhone);
    linkedCustomerId = customer?.id || null;
  }

  const { data, error } = await supabase
    .from("support_requests")
    .insert({
      request_type: requestType,
      customer_id: linkedCustomerId,
      phone: normalizedPhone,
      name,
      language: normalizeLanguage(language),
      notes,
      payload,
      updated_at: nowIso()
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSupportRequest(data);
}

export async function createFranchiseLead({
  phone,
  name = null,
  language = "ar",
  countryChoice,
  governorate = null,
  ammanArea = null,
  branchCount = 1,
  notes = null,
  payload = {}
}) {
  const { data, error } = await supabase
    .from("franchise_leads")
    .insert({
      phone: normalizePhone(phone),
      name,
      language: normalizeLanguage(language),
      country_choice: countryChoice,
      governorate,
      amman_area: ammanArea,
      branch_count: Number(branchCount || 1),
      notes,
      payload,
      updated_at: nowIso()
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function createJobApplication({
  phone,
  name = null,
  language = "ar",
  jobType = null,
  governorate = null,
  ammanArea = null,
  notes = null,
  payload = {}
}) {
  const { data, error } = await supabase
    .from("job_applications")
    .insert({
      phone: normalizePhone(phone),
      name,
      language: normalizeLanguage(language),
      job_type: jobType,
      governorate,
      amman_area: ammanArea,
      notes,
      payload,
      updated_at: nowIso()
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function createCustomerFeedback({
  phone = null,
  customerId = null,
  orderId = null,
  feedbackType,
  rating = null,
  message = null,
  payload = {}
}) {
  const { data, error } = await supabase
    .from("customer_feedback")
    .insert({
      customer_id: customerId,
      order_id: orderId,
      phone: phone ? normalizePhone(phone) : null,
      feedback_type: feedbackType,
      rating: rating !== null && rating !== undefined ? Number(rating) : null,
      message,
      payload
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function createReminderJob({
  customerId = null,
  orderId = null,
  jobType,
  scheduledFor,
  payload = {}
}) {
  const { data, error } = await supabase
    .from("reminder_jobs")
    .insert({
      customer_id: customerId,
      order_id: orderId,
      job_type: jobType,
      scheduled_for: scheduledFor,
      payload
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listDueReminderJobs(now = new Date()) {
  const { data, error } = await supabase
    .from("reminder_jobs")
    .select("*")
    .eq("status", "PENDING")
    .lte("scheduled_for", toIso(now))
    .order("scheduled_for", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function markReminderJobSent(jobId) {
  const { data, error } = await supabase
    .from("reminder_jobs")
    .update({
      status: "SENT",
      sent_at: nowIso()
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function findPendingAdminOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("status", ["pending_admin_review", "PENDING_ADMIN"])
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function listRecentOrders(limit = 20) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}


export async function logConversationMessage({
  customerPhone,
  customerId = null,
  direction = 'inbound',
  channel = 'WHATSAPP',
  messageType = 'text',
  text = null,
  intent = null,
  payload = {}
}) {
  try {
    const { data, error } = await supabase
      .from('conversation_messages')
      .insert({
        customer_phone: normalizePhone(customerPhone),
        customer_id: customerId,
        direction,
        channel,
        message_type: messageType,
        text,
        intent,
        payload
      })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    return null;
  }
}

export async function listRecentConversationMessages(customerPhone, limit = 12) {
  try {
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('customer_phone', normalizePhone(customerPhone))
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    return [];
  }
}

export async function upsertCustomerFact({ customerPhone, customerId = null, factKey, factValue, confidence = 0.8, source = 'bot_memory' }) {
  try {
    const normalizedPhone = normalizePhone(customerPhone);
    const existing = await supabase
      .from('customer_facts')
      .select('*')
      .eq('customer_phone', normalizedPhone)
      .eq('fact_key', factKey)
      .limit(1);

    const row = firstRow(existing.data);
    if (row) {
      const { data, error } = await supabase
        .from('customer_facts')
        .update({ fact_value: factValue, confidence, source, updated_at: nowIso() })
        .eq('id', row.id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('customer_facts')
      .insert({ customer_phone: normalizedPhone, customer_id: customerId, fact_key: factKey, fact_value: factValue, confidence, source })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    return null;
  }
}

export async function listCustomerFacts(customerPhone, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('customer_facts')
      .select('*')
      .eq('customer_phone', normalizePhone(customerPhone))
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (error) {
    return [];
  }
}


export async function listActiveKnowledgeEntries(limit = 500) {
  try {
    const { data, error } = await supabase
      .from('bot_knowledge_entries')
      .select('*')
      .eq('is_active', true)
      .order('title', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    return [];
  }
}
