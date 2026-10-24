type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ResponseMode = "text" | "reply";

type ValidatedMessages =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; status: number; code: string; message: string };

type TimedResponse = {
  response: Response;
  body: string;
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 16_000;
const AUTH_TIMEOUT_MS = 8000;
const GEMINI_TIMEOUT_MS = 20_000;

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

class RequestTimeoutError extends Error {
  constructor() {
    super("request_timeout");
    this.name = "RequestTimeoutError";
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
    this.name = "RequestBodyTooLargeError";
  }
}

function getRequestId(req: Request): string {
  const candidate = req.headers.get("x-request-id")?.trim() ?? "";
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(candidate) ? candidate : crypto.randomUUID();
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins.has(origin.replace(/\/+$/, ""));
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "x-request-id",
    "Vary": "Origin",
  });
  const origin = req.headers.get("origin");
  if (origin && isOriginAllowed(req)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(
  req: Request,
  requestId: string,
  body: unknown,
  status = 200,
): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

function fail(
  req: Request,
  requestId: string,
  status: number,
  code: string,
  message: string,
): Response {
  return json(req, requestId, {
    error: { code, message },
    requestId,
  }, status);
}

function logEvent(
  requestId: string,
  startedAt: number,
  stage: string,
  details: Record<string, string | number | boolean | null> = {},
): void {
  console.log(JSON.stringify({
    requestId,
    stage,
    elapsedMs: Date.now() - startedAt,
    ...details,
  }));
}

function logFailure(
  requestId: string,
  startedAt: number,
  stage: string,
  error: unknown,
): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(JSON.stringify({
    requestId,
    stage,
    elapsedMs: Date.now() - startedAt,
    errorType: name,
  }));
}

async function fetchTextWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<TimedResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.text();
    return { response, body };
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readRequestBodyLimited(req: Request): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request may already have been cancelled by the runtime.
        }
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function getSupabasePublicKey(): string | null {
  const direct =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (direct) return direct;

  const keyMap = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!keyMap) return null;

  try {
    const parsed = JSON.parse(keyMap) as Record<string, unknown>;
    if (typeof parsed.default === "string") return parsed.default;
    return Object.values(parsed).find(
      (value): value is string => typeof value === "string",
    ) ?? null;
  } catch {
    return null;
  }
}

async function verifyUserSession(
  req: Request,
): Promise<"valid" | "invalid" | "unavailable"> {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return "invalid";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const publicKey = getSupabasePublicKey();
  if (!supabaseUrl || !publicKey) return "unavailable";

  try {
    const { response, body } = await fetchTextWithTimeout(
      `${supabaseUrl}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${bearer}`,
        },
      },
      AUTH_TIMEOUT_MS,
    );

    if (response.status === 401 || response.status === 403) return "invalid";
    if (!response.ok) return "unavailable";

    const user = JSON.parse(body) as { id?: unknown };
    return typeof user.id === "string" && user.id.length > 0
      ? "valid"
      : "invalid";
  } catch {
    return "unavailable";
  }
}

function validateMessageList(input: unknown[]): ValidatedMessages {
  if (input.length < 1 || input.length > MAX_MESSAGES) {
    return {
      ok: false,
      status: 413,
      code: "INVALID_MESSAGE_COUNT",
      message: "عدد الرسائل في سياق المحادثة خارج الحد المسموح.",
    };
  }

  const messages: ChatMessage[] = [];
  let totalChars = 0;

  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_MESSAGE",
        message: "صيغة إحدى رسائل المحادثة غير صالحة.",
      };
    }

    const candidate = entry as Record<string, unknown>;
    if (
      (candidate.role !== "user" && candidate.role !== "assistant") ||
      typeof candidate.content !== "string"
    ) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_MESSAGE",
        message: "يجب أن تحتوي كل رسالة على دور ونص صالحين.",
      };
    }

    const content = candidate.content.trim();
    if (!content) {
      return {
        ok: false,
        status: 400,
        code: "EMPTY_MESSAGE",
        message: "لا يمكن إرسال رسالة فارغة.",
      };
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        status: 413,
        code: "MESSAGE_TOO_LONG",
        message: "تجاوزت إحدى الرسائل الحد المسموح وهو 4,000 حرف.",
      };
    }

    totalChars += content.length;
    messages.push({
      role: candidate.role,
      content,
    });
  }

  if (messages[messages.length - 1]?.role !== "user") {
    return {
      ok: false,
      status: 400,
      code: "LAST_MESSAGE_MUST_BE_USER",
      message: "يجب أن تكون الرسالة الأخيرة رسالة من المستخدم.",
    };
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      status: 413,
      code: "CONVERSATION_TOO_LONG",
      message: "تجاوز سياق المحادثة الحد المسموح.",
    };
  }

  return { ok: true, messages };
}

