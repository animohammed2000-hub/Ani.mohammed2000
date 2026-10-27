import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLegacyReportPayload,
  buildReportPayload,
  classifyReportFailure,
  reportFailureMessage,
  shouldRetryWithLegacyShape,
} from "../reportSubmit.ts";

const input = {
  postId: "post-1",
  postAuthorId: "author-1",
  currentUserId: "reporter-1",
  reason: "محتوى غير مناسب",
};

/* ------------------------------------------------------------------ */
/* Payload shapes                                                      */
/* ------------------------------------------------------------------ */

test("builds the migrated payload with reporter_id and status", () => {
  assert.deepEqual(buildReportPayload(input), {
    post_id: "post-1",
    reported_user_id: "author-1",
    reporter_id: "reporter-1",
    reason: "محتوى غير مناسب",
    status: "pending",
  });
});

test("builds the legacy payload with user_id and no extra columns", () => {
  const legacy = buildLegacyReportPayload(input);

  assert.deepEqual(legacy, {
    post_id: "post-1",
    user_id: "reporter-1",
    reason: "محتوى غير مناسب",
  });
  // The live table has no reporter_id column, so sending one would fail again.
  assert.equal("reporter_id" in legacy, false);
  assert.equal("status" in legacy, false);
});

/* ------------------------------------------------------------------ */
/* Retry predicate — the core of the fix                               */
/* ------------------------------------------------------------------ */

test("retries with the legacy shape when PostgREST reports a missing column", () => {
  assert.equal(shouldRetryWithLegacyShape({ code: "PGRST204" }), true);
  assert.equal(shouldRetryWithLegacyShape({ code: "42703" }), true);
});

test("retries when only the message (not the code) identifies a missing column", () => {
  assert.equal(
    shouldRetryWithLegacyShape({
      message:
        "Could not find the 'reporter_id' column of 'reports' in the schema cache",
    }),
    true,
  );
  assert.equal(
    shouldRetryWithLegacyShape({ message: 'column "status" does not exist' }),
    true,
  );
});

test("does not retry on success", () => {
  assert.equal(shouldRetryWithLegacyShape(null), false);
});

test("does not retry on errors a second insert cannot fix", () => {
  // A retry here would mask a real permission failure as a success.
  assert.equal(shouldRetryWithLegacyShape({ code: "42501" }), false);
  assert.equal(
    shouldRetryWithLegacyShape({ message: "new row violates row-level security policy" }),
    false,
  );
  assert.equal(shouldRetryWithLegacyShape({ code: "23505" }), false);
  assert.equal(shouldRetryWithLegacyShape({ code: "42P01" }), false);
  assert.equal(
    shouldRetryWithLegacyShape({ message: "TypeError: Failed to fetch" }),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* Failure classification and messaging                                */
/* ------------------------------------------------------------------ */

test("classifies duplicate reports by code and by message", () => {
  assert.equal(classifyReportFailure({ code: "23505" }), "duplicate");
  assert.equal(
    classifyReportFailure({ message: "duplicate key value violates unique constraint" }),
    "duplicate",
  );
});

test("classifies a missing reports table", () => {
  assert.equal(classifyReportFailure({ code: "42P01" }), "table_missing");
  assert.equal(classifyReportFailure({ code: "PGRST205" }), "table_missing");
  assert.equal(
    classifyReportFailure({
      message: "Could not find the table 'public.reports' in the schema cache",
    }),
    "table_missing",
  );
});

test("classifies RLS and grant failures as forbidden", () => {
  assert.equal(classifyReportFailure({ code: "42501" }), "forbidden");
  assert.equal(classifyReportFailure({ code: "PGRST301" }), "forbidden");
  assert.equal(
    classifyReportFailure({ message: "new row violates row-level security policy" }),
    "forbidden",
  );
});

test("falls back to unknown for unrecognised or absent errors", () => {
  assert.equal(classifyReportFailure({ code: "XX000" }), "unknown");
  assert.equal(classifyReportFailure(null), "unknown");
  assert.equal(classifyReportFailure({}), "unknown");
});

test("every failure kind has a distinct, non-empty Arabic message", () => {
  const kinds = ["duplicate", "table_missing", "forbidden", "unknown"] as const;
  const messages = kinds.map((kind) => reportFailureMessage(kind));

  assert.equal(
    messages.every((message) => message.length > 0),
    true,
  );
  assert.equal(new Set(messages).size, kinds.length);
  // The table_missing message must point the owner at the migration file.
  assert.match(reportFailureMessage("table_missing"), /supabase\/migrations/);
});
