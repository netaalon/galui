import { Clock, FileDown } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatShortDate, fullName, truncate } from "@/lib/format";
import { overdueDays } from "@/lib/question-sort";
import { cn } from "@/lib/utils";

type Q = {
  questionId: number;
  name: string | null;
  typeDesc: string | null;
  submitDate: Date | null;
  replyDatePlanned: Date | null;
  replyMinisterDate: Date | null;
  replyDaysLate: number | null;
  person?: { personId: number; firstName: string | null; lastName: string | null } | null;
  ministry?: { name: string | null } | null;
  status?: { desc: string | null } | null;
  documents?: Array<{ documentQueryId: string; groupTypeDesc: string | null; applicationDesc: string | null; filePath: string | null }>;
};

/** Late by enough to be worth calling out, in days. */
const NOTABLE = 0;

export function LatenessBadge({ question }: { question: Q }) {
  const days = overdueDays(question);
  if (days === null) return null;
  const answered = question.replyMinisterDate != null;

  if (answered && days <= NOTABLE) {
    return <Badge variant="outline" className="border-emerald-500/30 font-medium text-emerald-700 dark:text-emerald-400">נענתה בזמן</Badge>;
  }
  if (days <= NOTABLE) return null; // pending but not yet due

  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 border-0 font-medium",
        answered
          ? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
          : "bg-rose-500/12 text-rose-700 dark:text-rose-400",
      )}
    >
      <Clock className="size-3" />
      {answered ? `באיחור ${days.toLocaleString("he-IL")} ימים` : `ממתינה ${days.toLocaleString("he-IL")} ימים מעבר למועד`}
    </Badge>
  );
}

export function QuestionRow({ question, showAsker = true }: { question: Q; showAsker?: boolean }) {
  const docs = (question.documents ?? []).filter((d) => d.filePath);

  return (
    <div className="-mx-2 rounded-md px-2 py-3">
      <p className="font-medium leading-snug">{truncate(question.name, 150)}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {question.status?.desc ? <Badge variant="outline">{question.status.desc}</Badge> : null}
        {question.typeDesc === "דחופה" ? (
          <Badge variant="secondary" className="border-0 bg-violet-500/12 text-violet-700 dark:text-violet-400">דחופה</Badge>
        ) : null}
        <LatenessBadge question={question} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showAsker && question.person ? (
          <Link href={`/members/${question.person.personId}`} className="font-medium hover:text-foreground hover:underline">
            {fullName(question.person)}
          </Link>
        ) : null}
        {question.ministry?.name ? <span>← {question.ministry.name}</span> : null}
        <span className="tabular-nums">הוגשה {formatShortDate(question.submitDate)}</span>
        {question.replyMinisterDate ? (
          <span className="tabular-nums">· נענתה {formatShortDate(question.replyMinisterDate)}</span>
        ) : question.replyDatePlanned ? (
          <span className="tabular-nums">· מועד התשובה {formatShortDate(question.replyDatePlanned)}</span>
        ) : null}

        {docs.length > 0 ? (
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {docs.map((d) => (
              <a
                key={d.documentQueryId}
                href={d.filePath!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <FileDown className="size-3.5" />
                {d.groupTypeDesc?.trim()}
                {d.applicationDesc ? ` (${d.applicationDesc})` : ""}
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
