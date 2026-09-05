import { CalendarDays, ExternalLink, FileDown, Flag, Gavel, Landmark, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { TimelineEvent } from "@/lib/timeline";
import { cn } from "@/lib/utils";

const ICONS = {
  publication: CalendarDays,
  committee: Gavel,
  plenum: Landmark,
  status: Flag,
} as const;

const TONES = {
  publication: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  committee: "bg-primary/10 text-primary",
  plenum: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  status: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
} as const;

const KIND_LABELS = {
  publication: "פרסום",
  committee: "ועדה",
  plenum: "מליאה",
  status: "סטטוס",
} as const;

export function BillTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <EmptyState>לא נמצאו אירועים מתועדים עבור הצעת חוק זו.</EmptyState>;
  }

  return (
    // The spine sits on the inline-start edge, which is the right in RTL.
    <ol className="relative space-y-6 border-s ps-6">
      {events.map((event) => {
        const Icon = ICONS[event.kind];

        return (
          <li key={event.id} className="relative">
            <span
              className={cn(
                "absolute -start-[calc(1.5rem+0.875rem)] flex size-7 items-center justify-center rounded-full ring-4 ring-background",
                TONES[event.kind],
              )}
              aria-hidden
            >
              <Icon className="size-3.5" />
            </span>

            <div className="rounded-lg border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 font-medium leading-snug">{event.title}</h3>
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(event.date)}
                </time>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[0.6875rem] font-normal text-muted-foreground">
                  {KIND_LABELS[event.kind]}
                </Badge>
                {/* On a committee row the stage adds information; on a plenum
                    row it is already the title, so it would just repeat. */}
                {event.kind === "committee" && event.stage ? (
                  <Badge variant="secondary" className="text-[0.6875rem] font-normal">
                    {event.stage}
                  </Badge>
                ) : null}
                {event.debated ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-0 bg-violet-500/12 text-[0.6875rem] font-normal text-violet-700 dark:text-violet-400"
                  >
                    <MessagesSquare className="size-3" />
                    נדון בפועל
                  </Badge>
                ) : null}
              </div>

              {event.subtitle ? (
                <p className="mt-2 text-sm leading-relaxed break-words text-muted-foreground">
                  {event.subtitle}
                </p>
              ) : null}

              {event.location ? (
                <p className="mt-1.5 text-xs text-muted-foreground">{event.location}</p>
              ) : null}

              {event.docs.length > 0 || event.href ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  {event.docs.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <FileDown className="size-3.5" />
                      {doc.label}
                      {doc.application ? ` (${doc.application})` : ""}
                    </a>
                  ))}

                  {event.href ? (
                    <Link
                      href={event.href}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      עמוד הישיבה
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
