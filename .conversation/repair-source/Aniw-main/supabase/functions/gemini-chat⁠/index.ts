
const PROJECT_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_ITEM_CHARS = 2000;
const MAX_TOTAL_CHARS = 12000;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowed =
    !origin || ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin);

  return {
    "Access-Control-Allow-Origin": allowed && origin
      ? origin
      : ALLOWED_ORIGINS.size === 0
      ? "*"
      : "null",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  const headers = new Headers(corsHeaders(req));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function fail(
  req: Request,
  status: number,
  code: string,
  message: string,
): Response {
  return json(req, { ok: false, error: { code, message } }, status);
}

/**
 * يطبق المهلة على الاتصال وقراءة جسم الرد معاً.
 * يعيد بناء Response بعد قراءة الجسم حتى تبقى الواجهة البرمجية المعتادة.
 */
async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    const body = response.body;

    if (!body) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
        // تجاهل خطأ الإلغاء مع الاحتفاظ بالخطأ الأصلي.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

function getSupabasePublishableKey(): string | null {
  const direct =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

  if (direct) return direct;

  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!raw) return null;

  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;

    if (typeof keys.default === "string") return keys.default;

    return Object.values(keys).find(
      (value): value is string => typeof value === "string",
    ) ?? null;
  } catch {
    return null;
  }
}

