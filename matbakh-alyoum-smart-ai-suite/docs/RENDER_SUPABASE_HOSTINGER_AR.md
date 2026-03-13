# دليل الربط النهائي: Render + Supabase + Hostinger

## 1) البنية المقترحة

- الواجهة التعريفية والمحتوى التسويقي: **Hostinger**
- البوت والويب هوك والـ API: **Render**
- قاعدة البيانات والذاكرة وقاعدة المعرفة: **Supabase**
- قناة الرسائل: **Meta WhatsApp Cloud API**

## 2) هل يوجد ربط مع Hostinger؟

نعم، ولكن الربط الصحيح ليس أن يشغّل Hostinger البوت نفسه، بل أن يبقى الموقع هناك ويشير إلى خدمة البوت على Render.

## 3) أفضل ربط عملي

### الخيار الموصى به الآن
- الموقع الرئيسي: `https://www.matbakh-alyoum.site`
- الباك إند: `https://matbakh-alyoum-bot.onrender.com`
- لاحقًا يمكن ربط Subdomain مثل:
  - `https://api.matbakh-alyoum.site`
  - `https://bot.matbakh-alyoum.site`

## 4) ماذا يضاف داخل Hostinger

- زر واتساب مباشر
- روابط المنيو والخصوصية والشروط
- كود تتبع وتحليلات
- كود مخصص داخل `<head>` أو `<body>`
- أي نموذج Lead Form بسيط يرسل إلى Render لاحقًا

## 5) ماذا يضاف داخل Render

- جميع متغيرات البيئة
- عنوان `APP_BASE_URL`
- ربط Custom Domain إذا رغبت
- health check على `/health`

## 6) ماذا يضاف داخل Supabase

- الجداول الأساسية
- ذاكرة المحادثات
- حقائق العميل
- قاعدة المعرفة
- بيانات المنيو

## 7) خطوات الإطلاق المختصرة

1. رفع المشروع إلى GitHub.
2. تشغيل ملفات SQL في Supabase.
3. إنشاء Web Service في Render.
4. تعبئة Environment Variables.
5. ضبط Webhook في Meta على رابط Render.
6. تحديث أزرار وروابط Hostinger.
7. اختبار رسالة واتساب فعلية.

## 8) إذا أردت إبقاء كل شيء منظمًا

- Hostinger = واجهة وتعريف وتسويق
- Render = تشغيل ذكي + Webhook + منطق البوت
- Supabase = بيانات وذاكرة ومعرفة

هذا هو النموذج الأنظف والأكثر استقرارًا لهذه المرحلة.
