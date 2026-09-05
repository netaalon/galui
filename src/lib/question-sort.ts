/** Shared between the questions page (server) and its sort control (client). */

export const QUESTION_SORTS = ["recent", "latest-reply", "overdue", "ministry", "asker"] as const;
export type QuestionSort = (typeof QUESTION_SORTS)[number];

export const QUESTION_SORT_LABELS: Record<QuestionSort, string> = {
  recent: "הוגשה לאחרונה",
  "latest-reply": "נענתה לאחרונה",
  overdue: "האיחור הגדול ביותר",
  ministry: "משרד",
  asker: "שם השואל/ת",
};

export const QUESTION_FILTERS = ["all", "answered", "pending", "late"] as const;
export type QuestionFilter = (typeof QUESTION_FILTERS)[number];

export const QUESTION_FILTER_LABELS: Record<QuestionFilter, string> = {
  all: "הכול",
  answered: "נענו",
  pending: "ממתינות לתשובה",
  late: "נענו באיחור",
};

export function parseQuestionSort(v: string | undefined): QuestionSort {
  return (QUESTION_SORTS as readonly string[]).includes(v ?? "") ? (v as QuestionSort) : "recent";
}
export function parseQuestionFilter(v: string | undefined): QuestionFilter {
  return (QUESTION_FILTERS as readonly string[]).includes(v ?? "") ? (v as QuestionFilter) : "all";
}

/**
 * Days a question is overdue.
 *
 * Answered questions carry a frozen `replyDaysLate`. Unanswered ones are
 * measured against today, so their lateness grows until a minister replies —
 * which is the point of showing it.
 */
export function overdueDays(
  q: { replyDaysLate: number | null; replyMinisterDate: Date | null; replyDatePlanned: Date | null },
  now = new Date(),
): number | null {
  if (q.replyMinisterDate) return q.replyDaysLate;
  if (!q.replyDatePlanned) return null;
  return Math.round((now.getTime() - q.replyDatePlanned.getTime()) / 86_400_000);
}