function parseMessages(payload: Record<string, unknown>): ValidatedMessages {
  if (Array.isArray(payload.messages)) {
    return validateMessageList(payload.messages);
  }

  // Compatibility with the earlier AIAssistantModal request shape.
  if (typeof payload.message !== "string") {
    return {
      ok: false,
      status: 400,
      code: "MESSAGES_REQUIRED",
      message: "أرسل قائمة messages أو رسالة صالحة.",
    };
  }

  const message = payload.message.trim();
  if (!message) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_MESSAGE",
      message: "لا يمكن إرسال رسالة فارغة.",
    };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      status: 413,
      code: "MESSAGE_TOO_LONG",
      message: "تجاوزت الرسالة الحد المسموح وهو 4,000 حرف.",
    };
  }

  const history = payload.history ?? [];
  if (!Array.isArray(history) || history.length > MAX_MESSAGES - 1) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_HISTORY",
      message: "سجل المحادثة المرسل غير صالح.",
    };
  }

  return validateMessageList([
    ...history,
    { role: "user", content: message },
  ]);
}

function publicErrorForGeminiStatus(status: number): {
  status: number;
  code: string;
  message: string;
} {
  if (status === 429) {
    return {
      status: 503,
      code: "GEMINI_RATE_LIMITED",
      message: "وصلت خدمة Gemini إلى حد الاستخدام المؤقت. حاول لاحقاً.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      code: "GEMINI_API_KEY_REJECTED",
      message: "تعذر على Gemini قبول إعدادات الوصول. راجع أسرار Supabase.",
    };
  }
  if (status === 404) {
    return {
      status: 502,
      code: "GEMINI_MODEL_NOT_FOUND",
      message: "النموذج غير متاح لهذا المفتاح. تحقق من GEMINI_MODEL.",
    };
  }
  if (status === 400) {
    return {
      status: 422,
      code: "GEMINI_REQUEST_REJECTED",
      message: "رفضت Gemini الطلب. جرّب رسالة أقصر أو صياغة مختلفة.",
    };
  }
  return {
    status: 502,
    code: "GEMINI_UPSTREAM_ERROR",
    message: "تعذر على Gemini معالجة الطلب. حاول مرة أخرى لاحقاً.",
  };
}

