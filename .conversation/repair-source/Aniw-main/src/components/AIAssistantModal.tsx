import { useState } from “react”;
import type { CSSProperties, FormEvent } from “react”;

type Message = {
role: “user” | “assistant”;
content: string;
};

type Props = {
open: boolean;
onClose: () => void;
accessToken: string | null;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as
| string
| undefined;

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
| string
| undefined;

const REQUEST_TIMEOUT_MS = 20000;

const overlayStyle: CSSProperties = {
position: “fixed”,
inset: 0,
zIndex: 1000,
display: “grid”,
placeItems: “center”,
padding: 16,
background: “rgba(0,0,0,.55)”,
};

const panelStyle: CSSProperties = {
width: “min(100%, 560px)”,
height: “min(80vh, 700px)”,
display: “flex”,
flexDirection: “column”,
overflow: “hidden”,
borderRadius: 16,
background: “#fff”,
color: “#17202a”,
boxShadow: “0 20px 60px rgba(0,0,0,.25)”,
};

function getErrorMessage(cause: unknown): string {
if (cause instanceof Error) {
return cause.message;
}

return “حدث خطأ غير متوقع أثناء الاتصال بالمساعد.”;
}

export default function AIAssistantModal({
open,
onClose,
accessToken,
}: Props) {
const [messages, setMessages] = useState<Message[]>([]);
const [input, setInput] = useState(””);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(””);

if (!open) return null;

async function handleSubmit(event: FormEvent) {
event.preventDefault();

const text = input.trim();
if (!text || loading) return;
if (!accessToken) {
  setError(
    "انتهت جلسة الدخول أو لم تسجل الدخول. سجّل الدخول ثم أعد المحاولة.",
  );
  return;
}
if (!supabaseUrl || !supabaseAnonKey) {
  setError("إعدادات Supabase للواجهة غير مكتملة.");
  console.error("[Aani AI] Supabase configuration missing.");
  return;
}
const previousMessages = messages.slice(-10);
const nextMessages: Message[] = [
  ...messages,
  { role: "user", content: text },
].slice(-12);
setMessages(nextMessages);
setInput("");
setError("");
setLoading(true);
const controller = new AbortController();
let timedOut = false;
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const endpoint =
  `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/gemini-chat`;
console.info("[Aani AI] Request started.", {
  endpoint,
  timeoutMs: REQUEST_TIMEOUT_MS,
  historyCount: previousMessages.length,
});
try {
  const requestPromise = fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: text,
      history: previousMessages,
    }),
    signal: controller.signal,
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("AANI_REQUEST_TIMEOUT"));
    }, REQUEST_TIMEOUT_MS);
  });
  const response = await Promise.race([
    requestPromise,
    timeoutPromise,
  ]);
  console.info("[Aani AI] HTTP response received.", {
    status: response.status,
    ok: response.ok,
  });
  const responseText = await response.text();
  let result: any = null;
  if (responseText.trim()) {
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("[Aani AI] Invalid JSON response.", {
        status: response.status,
      });
      throw new Error(
        "وصل رد غير صالح من الخادم. تحقق من سجلات Supabase.",
      );
    }
  }
  if (!response.ok) {
    const serverMessage =
      typeof result?.error?.message === "string"
        ? result.error.message
        : typeof result?.error === "string"
          ? result.error
          : `فشل الطلب برمز HTTP ${response.status}.`;
    const errorCode =
      typeof result?.error?.code === "string"
        ? ` [${result.error.code}]`
        : "";
    throw new Error(`${serverMessage}${errorCode}`);
  }
  const reply = result?.data?.text;
  if (typeof reply !== "string" || !reply.trim()) {
    console.error("[Aani AI] Empty assistant response.", {
      hasData: Boolean(result?.data),
    });
    throw new Error(
      "وصل رد من الخادم، لكن نص المساعد غير موجود. تحقق من استجابة دالة gemini-chat.",
    );
  }
  setMessages((current) => [
    ...current,
    { role: "assistant", content: reply.trim() },
  ]);
  console.info("[Aani AI] Request succeeded.", {
    responseLength: reply.length,
  });
} catch (cause) {
  if (
    timedOut ||
    (cause instanceof Error &&
      cause.message === "AANI_REQUEST_TIMEOUT")
  ) {
    console.error("[Aani AI] Request timed out.");
    setError(
      "انتهت مهلة الانتظار بعد 20 ثانية دون اكتمال الاتصال. قد تكون المشكلة في الشبكة أو دالة Supabase أو خدمة Gemini. أعد المحاولة.",
    );
  } else if (
    cause instanceof Error &&
    cause.name === "AbortError"
  ) {
    setError("تم إيقاف طلب المساعد قبل اكتماله. أعد المحاولة.");
  } else {
    const message = getErrorMessage(cause);
    console.error("[Aani AI] Request failed.", {
      message,
    });
    setError(
      `تعذر الحصول على رد من المساعد: ${message}`,
    );
  }
} finally {
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  setLoading(false);
  console.info("[Aani AI] Loading finished.");
}

}

return (
<div
style={overlayStyle}
onMouseDown={(event) => {
if (event.target === event.currentTarget) onClose();
}}
>
<header
style={{
display: “flex”,
justifyContent: “space-between”,
alignItems: “center”,
padding: “14px 18px”,
borderBottom: “1px solid #e5e7eb”,
}}
>
<h2 id=“ai-assistant-title” style={{ margin: 0, fontSize: 18 }}>
مساعد آني
      <button type="button" onClick={onClose} aria-label="إغلاق">
        إغلاق
      </button>
    </header>
    <div
      aria-live="polite"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {messages.length === 0 && (
        <p style={{ color: "#667085" }}>
          اكتب سؤالك لبدء المحادثة.
        </p>
      )}
      {messages.map((message, index) => (
        <div
          key={`${message.role}-${index}`}
          style={{
            alignSelf:
              message.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
            padding: "10px 12px",
            borderRadius: 12,
            background:
              message.role === "user" ? "#dbeafe" : "#f3f4f6",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {message.content}
        </div>
      ))}
      {loading && (
        <div
          role="status"
          style={{ color: "#667085" }}
        >
          يفكر المساعد… (سيتم إنهاء الانتظار تلقائيًا)
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            color: "#b42318",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      )}
    </div>
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        gap: 8,
        padding: 12,
        borderTop: "1px solid #e5e7eb",
      }}
    >
      <textarea
        aria-label="رسالتك"
        placeholder="اكتب رسالتك…"
        rows={2}
        maxLength={4000}
        disabled={loading}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        style={{
          flex: 1,
          resize: "vertical",
          padding: 10,
          border: "1px solid #d0d5dd",
          borderRadius: 8,
          font: "inherit",
        }}
      />
      <button type="submit" disabled={loading || !input.trim()}>
        {loading ? "جارٍ الإرسال…" : "إرسال"}
      </button>
    </form>
  </section>
</div>

);
}