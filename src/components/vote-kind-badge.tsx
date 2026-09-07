import { Badge } from "@/components/ui/badge";
import { VOTE_KIND_BADGES, type VoteKind } from "@/lib/vote-kind";

/**
 * What a vote decided. Nothing is shown for a bill vote — the bill is already
 * linked on the card, and a badge saying "הצעת חוק" beside 6,762 of 7,536 votes
 * is noise. "לא מסווג" is shown, because an honest gap beats a silent one.
 */
export function VoteKindBadge({ kind }: { kind: string }) {
  if (kind === "bill") return null;
  const label = VOTE_KIND_BADGES[kind as VoteKind];
  if (!label) return null;

  const rose = kind === "no_confidence";
  return (
    <Badge
      variant="secondary"
      className={rose ? "border-0 bg-rose-500/12 text-rose-700 dark:text-rose-400" : "border-0"}
    >
      {label}
    </Badge>
  );
}
