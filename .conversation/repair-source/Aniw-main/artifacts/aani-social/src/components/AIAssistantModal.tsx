import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, LoaderCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { id: string; role: ChatRole; content: string; error?: boolean; retryFor?: string };
type ApiMessage = { role: ChatRole; content: string };
type AssistantError = Error & { kind?: 'timeout' | 'network' | 'auth' | 'response' };
type AssistantResponse = { text: string; model: string; finishReason: string; requestId: string };

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CONVERSATION_CHARS = 16000;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ABORTED_MESSAGE = 'تم إيقاف انتظار الرد. يمكنك إعادة المحاولة؛ إغلاق النافذة لا يضمن إلغاء المعالجة على الخادم.';

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeContext(messages: ApiMessage[]): ApiMessage[] {
  const normalized = messages.map(message => ({
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
  }));
  while (normalized.length > MAX_MESSAGES) normalized.shift();
  while (
    normalized.length > 1 &&
    normalized.reduce((total, message) => total + message.content.length, 0) > MAX_CONVERSATION_CHARS
  ) normalized.shift();
  return normalized;
}

function localizedError(error: unknown): string {
  const assistantError = error as AssistantError;
  if (assistantError.kind === 'timeout') return 'استغرق الرد وقتًا أطول من المتوقع. تحقّق من اتصالك ثم أعد المحاولة.';
  if (assistantError.kind === 'network') return 'تعذّر الاتصال بالمساعد. تحقّق من اتصال الإنترنت ثم أعد المحاولة.';
  if (assistantError.kind === 'auth') return 'انتهت جلسة تسجيل الدخول. سجّل الدخول من جديد ثم أعد المحاولة.';
  if (assistantError.kind === 'response') return 'وصل رد غير صالح من المساعد. أعد المحاولة بعد لحظة.';

  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'سجّل الدخول ثم أعد المحاولة.',
    AUTH_CHECK_UNAVAILABLE: 'تعذّر التحقق من جلسة الدخول. حاول مجددًا بعد لحظة.',
    ORIGIN_NOT_ALLOWED: 'تعذّر التحقق من مصدر الطلب. أعد تحميل الصفحة ثم أعد المحاولة.',
    MESSAGE_TOO_LONG: 'تجاوزت المحادثة الحد المسموح. ابدأ محادثة جديدة لاحقًا.',
    CONVERSATION_TOO_LONG: 'سياق المحادثة طويل جدًا. ابدأ محادثة جديدة ثم أعد المحاولة.',
    INVALID_MESSAGE_COUNT: 'سياق المحادثة طويل جدًا. ابدأ محادثة جديدة ثم أعد المحاولة.',
    GEMINI_TIMEOUT: 'تأخر رد المساعد. أعد المحاولة بعد لحظة.',
    GEMINI_NETWORK_ERROR: 'تعذّر الوصول إلى خدمة المساعد. أعد المحاولة لاحقًا.',
    GEMINI_RATE_LIMITED: 'الطلبات كثيرة الآن. انتظر قليلًا ثم أعد المحاولة.',
    GEMINI_MODEL_NOT_FOUND: 'المساعد غير متاح مؤقتًا. أعد المحاولة لاحقًا.',
    GEMINI_API_KEY_REJECTED: 'إعداد الوصول إلى المساعد غير صالح. تواصل مع مسؤول التطبيق.',
    GEMINI_NOT_CONFIGURED: 'المساعد غير مهيأ بعد. تواصل مع مسؤول التطبيق.',
    GEMINI_REQUEST_REJECTED: 'تعذر معالجة هذه الرسالة. جرّب صياغة مختلفة.',
    EMPTY_MODEL_RESPONSE: 'لم يصل رد من المساعد. أعد المحاولة.',
    PROMPT_BLOCKED: 'تعذرت معالجة الرسالة. جرّب صياغة أخرى.',
  };
  if (code && messages[code]) return messages[code];
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return 'تعذّر التحقق من جلسة الدخول. سجّل الدخول من جديد ثم أعد المحاولة.';
  if (status === 429) return 'الطلبات كثيرة الآن. انتظر قليلًا ثم أعد المحاولة.';
  return 'حدث خطأ غير متوقع أثناء إرسال رسالتك. أعد المحاولة.';
}

