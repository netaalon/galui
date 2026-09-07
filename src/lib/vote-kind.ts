/**
 * What a plenum vote was deciding.
 *
 * **Derived**, and the value is written by the ETL (`resolveVoteKinds()`), not
 * read from the feed: `KNS_PlenumVote` has no item-type column at all. The type
 * comes from `KNS_PlmSessionItem.ItemTypeID` where a row exists, from
 * `KNS_Agenda` for motions, and — only for no-confidence motions, whose own
 * flag upstream is dead — from the title's fixed formula.
 *
 * Kept out of `queries.ts` so client controls can import the labels without
 * pulling Prisma, the same reason the sort constants live on their own.
 */

export const VOTE_KINDS = ["bill", "no_confidence", "motion", "statutory", "plenum_item", "other"] as const;

export type VoteKind = (typeof VOTE_KINDS)[number];

export const VOTE_KIND_LABELS: Record<VoteKind, string> = {
  bill: "הצעות חוק",
  no_confidence: "אי־אמון",
  motion: "הצעות לסדר היום",
  statutory: "פעולה על פי חוק",
  plenum_item: "פריטי מליאה",
  other: "אחר",
};

/** Singular, for a badge on one vote. */
export const VOTE_KIND_BADGES: Record<VoteKind, string> = {
  bill: "הצעת חוק",
  no_confidence: "אי־אמון",
  motion: "הצעה לסדר היום",
  statutory: "פעולה על פי חוק",
  plenum_item: "פריט מליאה",
  other: "לא מסווג",
};

/**
 * What each kind actually covers, for the page that offers them as a filter.
 * "פעולה על פי חוק" is the feed's catch-all and needs the examples: it holds
 * the election of the Speaker and the setting up of special committees.
 */
export const VOTE_KIND_NOTES: Partial<Record<VoteKind, string>> = {
  no_confidence: "הצעות אי־אמון בממשלה, שזוהו לפי נוסח הכותרת",
  statutory: "בכללן בחירת יו״ר הכנסת והקמת ועדות מיוחדות",
  other: "הצבעות שהמזהה שלהן אינו מופיע באף רשומת פריט",
};

export function parseVoteKind(v: string | undefined): VoteKind | undefined {
  return VOTE_KINDS.includes(v as VoteKind) ? (v as VoteKind) : undefined;
}