async function checkSignedInUser(
  req: Request,
): Promise<"valid" | "invalid" | "unavailable"> {
  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) return "invalid";

  const publishableKey = getSupabasePublishableKey();

  if (!PROJECT_URL || !publishableKey) {
    console.error("[gemini-chat] Auth configuration missing.");
    return "unavailable";
  }

  console.log("[gemini-chat] Checking user session.");

  try {
    const response = await fetchWithTimeout(
      `${PROJECT_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${match[1]}`,
        },
      },
      8000,
    );

    if (response.status === 401 || response.status === 403) {
      console.warn("[gemini-chat] Session rejected:", response.status);
      return "invalid";
    }

    if (!response.ok) {
      console.error("[gemini-chat] Auth HTTP error:", response.status);
      return "unavailable";
    }

    const user = await response.json().catch(() => null) as
      | { id?: unknown }
      | null;

    if (user && typeof user.id === "string") {
      console.log("[gemini-chat] Session verified.");
      return "valid";
    }

    return "invalid";
  } catch (error) {
    console.error("[gemini-chat] Auth request failed:", error);
    return "unavailable";
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const log = (stage: string, details?: unknown) => {
    console.log(JSON.stringify({
      requestId,
      stage,
      elapsedMs: Date.now() - startedAt,
      details: details ?? null,
    }));
  };

  const logError = (stage: string, error: unknown) => {
    console.error(JSON.stringify({
      requestId,
      stage,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : String(error),
    }));
  };

  log("request_started", { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  const origin = req.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.size > 0 && !ALLOWED_ORIGINS.has(origin)) {
    return fail(req, 403, "ORIGIN_NOT_ALLOWED", "هذا المصدر غير مسموح.");
  }

  if (req.method !== "POST") {
    return fail(req, 405, "METHOD_NOT_ALLOWED", "استخدم POST فقط.");
  }

  log("auth_check_started");

  const authState = await checkSignedInUser(req);

  log("auth_check_finished", { authState });

  if (authState === "invalid") {
    return fail(req, 401, "AUTH_REQUIRED", "سجّل الدخول ثم أعد المحاولة.");
  }

  if (authState === "unavailable") {
    return fail(
      req,
      503,
      "AUTH_CHECK_UNAVAILABLE",
      "تعذر التحقق من جلسة المستخدم. تحقق من إعدادات Supabase.",
    );
  }

  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return fail(req, 415, "JSON_REQUIRED", "أرسل الطلب بصيغة JSON.");
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");

  if (declaredLength > MAX_BODY_BYTES) {
    return fail(req, 413, "BODY_TOO_LARGE", "حجم الطلب أكبر من المسموح.");
  }

  let rawBody: string;

  try {
    rawBody = await req.text();
  } catch (error) {
    logError("request_body_read_failed", error);
    return fail(req, 400, "INVALID_BODY", "تعذر قراءة جسم الطلب.");
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return fail(req, 413, "BODY_TOO_LARGE", "حجم الطلب أكبر من المسموح.");
  }

  let payload: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail(req, 400, "INVALID_JSON", "يجب إرسال كائن JSON صالح.");
    }

    payload = parsed as Record<string, unknown>;
  } catch {
    return fail(req, 400, "INVALID_JSON", "جسم الطلب ليس JSON صالحاً.");
  }

  if (typeof payload.message !== "string" || !payload.message.trim()) {
    return fail(req, 400, "MESSAGE_REQUIRED", "حقل message مطلوب.");
  }

  const message = payload.message.trim();

  if (message.length > MAX_MESSAGE_CHARS) {
    return fail(req, 413, "MESSAGE_TOO_LONG", "الرسالة أطول من الحد المسموح.");
  }

  if (payload.history !== undefined && !Array.isArray(payload.history)) {
    return fail(req, 400, "INVALID_HISTORY", "history يجب أن يكون قائمة.");
  }

  const historyInput = ((payload.history ?? []) as unknown[])
    .slice(-MAX_HISTORY_MESSAGES);

  const history: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];

  let totalChars = message.length;

  for (const entry of historyInput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return fail(req, 400, "INVALID_HISTORY", "عنصر في history غير صالح.");
    }

    const item = entry as Record<string, unknown>;

    if (
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string"
    ) {
      return fail(req, 400, "INVALID_HISTORY", "صيغة عنصر history غير صالحة.");
    }

    const text = item.content.trim();

    if (!text || text.length > MAX_HISTORY_ITEM_CHARS) {
      return fail(
        req,
        400,
        "INVALID_HISTORY",
        "عنصر history فارغ أو أطول من الحد المسموح.",
      );
    }

    totalChars += text.length;

    history.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return fail(
      req,
      413,
      "CONVERSATION_TOO_LONG",
      "المحادثة أطول من المسموح.",
    );
  }

  if (!GEMINI_API_KEY) {
    logError("gemini_key_missing", "GEMINI_API_KEY is not configured");
    return fail(
      req,
      500,
      "GEMINI_NOT_CONFIGURED",
      "مفتاح Gemini غير مضبوط في أسرار Supabase.",
    );
  }

  const contents = [
    ...history,
    { role: "user" as const, parts: [{ text: message }] },
  ];

  log("gemini_request_started", {
    model: MODEL,
    messageLength: message.length,
    historyCount: history.length,
    timeoutMs: 12000,
  });

  let upstream: Response;

  try {
    upstream = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 2048,
          },
        }),
      },
      12000,
    );

    log("gemini_response_received", {
      status: upstream.status,
      ok: upstream.ok,
    });
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");

    logError(timedOut ? "gemini_timeout" : "gemini_network_error", error);

    return fail(
      req,
      timedOut ? 504 : 502,
      timedOut ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR",
      timedOut
        ? "انتهت مهلة Gemini بعد 12 ثانية. حاول مرة أخرى."
        : "تعذر الاتصال بخدمة Gemini.",
    );
  }

  if (!upstream.ok) {
    const upstreamStatus = upstream.status;
    const errorBody = await upstream.text().catch(() => "");

    log("gemini_upstream_error", {
      status: upstreamStatus,
      model: MODEL,
      errorBodyPreview: errorBody.slice(0, 300),
    });

    if (upstreamStatus === 429) {
      return fail(
        req,
        503,
        "GEMINI_RATE_LIMITED",
        "وصلت خدمة Gemini إلى حد الاستخدام المؤقت. حاول لاحقاً.",
      );
    }

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return fail(
        req,
        502,
        "GEMINI_API_KEY_REJECTED",
        "رفضت Gemini المفتاح أو صلاحية الوصول. تحقق من إعدادات المفتاح.",
      );
    }

    if (upstreamStatus === 404) {
      return fail(
        req,
        502,
        "GEMINI_MODEL_NOT_FOUND",
        "لم يتم العثور على النموذج المحدد. تحقق من GEMINI_MODEL.",
      );
    }

    return fail(
      req,
      502,
      "GEMINI_UPSTREAM_ERROR",
      "تعذر على Gemini معالجة الطلب. راجع سجلات الدالة.",
    );
  }

  let result: {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  try {
    result = await upstream.json();
  } catch (error) {
    logError("gemini_json_parse_failed", error);
    return fail(
      req,
      502,
      "INVALID_GEMINI_RESPONSE",
      "أعاد Gemini استجابة غير قابلة للقراءة.",
    );
  }

  if (result.promptFeedback?.blockReason) {
    log("gemini_prompt_blocked", {
      reason: result.promptFeedback.blockReason,
    });

    return fail(
      req,
      422,
      "PROMPT_BLOCKED",
      "لم تتم معالجة الطلب بسبب قواعد السلامة. جرّب صياغة أخرى.",
    );
  }

  const candidate = result.candidates?.[0];

  const reply = (candidate?.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();

  if (!reply) {
    log("gemini_empty_response", {
      finishReason: candidate?.finishReason ?? null,
      candidateCount: result.candidates?.length ?? 0,
    });

    return fail(
      req,
      502,
      "EMPTY_MODEL_RESPONSE",
      "لم تُرجع Gemini نصاً. أعد المحاولة وراجع سجلات الدالة إذا تكررت المشكلة.",
    );
  }

  log("request_succeeded", {
    model: MODEL,
    responseLength: reply.length,
  });

  return json(req, {
    ok: true,
    data: {
      text: reply,
      model: MODEL,
      finishReason: candidate?.finishReason ?? null,
    },
  });
});
