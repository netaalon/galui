import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { majorityNote, voteOutcome } from "@/lib/vote-outcome";

export type Tally = {
  forCount: number;
  againstCount: number;
  abstainCount: number;
  presentCount: number;
  totalCount: number;
  /** Votes needed in favour where a simple majority is not the bar. */
  majorityRequired?: number | null;
};

/**
 * The four ways the Knesset records a vote. `נוכח` ("present") is rare — 4,216
 * rows against 269k for — and is not an abstention: the feed records both.
 */
export const RESULT_LABELS: Record<number, string> = {
  7: "בעד",
  8: "נגד",
  9: "נמנע",
  6: "נוכח",
};

const BARS = [
  { key: "forCount", label: "בעד", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  { key: "againstCount", label: "נגד", bar: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
  { key: "abstainCount", label: "נמנע", bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  { key: "presentCount", label: "נוכח", bar: "bg-slate-400", text: "text-muted-foreground" },
] as const;

/**
 * Whether the vote carried. Scored by `voteOutcome()`, not by comparing the two
 * counts here: a motion of no confidence needs 61 of the 120 members, so its
 * usual 49-0 tally is a failure and used to render as "עבר".
 */
export function OutcomeBadge({ tally }: { tally: Tally }) {
  const outcome = voteOutcome(tally);
  if (outcome === "unknown") {
    return <Badge variant="outline" className="text-muted-foreground">אין תוצאות</Badge>;
  }
  if (outcome === "tied") {
    return <Badge variant="secondary" className="border-0 bg-amber-500/12 font-medium text-amber-700 dark:text-amber-400">תיקו</Badge>;
  }
  const passed = outcome === "passed";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-0 font-medium",
        passed
          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
          : "bg-rose-500/12 text-rose-700 dark:text-rose-400",
      )}
    >
      {passed ? "עבר" : "נפל"}
    </Badge>
  );
}

/**
 * Why a vote with more for than against still failed.
 *
 * Without this the page looks broken: 49 in favour, 0 against, "נפל". Renders
 * nothing for the ordinary majority.
 */
export function MajorityNote({ tally, className }: { tally: Tally; className?: string }) {
  const note = majorityNote(tally);
  if (!note) return null;
  return <p className={cn("text-xs text-muted-foreground", className)}>{note}</p>;
}

/**
 * A vote's tallies as a single proportional bar plus counts.
 *
 * Widths are percentages of those who voted, not of the 120 seats: the feed
 * writes a row only for members who actually voted, so turnout varies.
 */
export function VoteTally({ tally, className }: { tally: Tally; className?: string }) {
  const total = tally.totalCount;
  if (total === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary" role="presentation">
        {BARS.map(({ key, bar }) => {
          const n = tally[key];
          if (n === 0) return null;
          return <span key={key} className={cn("h-full", bar)} style={{ width: `${(n / total) * 100}%` }} />;
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
        {BARS.map(({ key, label, text }) => {
          const n = tally[key];
          if (n === 0) return null;
          return (
            <span key={key} className={text}>
              {label} {n.toLocaleString("he-IL")}
            </span>
          );
        })}
        <span className="text-muted-foreground">מתוך {total.toLocaleString("he-IL")} שהצביעו</span>
      </div>
    </div>
  );
}
