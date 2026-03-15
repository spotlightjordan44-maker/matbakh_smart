# خطوات النشر النهائية – مطبخ اليوم المركزي

## 1) GitHub
- ارفع المشروع النهائي إلى مستودع GitHub جديد.
- تأكد أن `.env` غير مرفوع.
- ارفع فقط `.env.example`.

## 2) Supabase
- أنشئ مشروع Supabase.
- نفّذ ملف migration الأساسي.
- انسخ:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## 3) Meta WhatsApp Cloud API
- انسخ:
  - `PHONE_NUMBER_ID`
  - `WHATSAPP_TOKEN`
- أنشئ قيمة `WHATSAPP_VERIFY_TOKEN` من عندك.
  - مثال: `matbakh_verify_2026`

## 4) Render
- أنشئ Web Service جديدًا من GitHub.
- استخدم:
  - Build Command: `npm install && npm run build`
  - Start Command: `npm run start`
- الصق كل القيم الموجودة في `RENDER_ENV_VALUES.txt` داخل Environment.
- بعد أول نشر، انسخ رابط الخدمة وضعه في:
  - `APP_BASE_URL=https://your-service.onrender.com`

## 5) Webhook في Meta
- Callback URL:
  - `https://YOUR-RENDER-URL.onrender.com/webhook`
- Verify Token:
  - نفس قيمة `WHATSAPP_VERIFY_TOKEN`

## 6) اختبار التشغيل
اختبر بالترتيب:
- رسالة ترحيب
- اختيار اللغة
- تصنيف نوع المتواصل
- فتح المنيو
- إضافة صنف إلى السلة
- إرسال الطلب
- تنفيذ أمر إداري مثل:
  - `الطلبات الجديدة`
  - `قبول الطلب 1001`
  - `رسوم التوصيل 1001 4`
  - `بدء التحضير 1001`

## 7) الإطلاق
بعد نجاح الاختبار:
- شغّل الحملة الأولى
- راقب الطلبات
- راقب أوامر الإدارة
- راقب أخطاء Render Logs

## ملاحظات مهمة
- لا تضع أي أسرار داخل GitHub.
- لا تضع `WHATSAPP_TOKEN` أو `SUPABASE_SERVICE_ROLE_KEY` داخل الملفات.
- جميع الأسرار داخل Render فقط.
- الرسائل للعميل يجب أن تبقى محايدة ولا تُظهر أي تنسيق داخلي.
