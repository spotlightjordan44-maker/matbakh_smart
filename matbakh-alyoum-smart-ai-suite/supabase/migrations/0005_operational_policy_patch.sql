-- Safe patch for existing Supabase schema in Matbakh Al Youm
-- Adds AI memory + official operational knowledge without touching existing core tables.

create table if not exists public.customer_facts (
  id bigint generated always as identity primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  phone text,
  fact_key text not null,
  fact_value jsonb not null default '{}'::jsonb,
  source text not null default 'bot',
  confidence numeric(4,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, fact_key)
);

create index if not exists idx_customer_facts_customer_id on public.customer_facts(customer_id);
create index if not exists idx_customer_facts_phone on public.customer_facts(phone);
create index if not exists idx_customer_facts_fact_key on public.customer_facts(fact_key);

create table if not exists public.bot_knowledge_entries (
  id bigint generated always as identity primary key,
  category text not null,
  question text,
  answer text not null,
  keywords text[] not null default '{}',
  locale text not null default 'ar-JO',
  is_active boolean not null default true,
  priority integer not null default 100,
  source text not null default 'manual',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bot_knowledge_entries_category on public.bot_knowledge_entries(category);
create index if not exists idx_bot_knowledge_entries_active on public.bot_knowledge_entries(is_active);
create index if not exists idx_bot_knowledge_entries_priority on public.bot_knowledge_entries(priority);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customer_facts_updated_at on public.customer_facts;
create trigger trg_customer_facts_updated_at
before update on public.customer_facts
for each row
execute function public.set_updated_at();

drop trigger if exists trg_bot_knowledge_entries_updated_at on public.bot_knowledge_entries;
create trigger trg_bot_knowledge_entries_updated_at
before update on public.bot_knowledge_entries
for each row
execute function public.set_updated_at();

insert into public.bot_knowledge_entries (category, question, answer, keywords, priority, source, meta)
values
('greeting', 'الرسالة الافتتاحية الرسمية', 'أهلاً وسهلاً بكم في مطبخ اليوم المركزي 🌿\n\nكل عام وأنتم بخير بمناسبة الشهر الفضيل، وقرب عيد الفطر السعيد.\nتقبل الله طاعاتكم، وجعلكم من المقبولين.\n\nأنا مساعد مطبخ اليوم الذكي، ويسعدني خدمتك بكل اهتمام وسرعة في:\n• استقبال الطلبات\n• عرض الأصناف والأسعار\n• توضيح رسوم ومناطق التوصيل\n• متابعة الطلبات\n• المساعدة في الطلبات الخاصة\n\nونود التنويه أن البيع الحالي خلال رمضان مخصص لوجبة الإفطار.', array['ترحيب','بداية','welcome','ramadan','افتتاحية'], 1, 'operations_policy', '{"type":"system_message"}'),
('policy', 'ما هي قاعدة تأكيد الطلب؟', 'لا يتم تأكيد أي طلب للعميل نهائيًا إلا بعد: جمع كامل معلومات الطلب، احتساب قيمة الأصناف بشكل منفصل، تحديد منطقة التوصيل ورسوم التوصيل بشكل منفصل، إرسال الطلب داخليًا للإدارة أو الجهة المخولة، وصول قرار موافقة أو رفض أو تعديل، ثم العودة للعميل بالتفاصيل النهائية. بعد تأكيد العميل النهائي فقط يبدأ التنفيذ.', array['تأكيد الطلب','موافقة','اعتماد','approval','policy'], 1, 'operations_policy', '{"type":"rule"}'),
('policy', 'هل يرى العميل المراسلات الداخلية؟', 'لا. العميل لا يرى أي مراسلات داخلية. العميل يتعامل مع مطبخ اليوم الذكي كواجهة واحدة، والقرار النهائي يظهر للعميل وكأنه صادر من النظام مباشرة، بينما تعمل الإدارة والموظفون في الخلفية فقط.', array['مراسلات داخلية','ادارة','خصوصية','واجهة واحدة'], 2, 'operations_policy', '{"type":"rule"}'),
('policy', 'ما هي أوقات التشغيل؟', 'وقت التشغيل المعتمد للتأكيد والتسليم حاليًا من 10:00 صباحًا حتى 6:00 مساءً بتوقيت عمّان. داخل هذا الوقت يسمح باستكمال المسار كاملًا. خارج هذا الوقت يسمح بالاستفسار وتجميع البيانات فقط ولا يصدر تأكيد نهائي.', array['وقت التشغيل','اوقات العمل','10','6','توقيت'], 1, 'operations_policy', '{"type":"business_hours","start":"10:00","end":"18:00","timezone":"Asia/Amman"}'),
('ramadan', 'ما سياسة رمضان؟', 'خلال شهر رمضان المبارك، البيع الحالي لدينا مخصص لوجبة الإفطار فقط. إذا كان الطلب لا يطابق هذا النطاق، يوضح البوت ذلك بلطف ويساعد العميل في اختيار الأصناف المناسبة للإفطار.', array['رمضان','افطار','وجبة الافطار','ramadan'], 1, 'operations_policy', '{"type":"seasonal_rule"}'),
('delivery', 'كيف يعرض السعر؟', 'يجب أن يبقى الفصل واضحًا دائمًا: سعر الطلب + رسوم التوصيل = الإجمالي النهائي. لا يجوز دمج السعر والتوصيل بشكل مبهم.', array['رسوم التوصيل','الاجمالي','السعر','subtotal','delivery fee'], 2, 'operations_policy', '{"type":"pricing_rule"}'),
('language', 'ما سياسة اللغة؟', 'يتم اكتشاف لغة العميل تلقائيًا من أول رسالة والرسائل اللاحقة والرسائل الصوتية بعد تفريغها. يرد البوت بنفس لغة العميل أو لهجته المناسبة، ولا يخلط اللغات داخل نفس الرد إلا عند الضرورة.', array['لغة','english','arabic','لهجة','language'], 2, 'operations_policy', '{"type":"language_rule"}'),
('voice', 'ما سياسة الرسائل الصوتية؟', 'النظام يدعم استقبال الرسائل الصوتية، تحويل الصوت إلى نص، فهم النية واللغة، والرد نصيًا أو صوتيًا حسب الحالة وتفضيل العميل. إذا كان العميل يفضل الصوت أو طلب الرد الصوتي، يمكن الرد بصوت واضح ومهذب وقصير.', array['صوت','رسالة صوتية','voice','audio'], 2, 'operations_policy', '{"type":"voice_rule"}'),
('privacy', 'ما قواعد الأمان والخصوصية؟', 'لا يظهر للعميل أي اتصال داخلي مع الإدارة. لا يكشف أي بيانات عميل لعميل آخر. لا يكشف أرقام أو عناوين أو تفاصيل غير مصرح بها. لا يكشف أسعار داخلية أو هوامش أو تكاليف أو بيانات موردين. لا تستخدم أي معلومات محفوظة إلا لتسريع الخدمة وتحسينها بشكل آمن.', array['خصوصية','امان','بيانات','privacy','security'], 1, 'operations_policy', '{"type":"security_rule"}'),
('order_flow', 'ما هي مراحل الطلب الداخلية؟', 'الحالات الداخلية المعتمدة: draft، awaiting_internal_review، approved_pending_customer_confirmation، customer_confirmed، in_preparation، packed، out_for_delivery، delivered، closed، cancelled. أما العميل فيرى فقط الصياغات المناسبة مثل: تم استلام طلبك، تم تأكيد طلبك، الطلب قيد التجهيز، الطلب خرج للتوصيل، تم التسليم.', array['حالات الطلب','status','draft','customer_confirmed'], 2, 'operations_policy', '{"type":"status_flow"}'),
('faq', 'هل الأكل مطبوخ؟', 'نعم، الأكل مطبوخ وجاهز للأكل مباشرة. كما يتوفر بعض الأصناف غير المطبوخة حسب الطلب.', array['مطبوخ','جاهز','غير مطبوخ'], 1, 'menu_knowledge', '{}'),
('faq', 'كم حبة في كيلو ورق العنب؟', 'كيلو ورق العنب يحتوي تقريباً على 60 إلى 65 حبة.', array['ورق عنب','كيلو','حبة'], 1, 'menu_knowledge', '{}'),
('faq', 'كم حبة كوسا في الكيلو؟', 'كيلو الكوسا يحتوي تقريباً على 10 إلى 12 حبة حسب الحجم.', array['كوسا','كيلو','حبة'], 1, 'menu_knowledge', '{}'),
('faq', 'كم حبة باذنجان في الكيلو؟', 'كيلو الباذنجان يحتوي تقريباً على 10 إلى 12 حبة حسب الحجم.', array['باذنجان','كيلو','حبة'], 1, 'menu_knowledge', '{}'),
('faq', 'كم حبة يالنجي في الكيلو؟', 'كيلو اليالنجي بعد اللف يحتوي تقريباً على 40 إلى 44 حبة.', array['يالنجي','كيلو','حبة'], 1, 'menu_knowledge', '{}'),
('pricing_raw', 'كم سعر كيلو ورق عنب غير مطبوخ؟', 'كيلو ورق العنب غير المطبوخ سعره 8 دنانير.', array['ورق عنب','غير مطبوخ','سعر'], 2, 'menu_knowledge', '{}'),
('pricing_raw', 'كم سعر كيلو كوسا غير مطبوخ؟', 'كيلو الكوسا غير المطبوخ سعره 5 دنانير.', array['كوسا','غير مطبوخ','سعر'], 2, 'menu_knowledge', '{}'),
('pricing_raw', 'كم سعر كيلو باذنجان غير مطبوخ؟', 'كيلو الباذنجان غير المطبوخ سعره 5 دنانير.', array['باذنجان','غير مطبوخ','سعر'], 2, 'menu_knowledge', '{}'),
('delivery', 'هل يوجد توصيل؟', 'نعم يتوفر توصيل حسب المنطقة. أرسل المنطقة أو الموقع لنحدد وقت ورسوم التوصيل بدقة.', array['توصيل','دليفري','يوصل'], 1, 'menu_knowledge', '{}'),
('location', 'وين موقعكم؟', 'موقعنا في عمّان – أم السماق.', array['موقع','عنوان','وين'], 1, 'menu_knowledge', '{}'),
('customer_message', 'رسالة خارج وقت التشغيل', 'يسعدني خدمتك 🌿\nنستقبل الطلبات والاستفسارات، مع التنويه أن تأكيد الطلبات والتسليم يتم حاليًا ضمن الفترة من 10:00 صباحًا حتى 6:00 مساءً بتوقيت عمّان.\n\nيمكنني الآن تسجيل طلبك مبدئيًا ومتابعته في أول وقت متاح ضمن فترة التشغيل.', array['خارج الوقت','وقت التشغيل','after hours'], 2, 'operations_policy', '{"type":"customer_message"}'),
('customer_message', 'رسالة بعد الموافقة الداخلية', 'يسعدني خدمتك 🌿\nهذه تفاصيل طلبك النهائية:\n\n• قيمة الطلب: [قيمة الأصناف]\n• رسوم التوصيل: [رسوم التوصيل]\n• الإجمالي النهائي: [الإجمالي]\n• وقت التوصيل المتوقع: [الوقت]\n\nإذا رغبت بالمتابعة، أرسل: تأكيد الطلب', array['تفاصيل نهائية','موافقة','تأكيد الطلب'], 3, 'operations_policy', '{"type":"customer_message_template"}'),
('customer_message', 'رسالة بعد تأكيد العميل', 'تم تأكيد طلبك بنجاح 🌿\nنعمل الآن على متابعته حتى التسليم، وسأبقيك على اطلاع بحالة الطلب.', array['تم تأكيد طلبك','customer confirmed'], 3, 'operations_policy', '{"type":"customer_message_template"}')
on conflict do nothing;
