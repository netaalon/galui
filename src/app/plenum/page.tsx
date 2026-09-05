import { FileDown, Landmark } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { countLabel, formatDateTime, formatRelative } from "@/lib/format";
import { listPlenumSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "מליאה" };

export default async function PlenumPage() {
  const { rows, total } = await listPlenumSessions({ take: 60 });

  return (
    <>
      <PageHeader
        title="ישיבות מליאה"
        description={`${total.toLocaleString("he-IL")} ישיבות מליאה בכנסת ה־25`}
      />

      {rows.length === 0 ? (
        <EmptyState>
          אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((session) => {
            const billCount = new Set(session.items.map((i) => i.itemId)).size;
            return (
              <Card key={session.plenumSessionId} className="p-0 transition-colors hover:border-primary/40">
                <Link href={`/plenum/${session.plenumSessionId}`} className="block p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <h2 className="flex min-w-0 items-center gap-2 font-medium leading-snug">
                      <Landmark className="size-4 shrink-0 text-violet-500" />
                      {session.number ? `ישיבה מס׳ ${session.number}` : "ישיבת מליאה"}
                      {session.isSpecialMeeting ? (
                        <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                          ישיבה מיוחדת
                        </Badge>
                      ) : null}
                    </h2>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatRelative(session.startDate)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatDateTime(session.startDate)}</span>
                    {session._count.items > 0 ? (
                      <span>· {countLabel(session._count.items, "סעיף אחד", "סעיפים")}</span>
                    ) : null}
                    {billCount > 0 ? (
                      <span>· {countLabel(billCount, "הצעת חוק אחת", "הצעות חוק")}</span>
                    ) : null}
                    {session._count.documents > 0 ? (
                      <span className="ms-auto inline-flex items-center gap-1">
                        <FileDown className="size-3.5" />
                        {countLabel(session._count.documents, "מסמך אחד", "מסמכים")}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
