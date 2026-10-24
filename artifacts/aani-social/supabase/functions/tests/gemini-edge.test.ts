import assert from "node:assert/strict";
import { after, test } from "node:test";

const environment = new Map<string, string>([
  ["SUPABASE_URL", "https://supabase.test"],
  ["SUPABASE_PUBLISHABLE_KEY", "test-public-key"],
  ["GEMINI_API_KEY", "test-gemini-key"],
  ["GEMINI_MODEL", "test-model"],
  ["ALLOWED_ORIGINS", "https://aani.test"],
]);

Object.defineProperty(globalThis, "Deno", {
  configurable: true,
  value: { env: { get: (name: string) => environment.get(name) } },
});

const originalFetch = globalThis.fetch;
const { handleGeminiRequest } = await import("../_shared/gemini.ts");

after(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "Deno");
});

function makeRequest(
  payload: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://supabase.test/functions/v1/gemini-chat", {
    method: "POST",
    headers: {
      authorization: "Bearer test-user-token",
      "content-type": "application/json",
      origin: "https://aani.test",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function installFetchMock(
  options: { authStatus?: number; geminiStatus?: number } = {},
) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user")) {
      return new Response(
        options.authStatus === 401
          ? JSON.stringify({ message: "invalid token" })
          : JSON.stringify({ id: "user-test-id" }),
        {
          status: options.authStatus ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: "أهلاً بك." }] },
        }],
      }),
      {
        status: options.geminiStatus ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;
  return calls;
}

test("rejects requests from origins not on the allowlist", async () => {
  const calls = installFetchMock();
  const response = await handleGeminiRequest(
    makeRequest(
      { messages: [{ role: "user", content: "مرحبا" }] },
      { origin: "https://untrusted.test" },
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(calls.length, 0);
});

test("requires a signed-in user before parsing the chat", async () => {
  const calls = installFetchMock();
  const request = new Request(
    "https://supabase.test/functions/v1/gemini-chat",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://aani.test",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "مرحبا" }] }),
    },
  );
  const response = await handleGeminiRequest(request);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "AUTH_REQUIRED");
  assert.equal(calls.length, 0);
});

test("rejects an invalid session without calling Gemini", async () => {
  const calls = installFetchMock({ authStatus: 401 });
  const response = await handleGeminiRequest(
    makeRequest({ messages: [{ role: "user", content: "مرحبا" }] }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "AUTH_REQUIRED");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/auth\/v1\/user$/);
});

test("rejects malformed message history after authentication", async () => {
  const calls = installFetchMock();
  const response = await handleGeminiRequest(
    makeRequest({
      messages: [
        { role: "user", content: "مرحبا" },
        { role: "assistant", content: "أهلاً" },
      ],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "LAST_MESSAGE_MUST_BE_USER");
  assert.equal(calls.length, 1);
});

test("returns the text response shape expected by the app", async () => {
  const calls = installFetchMock();
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  const response = await handleGeminiRequest(
    makeRequest(
      { messages: [{ role: "user", content: "مرحبا" }] },
      { "x-request-id": requestId },
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    text: "أهلاً بك.",
    model: "test-model",
    finishReason: "STOP",
    requestId,
  });
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(calls, [
    "https://supabase.test/auth/v1/user",
    "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
  ]);
});

test("reports missing Gemini configuration without making an upstream request", async () => {
  const calls = installFetchMock();
  environment.delete("GEMINI_API_KEY");
  try {
    const response = await handleGeminiRequest(
      makeRequest({ messages: [{ role: "user", content: "مرحبا" }] }),
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "GEMINI_NOT_CONFIGURED");
    assert.equal(calls.length, 1);
  } finally {
    environment.set("GEMINI_API_KEY", "test-gemini-key");
  }
});
