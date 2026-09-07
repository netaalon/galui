/**
 * Coalition / opposition membership for the 25th Knesset.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS HAND-MAINTAINED. The Knesset OData service does not expose bloc
 * membership anywhere: the only bloc-related records are the two leadership
 * posts, PositionID 30 (יושב–ראש הקואליציה) and 131 (ראש האופוזיציה), each held
 * by a single MK.
 *
 * Deriving the bloc from who holds a portfolio does not work. ש"ס has eleven
 * serving MKs and no current ministers, and נעם likewise — both would come out
 * as opposition, which is wrong. So the mapping below is asserted, not computed,
 * and it goes stale whenever a party changes sides.
 *
 * To correct an entry: edit it here and re-run `npm run ingest`, which rewrites
 * `Person.bloc` from this file. Nothing else needs to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Bloc = "coalition" | "opposition";

export const BLOC_LABELS: Record<Bloc, string> = {
  coalition: "קואליציה",
  opposition: "אופוזיציה",
};

/** When a human last checked this table against reality. */
export const BLOC_VERIFIED_ON = "2026-09-07";

/**
 * This map is a snapshot, and it is incomplete for history.
 *
 * It asserts a bloc for 11 factions, but 16 were held by an MK during this
 * Knesset, so the bloc of a *past* faction membership is not always knowable
 * from here. 27 members changed faction during the term — 4 of them across
 * blocs (המחנה הממלכתי → הימין הממלכתי), 15 within one, and 8 via a faction
 * missing below — and הימין הממלכתי itself changed sides, its agreement with
 * the coalition stepping from ~10% to ~100% in 2024-Q4.
 *
 * So a bloc read from here is right for today and may be wrong for any dated
 * record. See #21 for labelling that, and #20 for resolving faction-at-a-date.
 */

type FactionEntry = {
  /** KNS_Faction.FactionID */
  name: string;
  bloc: Bloc;
  /** Set when the classification is contested or the faction no longer sits. */
  note?: string;
};

export const FACTIONS: Record<number, FactionEntry> = {
  // --- Coalition ------------------------------------------------------------
  1096: { name: "הליכוד", bloc: "coalition" }, // holds the coalition chair (Ofir Katz)
  1105: { name: "הציונות הדתית בראשות בצלאל סמוטריץ'", bloc: "coalition" },
  1106: { name: "עוצמה יהודית בראשות איתמר בן גביר", bloc: "coalition" },
  1107: { name: "נעם - בראשות אבי מעוז", bloc: "coalition" },
  1108: { name: "הימין הממלכתי", bloc: "coalition" }, // rejoined the government in Sept 2024

  1095: {
    name: "התאחדות הספרדים שומרי תורה (ש\"ס)",
    bloc: "coalition",
    note: "Withdrew its ministers in 2025 over the conscription law while remaining in the coalition, so no portfolio confirms this. The voting record does: 99.9% agreement with הליכוד's majority position over 6,791 comparable votes, against 9.5-26.1% for every opposition faction.",
  },
  1101: {
    name: "יהדות התורה",
    bloc: "coalition",
    note: "Same 2025 conscription dispute as ש\"ס. 99.4% agreement with הליכוד over 5,646 votes. The dispute shows as a dip to 77% in 2025-Q3 and a return to 98%, i.e. friction rather than a change of side.",
  },

  // --- Opposition -----------------------------------------------------------
  1102: { name: "יש עתיד", bloc: "opposition" }, // holds the opposition leadership (Yair Lapid)
  1109: {
    name: 'חה"כ עידן רול',
    bloc: "opposition",
    note: "A one-member faction split from יש עתיד in Jan 2025 and dissolved Aug 2025, so no portfolio or leadership post places it. Asserted from the voting record: 5.6% agreement with הליכוד over 3,065 comparable votes, below every other opposition faction.",
  },
  1110: { name: "כחול לבן - המחנה הממלכתי", bloc: "opposition" }, // left the emergency government in June 2024
  1104: { name: "ישראל ביתנו", bloc: "opposition" },
  1103: { name: 'חד"ש-תע"ל', bloc: "opposition" },
  1099: { name: 'רע"ם', bloc: "opposition" },
  1100: { name: "העבודה", bloc: "opposition" },

  // --- No longer sitting; kept so historical members still resolve ----------
  1097: {
    name: "הציונות הדתית",
    bloc: "coalition",
    note: "The joint list as it ran in 2022, before splitting into 1105 / 1106 / 1107. No serving members.",
  },
  1098: {
    name: "המחנה הממלכתי",
    bloc: "opposition",
    note: "Predecessor of 1110. No serving members.",
  },
};

export function blocFor(factionId: number | null | undefined): Bloc | null {
  return factionId == null ? null : (FACTIONS[factionId]?.bloc ?? null);
}

/** Factions present in the data but absent from the table above. */
export function unmappedFactions(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((id): id is number => id != null && !(id in FACTIONS)))];
}
