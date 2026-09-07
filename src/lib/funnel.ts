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
/**
 * Two families of status make up these rungs, and they mean different things:
 *
 * - `הונחה על שולחן הכנסת ל־X` — the text is *laid before the House*, one per
 *   reading (104 preliminary, 141 first, 130 second-third, 131 third).
 * - `לדיון במליאה לקראת X` — the item is *on the plenum agenda* for that
 *   reading (111, 114, 117; 150 for the preliminary).
 *
 * Laying comes first: of 607 bills holding both 141 and 111, 480 were laid
 * strictly earlier and 127 in the same sitting, and none the other way round.
 *
 * The two are separate rungs **only for the preliminary reading**, where the
 * gap is the largest cliff in the process: 6,915 private bills laid against
 * 1,636 that reached the plenum, a 76% drop. At the first and second-third
 * readings almost nothing is lost between laying and scheduling — 7% and 4% for
 * private bills, 7% and 3% for government ones — so those pairs share a rung
 * labelled for the laying, and two rungs of visual noise are gone.
 *
 * **No status means "passed the first reading."** Of all 35 bill statuses only
 * 118 records a pass, at third reading; committee approvals exist but the first
 * and second readings leave no pass or fail. So a rung here says a reading was
 * *reached*, never that it carried, and the labels say so — the outcome lives in
 * KNS_PlenumVote, which has a vote for 595 of those 607 bills.
 */
export const FUNNEL_STAGES = [
  "הונחה לדיון מוקדם",
  "עלתה לדיון מוקדם",
  "ועדה לקראת קריאה ראשונה",
  "הונחה לקריאה ראשונה",
  "ועדה לקראת שנייה-שלישית",
  "הונחה לקריאה שנייה-שלישית",
  "התקבלה בקריאה שלישית",
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
  150: 1, // במליאה לדיון מוקדם — kept separate, see the note above
  106: 2, 142: 2, 101: 2, 108: 2, 109: 2, 167: 2, // committee, before first reading
  141: 3, 111: 3, // laid for, and scheduled for, the first reading
  113: 4, 178: 4, 179: 4, // committee, before second-third
  130: 5, 131: 5, 114: 5, 117: 5, // laid for, and scheduled for, second-third
  118: 6, // התקבלה בקריאה שלישית
};

/**
 * Government bills join the ladder above at the first-reading tabling.
 *
 * What they skip is the **preliminary round** — its tabling (104: 6,804 private
 * bills, 0 government) and its plenum debate (150: 1,525 against 0). They are
 * certainly tabled: 405 carry 141, tabling for the first reading, against 269
 * private bills. So there is no single "tabling" step; a bill is laid before the
 * House once per reading and only the preliminary one is bypassed.
 *
 * Both kinds therefore share one ladder, and the government series simply
 * starts at this rung. Not one of the 638 has a furthest rung below it, so the
 * earlier points are not zero — they do not exist, and the line begins here.
 */
export const GOV_JOINS_AT_RUNG = 3;

export type FunnelView = "total" | "bloc" | "faction";

export function parseFunnelView(v: string | undefined): FunnelView {
  return v === "bloc" || v === "faction" ? v : "total";
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
