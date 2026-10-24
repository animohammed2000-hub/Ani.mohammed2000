# Aani Social + Founder Assistant

هذه نسخة عمل منفصلة مبنية من أرشيف المشروع الذي أرفقه المستخدم. ليست مرتبطة
بحساب Replit أو مشروع Supabase الأصلي، ولم تُنشر أي تغييرات إلى الخدمة الحية.

## ما تم العثور عليه في الأرشيف

- التطبيق الاجتماعي الفعلي موجود في `artifacts/social-feed/src/App.tsx`.
- الشاشة الحالية كانت تستدعي `gemini-chat` بوسيط `messages` وتقرأ `data.text`.
- ملف `supabase/functions/gemini-chat/index.ts` في المسار الذي يتوقعه Supabase
  كان فارغًا. الكود المفصل كان داخل مجلد شبيه الاسم يحتوي محرفًا مخفيًا؛ هذا
  المسار لا يطابق اسم الدالة القياسي، ولذلك لا يُعدّ مصدرًا موثوقًا للنشر.
- الدالة القديمة `ai-assistant` لم تكن تتحقق من جلسة المستخدم.
- ملف `src/components/AIAssistantModal.tsx` المنفصل لم يكن مستوردًا في التطبيق
  الفعلي، كما احتوى علامات اقتباس طباعية بدل علامات TypeScript المعتادة.
- ملف SQL المرفق لا يعرّف كل الجداول التي يستعملها التطبيق الحالي: مثل
  `bookmarks` و`notifications` و`reposts` و`stories` و`story_likes`. لم ننفذ
  SQL ولم نضف جداول أو سياسات؛ حالة قاعدة البيانات الحية غير معروفة.

## البنية الحالية

```text
واجهة Aani (React/Vite)
  └─ Supabase Auth: جلسة المستخدم
      └─ POST /functions/v1/gemini-chat
          ├─ التحقق من JWT وهوية المستخدم
          ├─ فحص المدخلات وطلب Gemini بمهلة مستقلة
          └─ رد موحد + requestId وسجلات مراحل آمنة
```

المساعد في هذه النسخة محادثة فقط. Gemini لا يملك أدوات لقراءة ملفات Replit أو
تعديلها أو تشغيل أوامر أو إدارة قاعدة البيانات. لذلك لا يَعرض التطبيق وظائف
إدارية شكلية ولا يسمح للنموذج بادعاء تنفيذ تغييرات.

## الملفات الأساسية

### مستوردة ومحفوظة من نسخة المشروع

- `src/App.tsx` — تطبيق Aani الاجتماعي، ومساراته وعمليات Supabase الحالية.
- `src/index.css` و`src/components/` و`src/hooks/` و`src/lib/` و`src/pages/`.
- `public/` و`index.html`.
- `supabase/schema.sql` — نسخة المخطط الموجودة في الأرشيف؛ محفوظة دون تشغيلها
  أو تعديلها.

### أضيفت أو عُدّلت لهذه النسخة

- `supabase/functions/_shared/gemini.ts` — التحقق، حدود الطلب، المهلات،
  السجلات الآمنة، واستدعاء Gemini.
- `supabase/functions/gemini-chat/index.ts` — المسار الصحيح للدالة النشطة.
- `supabase/functions/ai-assistant/index.ts` — مسار قديم محمي يحافظ على
  ردّ `{ reply }` لعملائه السابقين؛ الدالة النشطة للواجهة هي `gemini-chat`.
- `supabase/config.toml` — يثبت `verify_jwt = true` للدالتين.
- `docs/assistant-api-contract.md` — عقد الواجهة والخلفية.
- `docs/SETUP_AR.md` — إعدادات Replit وSupabase وخطوات النشر والتراجع.
- `docs/TEST_PLAN_AR.md` — خطة الاختبار المطلوبة وتفسير السجلات.
- `docs/ADMIN_TOOLS_AR.md` — ما يلزم قبل تنفيذ أدوات المؤسس والبرمجة.

لم تُضف جداول SQL أو سياسة صلاحيات إلى قاعدة البيانات.

