# مطبخ اليوم المركزي — النسخة النهائية الجاهزة للنشر

هذه الحزمة هي النسخة التشغيلية الكاملة الجاهزة للرفع على GitHub ثم النشر على Render وربطها مع Supabase وواتساب Cloud API، مع إمكانية إبقاء الموقع التعريفي على Hostinger بدون تعارض.

## المعمارية المعتمدة

- **Meta / WhatsApp Cloud API**: استقبال رسائل العملاء وإرسال الرسائل التفاعلية.
- **Render**: تشغيل الباك إند والويب هوك وخدمة البوت.
- **Supabase**: قاعدة البيانات، الجلسات، الطلبات، الذاكرة، وقاعدة المعرفة.
- **Hostinger**: الموقع التعريفي والصفحات التسويقية والمنيو الثابت وروابط واتساب.

## ماذا تحتوي هذه الحزمة

```text
.
├── .env.example
├── package.json
├── render.yaml
├── public/
├── src/
├── supabase/
├── docs/
└── hostinger/
```

## المسارات المهمة

- `GET /health` فحص الخدمة
- `GET /webhook` تحقق Meta
- `POST /webhook` استقبال أحداث واتساب
- `/` الصفحة الرئيسية
- `/menu.html` المنيو
- `/privacy.html` الخصوصية
- `/terms.html` الشروط

## ترتيب التشغيل الصحيح

### 1) Supabase
شغّل ملفات SQL بالترتيب:

```text
supabase/migrations/0001_init.sql
supabase/migrations/0002_seed.sql
supabase/migrations/0003_ai_memory.sql
supabase/migrations/0004_knowledge_seed.sql
```

### 2) Render
- ارفع المشروع إلى GitHub.
- أنشئ Web Service جديد من المستودع.
- استخدم `render.yaml` أو أدخل القيم يدويًا.
- أضف جميع متغيرات البيئة من `.env.example`.

### 3) Meta / WhatsApp
- اربط رقم واتساب التجاري.
- اضبط عنوان الويب هوك على:
  - `GET /webhook`
  - `POST /webhook`
- أضف القيم التالية في Render:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_VERIFY_TOKEN`

### 4) Hostinger
يمكن إبقاء الموقع التعريفي على Hostinger كما هو، مع ربطه بالبوت بإحدى الطرق التالية:
- أزرار واتساب مباشرة.
- أزرار تفتح صفحات المنيو أو الحجز.
- إضافة كود مخصص أو سكربت في الموقع.
- توجيه Subdomain مثل `api.yourdomain.com` إلى Render.

## متغيرات البيئة الضرورية جدًا

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
WA_ADMIN_NUMBERS=
APP_BASE_URL=
```

## أوامر التشغيل المحلي

```bash
npm install
cp .env.example .env
npm run dev
```

## ملاحظات تشغيلية

- هذه النسخة تدعم التخزين في Supabase للرسائل والحقائق وقاعدة المعرفة.
- إذا لم تضع `OPENAI_API_KEY` سيعمل النظام بوضع قواعد + ذاكرة + قاعدة معرفة.
- إذا أضفت `OPENAI_API_KEY` سيتفعل الفهم الأذكى مع المحافظة على القواعد التشغيلية.
- رقم الطلب الظاهر بصيغة `EMANI001` وما بعدها.

## أهم الملفات التي ستعدلها لاحقًا عند التوسعة

- `src/bot.js`
- `src/brain.js`
- `src/supabase.js`
- `supabase/migrations/0004_knowledge_seed.sql`
- `hostinger/CUSTOM_CODE_SNIPPETS.md`

## هل يلزم نقل الموقع من Hostinger؟

لا.
يمكن أن يبقى الموقع التعريفي على Hostinger بالكامل، بينما يبقى البوت والويب هوك والباك إند على Render، وقاعدة البيانات على Supabase. هذا هو الخيار الأنظف والأسرع للمشروع في مرحلته الحالية.
