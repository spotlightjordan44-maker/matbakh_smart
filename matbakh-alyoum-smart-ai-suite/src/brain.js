import { CONFIG } from './config.js';
import { KNOWLEDGE_BASE } from './knowledge-base.js';
import { listActiveKnowledgeEntries } from './supabase.js';

const KNOWLEDGE_CACHE_TTL_MS = 5 * 60 * 1000;
let knowledgeCache = {
  loadedAt: 0,
  entries: []
};

function normalizeArabic(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, needles = []) {
  return needles.some((needle) => text.includes(normalizeArabic(needle)));
}

function extractNumber(text) {
  const m = String(text || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function buildGreeting() {
  return KNOWLEDGE_BASE.generalAnswers.greeting;
}

function buildSuggestionsByPeople(people) {
  if (people >= 10) return KNOWLEDGE_BASE.suggestionsByPeople['10+'];
  if (people >= 6) return KNOWLEDGE_BASE.suggestionsByPeople['6'];
  if (people >= 4) return KNOWLEDGE_BASE.suggestionsByPeople['4'];
  return KNOWLEDGE_BASE.suggestionsByPeople['2'];
}

function findItemMatches(text) {
  const n = normalizeArabic(text);
  return KNOWLEDGE_BASE.items.filter((item) => {
    const candidates = [item.title, ...(item.aliases || [])].map(normalizeArabic);
    return candidates.some((candidate) => candidate && n.includes(candidate));
  });
}

function findFaq(text) {
  const n = normalizeArabic(text);
  for (const pair of KNOWLEDGE_BASE.faqPairs) {
    if (pair.patterns.some((p) => n.includes(normalizeArabic(p)))) {
      return KNOWLEDGE_BASE.generalAnswers[pair.answerKey] || null;
    }
  }
  return null;
}

function findCountAnswer(text) {
  const n = normalizeArabic(text);
  if (!hasAny(n, ['كم حبه', 'كم حبة', 'كم في الكيلو', 'حبات'])) return null;
  for (const [key, answer] of Object.entries(KNOWLEDGE_BASE.counts)) {
    if (n.includes(normalizeArabic(key))) return answer;
  }
  return null;
}

function inferSubjectFromHistory(recentMessages = []) {
  const texts = recentMessages.map((m) => String(m.text || '')).join(' \n ');
  return findItemMatches(texts)[0] || null;
}

function wantsGreeting(text) {
  return hasAny(text, ['مرحبا','السلام عليكم','مساء الخير','صباح الخير','يعطيكم العافيه','يعطيكم العافية']);
}

function wantsThanks(text) {
  return hasAny(text, ['شكرا','يعطيكم العافيه','يعطيكم العافية','مشكور']);
}

function wantsLocation(text) {
  return hasAny(text, ['وين موقعكم','وين مكانكم','وين عنوانكم','عنوانكم','موقعكم']);
}

function wantsDelivery(text) {
  return hasAny(text, ['توصيل','دليفري','يوصل','بتوصلوا']);
}

function wantsTracking(text) {
  return hasAny(text, ['طلبي وين','وين طلبي','تأخر الطلب','وصل ناقص','شكوى','بارد','ما وصلني']);
}

function wantsAvailable(text) {
  return hasAny(text, ['شو عندكم','شو متوفر','شو الاكل اليوم','في اكل جاهز','شو عندكم مطبوخ']);
}

function wantsPricing(text) {
  return hasAny(text, ['كم سعر','بكم','قديش','كم الاسعار','سعر']);
}

function wantsOrder(text) {
  return hasAny(text, ['بدي','اريد','أريد','حاب','ممكن طلب','اطلب','بدنا','جهزولي','ابعتولي']);
}

function formatOfferList(lines = []) {
  return lines.slice(0, 3).map((line, idx) => `${idx + 1}- ${line}`).join('\n');
}

function buildAvailableReply() {
  return [
    'متوفر لدينا عدة أطباق منزلية مميزة مثل:',
    'المقلوبة، المسخن، المفتول، المنسف، اليالنجي، الشيشبرك، شيخ المحشي، والكبة اللبنية.',
    'كما تتوفر بعض المقالي والمفرزات والعروض العائلية.',
    'اذكر لي عدد الأشخاص أو الصنف المطلوب وسأرشدك مباشرة.'
  ].join('\n');
}

function buildTrackingReply() {
  return 'نعتذر عن ذلك 🌿\nيرجى إرسال رقم الطلب أو رقم الهاتف حتى نتابع الموضوع مباشرة وبأسرع وقت.';
}

function buildDirectOrderReply(matches, people = null) {
  if (people) {
    return `أكيد 🌿\nهذه بعض الخيارات المناسبة لك:\n${formatOfferList(buildSuggestionsByPeople(people))}\n\nاختر المناسب لك وسأكمل الطلب مباشرة.`;
  }

  if (matches.length === 1) {
    return `تم بكل سرور ✅\n${matches[0].reply}\n\nيرجى إرسال المنطقة أو الموقع لتأكيد التوصيل، أو أرسل الكمية إذا رغبت بإكمال الطلب مباشرة.`;
  }

  const itemTitles = matches.map((item) => `- ${item.title}`).join('\n');
  return `تم ✅\nطلبك الحالي يحتوي على:\n${itemTitles}\n\nيرجى تحديد الكمية لكل صنف حتى أؤكد الطلب.`;
}

function buildPriceReply(match) {
  if (!match) return 'بكل سرور 🌿\nاذكر لي الصنف المطلوب وسأرسل لك السعر والتفاصيل مباشرة.';
  return match.reply;
}

async function getDynamicKnowledgeEntries() {
  const now = Date.now();
  if (knowledgeCache.entries.length && now - knowledgeCache.loadedAt < KNOWLEDGE_CACHE_TTL_MS) {
    return knowledgeCache.entries;
  }

  const rows = await listActiveKnowledgeEntries(500);
  knowledgeCache = {
    loadedAt: now,
    entries: Array.isArray(rows) ? rows : []
  };

  return knowledgeCache.entries;
}

function normalizeKnowledgeEntry(entry = {}) {
  return {
    ...entry,
    nSlug: normalizeArabic(entry.slug || ''),
    nTitle: normalizeArabic(entry.title || ''),
    nBody: normalizeArabic(entry.body || ''),
    nTags: Array.isArray(entry.tags) ? entry.tags.map((tag) => normalizeArabic(tag)).filter(Boolean) : []
  };
}

function scoreKnowledgeEntry(nText, entry) {
  let score = 0;

  for (const tag of entry.nTags || []) {
    if (!tag) continue;
    if (nText === tag) score += 12;
    else if (nText.includes(tag)) score += Math.max(4, Math.min(10, tag.length / 2));
    else if (tag.includes(nText) && nText.length >= 4) score += 3;
  }

  if (entry.nTitle && nText.includes(entry.nTitle)) score += 8;
  if (entry.nSlug && nText.includes(entry.nSlug)) score += 6;

  const words = nText.split(' ').filter(Boolean);
  let overlap = 0;
  for (const word of words) {
    if (word.length < 3) continue;
    if (entry.nTitle.includes(word) || entry.nSlug.includes(word) || entry.nTags.some((tag) => tag.includes(word))) overlap += 1.5;
    else if (entry.nBody.includes(word)) overlap += 0.35;
  }
  score += overlap;

  return score;
}

function searchKnowledgeEntries(text, entries = [], limit = 5) {
  const nText = normalizeArabic(text);
  if (!nText) return [];

  return entries
    .map(normalizeKnowledgeEntry)
    .map((entry) => ({ ...entry, score: scoreKnowledgeEntry(nText, entry) }))
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findKnowledgeBySlug(entries = [], slug) {
  return entries.find((entry) => entry.slug === slug) || null;
}

function bodyFromEntry(entries = [], slug, fallback) {
  return findKnowledgeBySlug(entries, slug)?.body || fallback;
}

function linesFromSuggestionEntry(entries = [], slug, fallback = []) {
  const body = findKnowledgeBySlug(entries, slug)?.body || '';
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());

  return lines.length ? lines : fallback;
}

async function tryOpenAI(text, recentMessages = [], knowledgeSnippets = []) {
  if (!CONFIG.ai.enabled || !CONFIG.ai.openaiApiKey) return null;

  const system = `أنت ${KNOWLEDGE_BASE.brand.botName} وتمثل ${KNOWLEDGE_BASE.brand.businessName}. تحدث بالعربية بأسلوب مهذب وراقي ومختصر. لا تخترع أي معلومة أو سعر. استخدم فقط البيانات التالية عند الإجابة:\n${knowledgeSnippets.join('\n')}\n\nإن كانت الرسالة ناقصة، اسأل سؤالاً واحداً فقط.`;
  const history = recentMessages.slice(-8).map((m) => `${m.direction === 'outbound' ? 'BOT' : 'USER'}: ${m.text || ''}`).join('\n');
  const payload = {
    model: CONFIG.ai.openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `سجل المحادثة الأخير:\n${history}\n\nرسالة العميل الحالية:\n${text}` }
    ],
    temperature: 0.2
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.ai.openaiApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

export async function analyzeCustomerText({ text, recentMessages = [] }) {
  const raw = String(text || '').trim();
  if (!raw) return { handled: false };

  const n = normalizeArabic(raw);
  const faq = findFaq(n);
  if (faq) return { handled: true, response: faq, intent: 'faq' };

  const countAnswer = findCountAnswer(n);
  if (countAnswer) return { handled: true, response: countAnswer, intent: 'count' };

  const dynamicEntries = await getDynamicKnowledgeEntries();
  const dynamicMatches = searchKnowledgeEntries(raw, dynamicEntries, 6);
  const bestDynamic = dynamicMatches[0] || null;

  if (wantsGreeting(n)) return { handled: true, response: bodyFromEntry(dynamicEntries, 'greeting-default', buildGreeting()), intent: 'greeting' };
  if (wantsThanks(n)) return { handled: true, response: KNOWLEDGE_BASE.generalAnswers.thanks, intent: 'thanks' };
  if (wantsLocation(n)) return { handled: true, response: bodyFromEntry(dynamicEntries, 'location-main', KNOWLEDGE_BASE.generalAnswers.location), intent: 'location' };
  if (wantsDelivery(n)) return { handled: true, response: bodyFromEntry(dynamicEntries, 'delivery-general', KNOWLEDGE_BASE.generalAnswers.delivery), intent: 'delivery' };
  if (wantsTracking(n)) return { handled: true, response: bodyFromEntry(dynamicEntries, 'tracking-help', buildTrackingReply()), intent: 'tracking' };
  if (wantsAvailable(n)) return { handled: true, response: bodyFromEntry(dynamicEntries, 'available-overview', buildAvailableReply()), intent: 'availability' };

  const matches = findItemMatches(n);
  const historySubject = matches[0] || inferSubjectFromHistory(recentMessages);

  if (wantsPricing(n)) {
    if (matches.length) return { handled: true, response: buildPriceReply(matches[0]), intent: 'pricing', matchedItems: matches };
    if (historySubject) return { handled: true, response: buildPriceReply(historySubject), intent: 'pricing_history', matchedItems: [historySubject] };
    if (bestDynamic) return { handled: true, response: bestDynamic.body, intent: 'pricing_db', knowledgeMatches: dynamicMatches };
    return { handled: true, response: 'بكل سرور 🌿\nاذكر لي الصنف المطلوب وسأرسل لك السعر والتفاصيل مباشرة.', intent: 'pricing' };
  }

  if (wantsOrder(n) && hasAny(n, ['شخصين','لشخصين'])) {
    const suggestions = linesFromSuggestionEntry(dynamicEntries, 'suggestions-2-people', buildSuggestionsByPeople(2));
    return { handled: true, response: `أكيد 🌿\nهذه بعض الخيارات المناسبة لك:\n${formatOfferList(suggestions)}\n\nاختر المناسب لك وسأكمل الطلب مباشرة.`, intent: 'order_suggestion_people', people: 2 };
  }
  if (wantsOrder(n) && hasAny(n, ['4 اشخاص','اربع اشخاص','للعائله','لعائلة','لعائله'])) {
    const suggestions = linesFromSuggestionEntry(dynamicEntries, 'suggestions-4-people', buildSuggestionsByPeople(4));
    return { handled: true, response: `أكيد 🌿\nهذه بعض الخيارات المناسبة لك:\n${formatOfferList(suggestions)}\n\nاختر المناسب لك وسأكمل الطلب مباشرة.`, intent: 'order_suggestion_people', people: 4 };
  }
  if (wantsOrder(n) && hasAny(n, ['6 اشخاص','سته اشخاص','لستة'])) {
    const suggestions = linesFromSuggestionEntry(dynamicEntries, 'suggestions-6-people', buildSuggestionsByPeople(6));
    return { handled: true, response: `أكيد 🌿\nهذه بعض الخيارات المناسبة لك:\n${formatOfferList(suggestions)}\n\nاختر المناسب لك وسأكمل الطلب مباشرة.`, intent: 'order_suggestion_people', people: 6 };
  }
  if (wantsOrder(n) && hasAny(n, ['عزيمه','عزيمة','10 اشخاص','20 شخص'])) {
    const suggestions = linesFromSuggestionEntry(dynamicEntries, 'suggestions-10-plus', buildSuggestionsByPeople(10));
    return { handled: true, response: `أكيد 🌿\nهذه بعض الخيارات المناسبة لك:\n${formatOfferList(suggestions)}\n\nاختر المناسب لك وسأكمل الطلب مباشرة.`, intent: 'banquet_suggestion', people: 10 };
  }

  if (wantsOrder(n) && matches.length) {
    return {
      handled: true,
      response: buildDirectOrderReply(matches, null),
      intent: 'direct_order',
      matchedItems: matches,
      draftOrder: {
        items: matches.map((item) => ({ key: item.key, title: item.title, qty: 1, unit: item.unit || null })),
        needsArea: true
      }
    };
  }

  if (wantsOrder(n) && bestDynamic) {
    return {
      handled: true,
      response: `تم بكل سرور ✅\n${bestDynamic.body}\n\nيرجى إرسال المنطقة أو الموقع لتأكيد التوصيل، أو أرسل الكمية إذا رغبت بإكمال الطلب مباشرة.`,
      intent: 'direct_order_db',
      knowledgeMatches: dynamicMatches
    };
  }

  if (bestDynamic && bestDynamic.score >= 5) {
    return {
      handled: true,
      response: bestDynamic.body,
      intent: 'knowledge_db',
      knowledgeMatches: dynamicMatches
    };
  }

  if (CONFIG.ai.enabled && CONFIG.ai.openaiApiKey) {
    const snippets = [
      ...matches.map((m) => m.reply),
      historySubject?.reply || '',
      ...dynamicMatches.map((entry) => entry.body),
      bodyFromEntry(dynamicEntries, 'brand-personality', '')
    ].filter(Boolean);
    const ai = await tryOpenAI(raw, recentMessages, snippets.slice(0, 8));
    if (ai) return { handled: true, response: ai, intent: 'openai' };
  }

  return { handled: false, response: KNOWLEDGE_BASE.generalAnswers.unclear, intent: 'fallback' };
}