## الإعدادات المطلوبة

**في Replit Secrets للواجهة:**

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` أو الاسم الأقدم
  `VITE_SUPABASE_ANON_KEY`

المفتاح العام مخصص للمتصفح، ولا يمنح صلاحيات إدارية بحد ذاته عند تفعيل RLS.
لا تضف `service_role` أو أي مفتاح سري إلى الواجهة.

**في Supabase Edge Function Secrets:**

- `GEMINI_API_KEY` — سرّ Google Gemini، يبقى في Supabase فقط.
- `ALLOWED_ORIGINS` — عناوين الواجهة المسموح بها مفصولة بفواصل، دون نطاقات
  عامة مثل `*`.
- `GEMINI_MODEL` — اختياري؛ الافتراضي `gemini-3.8-flash`.

يوفر Supabase المستضاف `SUPABASE_URL` ومفاتيح Supabase تلقائيًا للدوال. لا
تُنسخ مفاتيح الخدمة إلى Replit. يدعم الكود مفاتيح Supabase الحديثة والعامة
والأسماء القديمة. لا تُستخدم `SESSION_SECRET` في هذا التكامل.

## الدقة والوثائق الرسمية

وفق كتالوج Google الذي تمت مراجعته بتاريخ 22 أكتوبر 2026، يظهر
`gemini-3.8-flash` كنموذج Stable مناسب لمهام الوكلاء والبرمجة؛ كما يظل
`gemini-2.5-flash` مدرجًا في الكتالوج. الاختيار قابل للتغيير بواسطة
`GEMINI_MODEL`، لكن توفر النموذج وحصة المفتاح يجب اختبارهما في حساب Google
الذي يملكه المستخدم.

- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini generateContent REST API](https://ai.google.dev/api/generate-content)
- [Supabase Edge Function auth](https://supabase.com/docs/guides/functions/auth)
- [Supabase Edge Function CORS](https://supabase.com/docs/guides/functions/cors)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [استيراد ZIP إلى Replit](https://docs.replit.com/references/workspace/import)

## الحالة

| البند | النتيجة |
|---|---|
| فحص محتوى الأرشيف | تم فحصه ساكنًا، دون تشغيله |
| سبب خلل المحادثة | اختلاف عقد الطلب/الرد ومسار دالة فارغ في النسخة |
| كود واجهة ودالة Gemini | موجود في هذه النسخة؛ يحتاج إعداد خدمات المالك |
| إعداد مفاتيح Replit/Supabase | لم يُضف أي مفتاح أو سر |
| الاتصال بـ Supabase الأصلي | غير متاح من هذه النسخة |
| اتصال حي بـ Gemini/Supabase | غير مختبر؛ لم يُستخدم مفتاح المالك |
| أدوات إدارة المؤسس/تعديل الملفات | غير منفذة؛ أسبابها في `docs/ADMIN_TOOLS_AR.md` |
| تغييرات قاعدة البيانات | لا شيء |
| فحص TypeScript للواجهة | نجح |
| فحص TypeScript لدوال Supabase | نجح باستخدام تعريف Deno محلي مؤقت؛ لم يُثبت Deno CLI |
| اختبارات منطق الدالة بمحاكاة HTTP | نجح: جلسة مرفوضة، جلسة صالحة ورد Gemini محاكى، مصدر CORS مرفوض، وجسم زائد |
| بناء Vite | نجح؛ مع تحذير مصدر خرائط في tooltip وتحذير حجم حزمة أكبر من 500 كيلوبايت |
| سير العمل والمعاينة | يعمل؛ المعاينة تعرض شاشة الدخول والتنبيه بأن إعدادات Supabase غير موجودة |
| اختبار تسجيل دخول/محادثة حقيقية | لم يُنفذ؛ يتطلب إعدادات Supabase وGemini التي يملكها المستخدم |

هذه النسخة ليست جاهزة للإنتاج حتى تُطبّق ملفات الدالة على المشروع الصحيح،
وتُضبط أسرار المالك، ويُجتاز اختبار تسجيل الدخول والمحادثة في بيئة مرحلية.