async function readError(response: Response): Promise<AssistantError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The response body may be empty or not JSON; use the HTTP status below.
  }
  const payload = body as { error?: { code?: string; message?: string } | string } | null;
  const detail = payload?.error;
  const error = new Error(typeof detail === 'object' ? detail?.message || 'Request failed' : typeof detail === 'string' ? detail : 'Request failed') as AssistantError;
  if (typeof detail === 'object' && detail?.code) Object.assign(error, { code: detail.code });
  Object.assign(error, { status: response.status });
  return error;
}

async function requestAssistant(messages: ApiMessage[], signal: AbortSignal): Promise<AssistantResponse> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (sessionError || !data.session?.access_token) {
    const error = new Error('Authentication required') as AssistantError;
    error.kind = 'auth';
    throw error;
  }

  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
  const publicKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY
  ) as string | undefined;
  if (!baseUrl || !publicKey) {
    const error = new Error('Assistant configuration unavailable') as AssistantError;
    error.kind = 'network';
    throw error;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/gemini-chat`, {
      method: 'POST',
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
        'x-request-id': createId(),
      },
      body: JSON.stringify({ messages: normalizeContext(messages) }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const networkError = new Error('Network request failed') as AssistantError;
    networkError.kind = 'network';
    throw networkError;
  }

  if (!response.ok) throw await readError(response);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('Invalid JSON response') as AssistantError;
    error.kind = 'response';
    throw error;
  }
  const result = payload as Partial<AssistantResponse> | null;
  if (
    !result ||
    typeof result.text !== 'string' ||
    !result.text.trim() ||
    typeof result.model !== 'string' ||
    typeof result.finishReason !== 'string' ||
    typeof result.requestId !== 'string'
  ) {
    const error = new Error('Invalid assistant response') as AssistantError;
    error.kind = 'response';
    throw error;
  }
  return result as AssistantResponse;
}

export default function AIAssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestLockRef = useRef(false);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  const timeoutRef = useRef(false);

  openRef.current = open;

  const abortActiveRequest = () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  };
  const handleClose = () => {
    abortActiveRequest();
    onClose();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRef.current = false;
      abortActiveRequest();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      abortActiveRequest();
      return;
    }
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const submitMessage = async (content: string, existingUserId?: string) => {
    const cleanContent = content.trim();
    if (!cleanContent || requestLockRef.current || !openRef.current) return;
    if (cleanContent.length > MAX_MESSAGE_CHARS) {
      setStatusText('الحد الأقصى للرسالة ٤٬٠٠٠ حرف.');
      return;
    }

    requestLockRef.current = true;
    setLoading(true);
    setStatusText('');
    const userId = existingUserId ?? createId();
    const userMessage: ChatMessage = { id: userId, role: 'user', content: cleanContent };
    if (!existingUserId) setMessages(current => [...current, userMessage]);

    const currentMessages = messages;
    const failedIndex = existingUserId ? currentMessages.findIndex(message => message.id === existingUserId) : -1;
    const priorMessages = existingUserId
      ? currentMessages.slice(0, failedIndex).filter(message => !message.error)
      : currentMessages.filter(message => !message.error);
    const context = [
      ...priorMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
      { role: 'user' as const, content: cleanContent },
    ];

    const controller = new AbortController();
    activeControllerRef.current = controller;
    timeoutRef.current = false;
    const timer = window.setTimeout(() => {
      timeoutRef.current = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const result = await requestAssistant(context, controller.signal);
      if (!mountedRef.current || !openRef.current || controller.signal.aborted) return;
      setMessages(current => [
        ...current.filter(message => !(message.error && message.retryFor === userId)),
        { id: createId(), role: 'assistant', content: result.text.trim() },
      ]);
    } catch (error) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted && !timeoutRef.current) {
        setMessages(current => [
          ...current.filter(message => !(message.error && message.retryFor === userId)),
          { id: createId(), role: 'assistant', content: REQUEST_ABORTED_MESSAGE, error: true, retryFor: userId },
        ]);
        if (openRef.current) setStatusText(REQUEST_ABORTED_MESSAGE);
        return;
      }
      if (!openRef.current) return;
      const reason = timeoutRef.current
        ? Object.assign(new Error('Timed out'), { kind: 'timeout' as const })
        : error;
      setMessages(current => [
        ...current.filter(message => !(message.error && message.retryFor === userId)),
        { id: createId(), role: 'assistant', content: localizedError(reason), error: true, retryFor: userId },
      ]);
    } finally {
      window.clearTimeout(timer);
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      requestLockRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading || messages.some(message => message.error && message.retryFor)) return;
    setInput('');
    void submitMessage(text);
  };

  const handleRetry = (messageId: string) => {
    const failed = messages.find(message => message.id === messageId);
    if (!failed || failed.role !== 'user' || loading) return;
    setStatusText('');
    void submitMessage(failed.content, failed.id);
  };

  if (!open) return null;
  const hasFailedMessage = messages.some(message => message.error && message.retryFor);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) handleClose(); }}
      data-testid="assistant-overlay"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        dir="rtl"
        className="fade-up flex h-[min(680px,92dvh)] w-full max-w-xl flex-col overflow-hidden rounded-t-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-2xl sm:rounded-[24px]"
        data-testid="assistant-dialog"
      >
        <header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]">
              <Sparkles size={19} aria-hidden="true" />
            </span>
            <div>
              <h2 id="assistant-title" className="text-sm font-bold">مساعد آني</h2>
              <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">محادثة ذكية، خطوة بخطوة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق المساعد"
            data-testid="button-close-assistant"
            className="grid h-9 w-9 place-items-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" data-testid="assistant-message-list">
          {messages.length === 0 && (
            <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-[20px] rounded-bl-[6px] bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]">
                <Bot size={27} aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold">مرحبًا، أنا مساعد آني.</p>
              <p className="mt-2 max-w-xs text-xs leading-6 text-[hsl(var(--muted-foreground))]">اسأل عن فكرة أو موضوع، وسأساعدك في صياغة إجابة واضحة.</p>
            </div>
          )}
          {messages.map(message => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-start' : 'justify-end'}`} data-testid={`assistant-message-${message.id}`}>
              <div className={`max-w-[88%] ${message.role === 'user'
                ? 'rounded-2xl rounded-tr-md bg-[hsl(var(--primary))] px-4 py-3 text-[hsl(var(--primary-foreground))]'
                : message.error
                  ? 'w-full rounded-2xl rounded-tl-md border border-[hsl(var(--destructive)/.24)] bg-[hsl(var(--destructive)/.07)] px-4 py-3 text-[hsl(var(--destructive))]'
                  : 'rounded-2xl rounded-tl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-[hsl(var(--foreground))]'
              }`}>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-7">{message.content}</p>
                {message.error && message.retryFor && (
                  <button
                    type="button"
                    onClick={() => handleRetry(message.retryFor!)}
                    disabled={loading}
                    data-testid={`button-retry-assistant-${message.retryFor}`}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-[11px] font-semibold transition hover:bg-black/5 disabled:opacity-50"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    إعادة إرسال الرسالة
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-end" role="status" data-testid="assistant-loading">
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                <LoaderCircle size={15} className="animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
                يكتب المساعد…
              </div>
            </div>
          )}
          <div ref={endOfMessagesRef} />
        </div>

        <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 sm:px-5">
          <p className="mb-2 text-[10px] leading-5 text-[hsl(var(--muted-foreground))]" data-testid="assistant-capability-note">
            هذا المساعد للمحادثة فقط، ولا يغيّر الشيفرة أو يدير الحسابات. إغلاق النافذة يوقف انتظارك، ولا يضمن إلغاء المعالجة على الخادم.
          </p>
          {statusText && <p className="mb-2 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]" role="status" data-testid="assistant-status">{statusText}</p>}
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="اكتب رسالتك هنا..."
              aria-label="رسالتك للمساعد"
              maxLength={MAX_MESSAGE_CHARS}
              rows={1}
              disabled={loading || hasFailedMessage}
              data-testid="input-assistant-message"
              className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3.5 py-3 text-xs leading-5 outline-none transition placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary)/.6)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || hasFailedMessage || !input.trim()}
              aria-label="إرسال الرسالة"
              data-testid="button-send-assistant"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[9px] text-[hsl(var(--muted-foreground))]">
            <span>Enter للإرسال · Shift+Enter لسطر جديد</span>
            <span>{input.length.toLocaleString('ar')} / ٤٬٠٠٠</span>
          </div>
        </div>
      </section>
    </div>
  );
}
