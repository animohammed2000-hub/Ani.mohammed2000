# الإعداد والنشر — مساعد آني

هذه الخطوات تخص **نسخة العمل الحالية**. لا تُغيّر مشروع Aani الأصلي ما لم
تُنسخ الملفات إليه بنفسك وبعد التأكد من اختيار مشروع Supabase الصحيح.

## 1. إعداد واجهة Replit

في مشروع Replit الذي سيستضيف الواجهة، أضف إلى Secrets:

| الاسم | المكان | ملاحظات |
|---|---|---|
| `VITE_SUPABASE_URL` | Replit | عنوان مشروع Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Replit | المفتاح العام الحديث، إن كان متاحًا |
| `VITE_SUPABASE_ANON_KEY` | Replit | بديل متوافق مع إعدادات المشروع القديمة |

استخدم واحدًا فقط من مفتاحي الواجهة العامة. هذه القيم متاحة للمتصفح بعد بناء
Vite؛ لا تضع فيها مفتاح Gemini أو مفتاح `service_role`.

## 2. إعداد Supabase وGemini

في لوحة Supabase للمشروع الصحيح، افتح إعدادات أسرار Edge Functions وأضف:

| الاسم | مطلوب؟ | القيمة |
|---|---:|---|
| `GEMINI_API_KEY` | نعم | مفتاح Google AI Studio؛ أدخله داخل Supabase فقط |
| `ALLOWED_ORIGINS` | نعم للمتصفح | أصل Replit للمعاينة وأصل النشر، مفصولان بفاصلة |
| `GEMINI_MODEL` | لا | الافتراضي `gemini-3.8-flash` |

أدخل الأصل فقط مثل `https://example.replit.app`، لا مسار صفحة ولا `/` أخير.
أضف أصل المعاينة الفعلي أيضًا إذا كان ثابتًا لديك. لا تستخدم `*`؛ CORS ليس
بديلًا عن المصادقة.

لا تضف `SUPABASE_URL` أو مفاتيح الخدمة يدويًا إلى Secrets المستضافة؛ Supabase
يوفر قيم الاتصال ومفاتيح Supabase المناسبة داخل بيئة الدالة. الكود يتحقق من
جلسة المستخدم عبر Supabase Auth، بالإضافة إلى تفعيل `verify_jwt`.

## 3. نشر الدوال

هذه الخطوات تتطلب أن يكون المطور داخل نسخة المستودع المرتبطة بمشروع Supabase
الصحيح، وأن يكون Supabase CLI مسجل الدخول. لا تشارك رمز تسجيل الدخول أو مفاتيح
الخدمات في المحادثة.

1. قارن `supabase/config.toml` ومجلد `supabase/functions/` مع المستودع الأصلي.
2. تحقق من اسم مشروع Supabase في لوحة التحكم قبل ربط CLI.
3. انشر `gemini-chat` بعد إضافة الأسرار.
4. الدالة `ai-assistant` القديمة صارت تتطلب جلسة مستخدم أيضًا، لكنها تحافظ على
   رد النجاح `{ reply }` لعملائها السابقين. ستتوقف أي استدعاءات مجهولة بعد
   حمايتها؛ تحقق من مستهلكيها قبل النشر، أو أوقفها إذا لم تعد مستخدمة.

أوامر CLI، من جذر المستودع الأصلي بعد التحقق من المشروع:

```sh
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy gemini-chat
```

لا تنفذ ترحيل قاعدة البيانات ضمن هذه الخطوات. لم تُضف أي SQL.

## 4. تشغيل وفحص نسخة Replit

في مشروع هذه النسخة:

```sh
pnpm --filter @workspace/aani-social run typecheck
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/aani-social run build
```

شغّل معاينة `Aani Social + Founder Assistant` بعد إدخال إعدادات Supabase.
إذا كانت مفاتيح Replit غير موجودة، لا يمكن تسجيل الدخول أو اختبار استدعاء
الدالة؛ لا يعني ظهور صفحة الواجهة أن Gemini يعمل.

## 5. تشخيص الطلب من المعاينة

1. في أدوات المطور، تأكد أن طلب `POST .../functions/v1/gemini-chat` أُرسل.
2. طابق `x-request-id` من الطلب مع سجل Edge Function.
3. الترتيب المتوقع للسجلات:
   `request_started` → `auth_check_started` → `auth_check_finished` →
   `gemini_request_started` → `gemini_response_received` →
   `request_succeeded`.
4. `request_started` وحده يثبت وصول الطلب للدالة فقط، ولا يثبت استدعاء Gemini.
5. `authState: invalid` يعني جلسة منتهية أو غائبة؛ `unavailable` يعني تعذر
   اتصال الدالة بخدمة المصادقة.
6. `gemini_request_started` دون `gemini_response_received` يشير إلى مهلة أو
   انقطاع اتصال upstream.
7. `gemini_response_received` ثم `gemini_json_parse_failed` أو
   `gemini_empty_response` يحدد مشكلة تحليل الاستجابة.
8. إذا سجلت الدالة `request_succeeded` ولم يظهر الرد، افحص حالة HTTP وجسم JSON
   في المتصفح، ثم تأكد أن نسخة الواجهة المنشورة تستعمل العقد نفسه.

لا تسجل الرسائل أو مفاتيح الجلسة. إلغاء الطلب في المتصفح لا يضمن إلغاء عمل
الخادم أو Gemini بعد استلام الطلب.

للتشغيل المحلي، أضف `http://localhost:5173` إلى `ALLOWED_ORIGINS` في بيئة
Supabase المرحلية، إلى جانب أصول Replit التي ستختبرها.

## 6. التراجع

- تغييرات هذه النسخة معزولة عن المشروع الأصلي؛ يمكن الرجوع إلى أرشيف ZIP أو
  نقطة تحقق في هذا المشروع.
- لا توجد تغييرات SQL كي تتراجع عنها.
- قبل نشر الدوال، احفظ نسخة من الدالة المنشورة الحالية. عند الحاجة أعد نشر
  النسخة السابقة من المستودع الأصلي بعد مراجعتها.
- لا تحذف دالة Supabase أو جدولًا أو سياسة RLS لمجرد أن النسخة لا تعرضها.