export async function handleGeminiRequest(
  req: Request,
  responseMode: ResponseMode = "text",
): Promise<Response> {
  const requestId = getRequestId(req);
  const startedAt = Date.now();
  logEvent(requestId, startedAt, "request_started", { method: req.method });

  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(req)) {
      logEvent(requestId, startedAt, "cors_rejected");
      return fail(
        req,
        requestId,
        403,
        "ORIGIN_NOT_ALLOWED",
        "هذا المصدر غير مسموح. أضف عنوان التطبيق إلى ALLOWED_ORIGINS.",
      );
    }
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req),
    });
  }

  if (!isOriginAllowed(req)) {
    logEvent(requestId, startedAt, "cors_rejected");
    return fail(
      req,
      requestId,
      403,
      "ORIGIN_NOT_ALLOWED",
      "هذا المصدر غير مسموح. أضف عنوان التطبيق إلى ALLOWED_ORIGINS.",
    );
  }

  if (req.method !== "POST") {
    return fail(
      req,
      requestId,
      405,
      "METHOD_NOT_ALLOWED",
      "استخدم POST فقط.",
    );
  }

  logEvent(requestId, startedAt, "auth_check_started");
  const authState = await verifyUserSession(req);
  logEvent(requestId, startedAt, "auth_check_finished", { authState });
  if (authState === "invalid") {
    return fail(
      req,
      requestId,
      401,
      "AUTH_REQUIRED",
      "سجّل الدخول ثم أعد المحاولة.",
    );
  }
  if (authState === "unavailable") {
    return fail(
      req,
      requestId,
      503,
      "AUTH_CHECK_UNAVAILABLE",
      "تعذر التحقق من جلسة المستخدم. تحقق من اتصال Supabase.",
    );
  }

  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return fail(
      req,
      requestId,
      415,
      "JSON_REQUIRED",
      "أرسل الطلب بصيغة JSON.",
    );
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(
      req,
      requestId,
      413,
      "BODY_TOO_LARGE",
      "حجم الطلب أكبر من المسموح.",
    );
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBodyLimited(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return fail(
        req,
        requestId,
        413,
        "BODY_TOO_LARGE",
        "حجم الطلب أكبر من المسموح.",
      );
    }
    logFailure(requestId, startedAt, "request_body_read_failed", error);
    return fail(
      req,
      requestId,
      400,
      "INVALID_BODY",
      "تعذر قراءة جسم الطلب.",
    );
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid_json_object");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return fail(
      req,
      requestId,
      400,
      "INVALID_JSON",
      "جسم الطلب ليس كائن JSON صالحاً.",
    );
  }

  const validated = parseMessages(payload);
  if (!validated.ok) {
    logEvent(requestId, startedAt, "validation_rejected", {
      code: validated.code,
    });
    return fail(
      req,
      requestId,
      validated.status,
      validated.code,
      validated.message,
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    logEvent(requestId, startedAt, "gemini_not_configured");
    return fail(
      req,
      requestId,
      503,
      "GEMINI_NOT_CONFIGURED",
      "مفتاح Gemini غير مضبوط في أسرار Supabase.",
    );
  }

  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-3.8-flash";
  const totalChars = validated.messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  logEvent(requestId, startedAt, "gemini_request_started", {
    model,
    messageCount: validated.messages.length,
    totalChars,
    timeoutMs: GEMINI_TIMEOUT_MS,
  });

  let upstream: Response;
  let upstreamBody: string;
  try {
    const result = await fetchTextWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(model)
      }:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "أنت مساعد آني. أجب بلغة المستخدم، وكن واضحاً بشأن حدود معرفتك. في هذا الإصدار لا تملك أدوات للوصول إلى ملفات Replit أو قاعدة بيانات Supabase أو إدارة الحسابات. لا تدّعِ أنك قرأت ملفات أو عدّلت شيفرة أو نفّذت أوامر أو عمليات إدارية. لا تطلب مفاتيح سرية أو كلمات مرور، ولا تكرر بيانات حساسة يرسلها المستخدم.",
            }],
          },
          contents: validated.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        }),
      },
      GEMINI_TIMEOUT_MS,
    );
    upstream = result.response;
    upstreamBody = result.body;
  } catch (error) {
    const timedOut = error instanceof RequestTimeoutError;
    logFailure(
      requestId,
      startedAt,
      timedOut ? "gemini_timeout" : "gemini_network_error",
      error,
    );
    return fail(
      req,
      requestId,
      timedOut ? 504 : 502,
      timedOut ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR",
      timedOut
        ? "انتهت مهلة Gemini. أعد المحاولة بعد قليل."
        : "تعذر الاتصال بخدمة Gemini.",
    );
  }

  logEvent(requestId, startedAt, "gemini_response_received", {
    status: upstream.status,
    ok: upstream.ok,
  });

  if (!upstream.ok) {
    const safeError = publicErrorForGeminiStatus(upstream.status);
    logEvent(requestId, startedAt, "gemini_upstream_error", {
      status: upstream.status,
      code: safeError.code,
      model,
    });
    return fail(
      req,
      requestId,
      safeError.status,
      safeError.code,
      safeError.message,
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
    result = JSON.parse(upstreamBody);
  } catch (error) {
    logFailure(requestId, startedAt, "gemini_json_parse_failed", error);
    return fail(
      req,
      requestId,
      502,
      "INVALID_GEMINI_RESPONSE",
      "أعادت Gemini استجابة غير قابلة للقراءة.",
    );
  }

  if (result.promptFeedback?.blockReason) {
    logEvent(requestId, startedAt, "gemini_prompt_blocked");
    return fail(
      req,
      requestId,
      422,
      "PROMPT_BLOCKED",
      "لم تتم معالجة الطلب بسبب قواعد السلامة. جرّب صياغة أخرى.",
    );
  }

  const candidate = result.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();

  if (!text) {
    logEvent(requestId, startedAt, "gemini_empty_response", {
      finishReason: candidate?.finishReason ?? null,
    });
    return fail(
      req,
      requestId,
      502,
      "EMPTY_MODEL_RESPONSE",
      "لم تُرجع Gemini نصاً. أعد المحاولة.",
    );
  }

  logEvent(requestId, startedAt, "request_succeeded", {
    model,
    responseChars: text.length,
  });

  const finishReason = candidate?.finishReason ?? "UNKNOWN";
  const responseData = responseMode === "reply"
    ? { reply: text, model, finishReason }
    : { text, model, finishReason };

  return json(req, requestId, {
    ...responseData,
    requestId,
  });
}
