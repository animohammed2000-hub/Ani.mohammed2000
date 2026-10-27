/**
 * Pure decision rules for submitting a post report.
 *
 * The live `reports` table has drifted from the migrated one: production only
 * exposes `(post_id, user_id, reason)` while the migration adds
 * `reporter_id`, `reported_user_id` and `status`. A single insert shape can
 * therefore never satisfy both, so the client tries the migrated shape first
 * and falls back to the legacy one only when PostgREST reports that a column is
 * missing.
 *
 * Keeping this logic pure (no Supabase client, no React, no storage) makes the
 * fallback path directly testable — it previously lived inline in a component
 * and had never been exercised.
 */

/** Columns used by the migrated schema (migration 20261027000000). */
export type ReportPayload = {
  post_id: string;
  reported_user_id: string;
  reporter_id: string;
  reason: string;
  status: 'pending';
};

/** Columns used by the legacy production schema. */
export type LegacyReportPayload = {
  post_id: string;
  user_id: string;
  reason: string;
};

export type ReportErrorLike = { code?: string; message?: string; details?: string } | null;

export type ReportFailureKind =
  /** The reporter already reported this post. */
  | 'duplicate'
  /** The `reports` table itself is missing. */
  | 'table_missing'
  /** Row-level security or grants blocked the insert. */
  | 'forbidden'
  /** Anything else. */
  | 'unknown';

/** The shape to attempt first, on a migrated database. */
export function buildReportPayload(input: {
  postId: string;
  postAuthorId: string;
  currentUserId: string;
  reason: string;
}): ReportPayload {
  return {
    post_id: input.postId,
    reported_user_id: input.postAuthorId,
    reporter_id: input.currentUserId,
    reason: input.reason,
    status: 'pending',
  };
}

/** The shape to fall back to on the un-migrated production table. */
export function buildLegacyReportPayload(input: {
  postId: string;
  currentUserId: string;
  reason: string;
}): LegacyReportPayload {
  return {
    post_id: input.postId,
    user_id: input.currentUserId,
    reason: input.reason,
  };
}

function errorCode(error: ReportErrorLike): string {
  return error?.code ?? '';
}

function errorText(error: ReportErrorLike): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`.trim();
}

/**
 * True only when the insert failed *because a column in the new shape does not
 * exist*. Anything else (auth, RLS, network) must not trigger a second insert,
 * otherwise a successful-looking retry could hide a real permission failure.
 */
export function shouldRetryWithLegacyShape(error: ReportErrorLike): boolean {
  if (!error) return false;
  const code = errorCode(error);
  if (code === 'PGRST204' || code === '42703') return true;
  return /could not find the .*column|column .* does not exist/i.test(errorText(error));
}

/** Classifies a final failure so the UI can show an actionable message. */
export function classifyReportFailure(error: ReportErrorLike): ReportFailureKind {
  const code = errorCode(error);
  if (code === '23505') return 'duplicate';
  if (code === '42P01' || code === 'PGRST205') return 'table_missing';
  if (code === '42501' || code === 'PGRST301') return 'forbidden';

  const text = errorText(error);
  if (/duplicate key|already exists/i.test(text)) return 'duplicate';
  if (/could not find the table|relation .* does not exist/i.test(text)) return 'table_missing';
  if (/row-level security|permission denied/i.test(text)) return 'forbidden';
  return 'unknown';
}

/** Arabic user-facing message for a classified failure. */
export function reportFailureMessage(kind: ReportFailureKind): string {
  switch (kind) {
    case 'duplicate':
      return 'سبق أن أبلغت عن هذا المنشور.';
    case 'table_missing':
      return 'لم يتم تجهيز جدول البلاغات بعد في قاعدة البيانات. طبّق ملف الترحيل supabase/migrations لتفعيل الإبلاغ.';
    case 'forbidden':
      return 'تعذر تسجيل البلاغ: صلاحيات الجدول تمنع الإرسال. راجع سياسات RLS في supabase/migrations.';
    default:
      return 'تعذر إرسال البلاغ، حاول مرة أخرى.';
  }
}
