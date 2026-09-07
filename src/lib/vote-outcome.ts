/**
 * Whether a vote carried — which is not always "more for than against".
 *
 * A motion of no confidence is carried only by a majority of *all* Knesset
 * members, not of those who turned up: Basic Law: The Government §28, which
 * since the 2014 amendment requires the Knesset to resolve, by a majority of
 * its members, to express confidence in an alternative government. So 49 in
 * favour and 0 against is a failed motion, and reading it as a win is how this
 * site displayed 158 of the term's 220 no-confidence votes as passed.
 *
 * The feed does not carry the threshold — `KNS_PlenumVote` has no outcome
 * column at all, only tallies — so `PlenumVote.majorityRequired` is set by the
 * ETL and the rule lives here. A null means the ordinary rule: a majority of
 * those voting.
 *
 * Plain module, no Prisma, because the badge that renders this is a shared
 * presentational component.
 */

/** Basic Law: The Knesset §3 fixes the house at 120, so a majority is 61. */
export const MAJORITY_OF_MKS = 61;

export type VoteOutcome = "passed" | "failed" | "tied" | "unknown";

export type Scored = {
  forCount: number;
  againstCount: number;
  totalCount: number;
  /** Votes needed in favour. Null for the ordinary simple majority. */
  majorityRequired?: number | null;
};

export function voteOutcome(v: Scored): VoteOutcome {
  if (v.totalCount === 0) return "unknown";
  // A threshold vote cannot tie: it either reaches the bar or it does not.
  if (v.majorityRequired != null) return v.forCount >= v.majorityRequired ? "passed" : "failed";
  if (v.forCount > v.againstCount) return "passed";
  if (v.forCount < v.againstCount) return "failed";
  return "tied";
}

/**
 * How close a vote came, in votes.
 *
 * For a threshold vote that is the distance to the bar, not to the other side:
 * the closest no-confidence motion of the term reached 53 against 59, which is
 * 6 votes from beating the opposing side and 8 from bringing down a government.
 * The second number is the one that means something.
 */
export function voteMargin(v: Scored): number {
  if (v.majorityRequired != null) return Math.abs(v.majorityRequired - v.forCount);
  return Math.abs(v.forCount - v.againstCount);
}

/** The sentence a page needs when the bar is not a simple majority. */
export function majorityNote(v: Scored): string | null {
  if (v.majorityRequired == null) return null;
  const short = v.majorityRequired - v.forCount;
  return (
    `נדרש רוב של ${v.majorityRequired.toLocaleString("he-IL")} מכלל 120 חברי הכנסת, ולא רוב המצביעים` +
    (v.totalCount > 0 && short > 0 ? ` — חסרו ${short.toLocaleString("he-IL")} קולות` : "")
  );
}
