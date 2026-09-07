/**
 * The stages a bill passes through, and which status ids mark each one.
 *
 * The feed has an `OrderTransition` column on `KNS_Status` that looks like it
 * would supply this ordering. It is null on all 81 rows, so the ladder is
 * hand-ordered from the 35 bill statuses.
 *
 * Kept out of `queries.ts` so the client chart can import the labels without
 * pulling Prisma — the same reason the sort constants live on their own.
 */
export const FUNNEL_STAGES = [
  "הונחה על שולחן הכנסת",
  "דיון מוקדם",
  "ועדה לקראת קריאה ראשונה",
  "קריאה ראשונה",
  "ועדה לקראת שנייה-שלישית",
  "קריאה שנייה-שלישית",
  "התקבלה",
] as const;

/**
 * Status id → rung. A bill's rung is the **highest** it ever reached, and the
 * funnel counts bills that got at least that far.
 *
 * Taking the maximum rather than requiring a record at every stage matters: a
 * bill can appear at first reading with no committee-assignment row of its own,
 * and counting stages literally made government bills *rise* through the ladder
 * — 60 at the committee stage against 410 at first reading.
 */
export const STATUS_RUNG: Record<number, number> = {
  104: 0, // הונחה על שולחן הכנסת לדיון מוקדם
  150: 1, // במליאה לדיון מוקדם
  106: 2, 142: 2, 101: 2, 108: 2, 109: 2, 167: 2, // committee, before first reading
  141: 3, 111: 3, // tabled for / debated at first reading
  113: 4, 178: 4, 179: 4, // committee, before second-third
  130: 5, 114: 5, 131: 5, 117: 5, // tabled for / debated at second-third
  118: 6, // התקבלה בקריאה שלישית
};

/**
 * The government ladder, which is not the private one with the first rungs
 * removed — the order differs. A private bill goes to committee *before* first
 * reading; a government bill goes after it, and never has a preliminary
 * reading at all. Plotting one on the other's axis credits it with stages it
 * never passed.
 *
 * Private bills that reach first reading are plotted on this ladder too, since
 * they do traverse exactly these stages, and the comparison is the point.
 */
export const GOV_STAGES = [
  "הונחה לקריאה ראשונה",
  "קריאה ראשונה",
  "ועדה לקראת שנייה-שלישית",
  "הונחה לקריאה שנייה-שלישית",
  "קריאה שנייה-שלישית",
  "התקבלה",
] as const;

export const GOV_STATUS_RUNG: Record<number, number> = {
  141: 0,
  111: 1,
  113: 2, 178: 2, 179: 2,
  130: 3, 131: 3,
  114: 4, 117: 4,
  118: 5,
};

export type FunnelView = "total" | "bloc" | "faction" | "origin";

export function parseFunnelView(v: string | undefined): FunnelView {
  return v === "bloc" || v === "faction" || v === "origin" ? v : "total";
}

/**
 * The count view uses a square-root y axis, not log.
 *
 * Linear flattens the tail — the first rung is 33x the last. Log overcorrects:
 * it places 30 at 38% of the height and squeezes 300 and 600 to within 8 points
 * of each other, so the coalition and opposition lines lay on top of one
 * another exactly where they diverge. It also cannot plot zero, and רע"ם
 * reaches the final two rungs zero times, which blanked the whole party view.
 */
export type FunnelScale = "count" | "share";

export function parseFunnelScale(v: string | undefined): FunnelScale {
  return v === "share" ? "share" : "count";
}
