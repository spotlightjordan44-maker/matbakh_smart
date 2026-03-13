# خطوات التنفيذ النهائية

## 1) على Supabase
نفّذ فقط هذا الملف الآن:

```text
supabase/migrations/0005_operational_policy_patch.sql
```

ولا تنفّذ `0001_init.sql` أو `0002_seed.sql` فوق القاعدة الحالية لأن لديك جداول تشغيل موجودة بالفعل.

## 2) على Render
تأكد من بقاء القيم الأساسية الحالية صحيحة:
- `APP_BASE_URL=https://matbakh-smart.onrender.com`
- `WHATSAPP_VERIFY_TOKEN` نفس المستخدم في Meta
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `APPROVAL_MODE_DEFAULT=manual_first`
- `OPERATING_START_HOUR=10`
- `OPERATING_END_HOUR=18`
- `RAMADAN_IFTAR_ONLY=true`

## 3) على Meta
- Callback URL: `https://matbakh-smart.onrender.com/webhook`
- Verify Token: نفس قيمة `WHATSAPP_VERIFY_TOKEN`

## 4) على Hostinger
يبقى للموقع التعريفي فقط:
- الصفحات
- المنيو العام
- زر واتساب
- النماذج
- التتبع

## 5) اختبار التشغيل
أرسل بالتسلسل:
1. `مرحبا`
2. `هل الأكل مطبوخ؟`
3. `بدي مقلوبة على دجاجة`
4. `وين موقعكم؟`
5. `في توصيل؟`

ويجب أن ترى الرسائل محفوظة في `conversations`، والمعرفة مستخدمة من `bot_knowledge_entries`.
