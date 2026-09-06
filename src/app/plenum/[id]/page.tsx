import { FileDown, Landmark, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countLabel, formatDateTime, formatTime, truncate } from "@/lib/format";
import { splitPlenumDocs } from "@/lib/plenum-docs";
import { getPlenumSession } from "@/lib/queries";
import { sourceRecordUrl } from "@/lib/odata-link";

export const dynamic = "force-dynamic";

/** KNS_ItemType id for a bill. */
const ITEM_TYPE_BILL = 2;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPlenumSession(Number(id));
  return { title: session?.number ? `מליאה — ישיבה ${session.number}` : "ישיבת מליאה" };
}

export default async function PlenumSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plenumSessionId = Number(id);
  if (!Number.isInteger(plenumSessionId)) notFound();

  const session = await getPlenumSession(plenumSessionId);
  if (!session) notFound();

  const { primary, rest } = splitPlenumDocs(session.documents);
  // Classify by the item's own type, not by whether the bill happens to be in
  // the local sample — otherwise an unmirrored bill drops into "other items".
  const bills = session.items.filter((i) => i.itemTypeId === ITEM_TYPE_BILL);
  const other = session.items.filter((i) => i.itemTypeId !== ITEM_TYPE_BILL);

  return (
    <>
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 border-0 bg-violet-500/12 text-violet-700 dark:text-violet-400">
            <Landmark className="size-3.5" />
            מליאה
          </Badge>
          {session.isSpecialMeeting ? (
            <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
              ישיבה מיוחדת
            </Badge>
          ) : null}
        </div>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {session.number ? `ישיבת מליאה מס׳ ${session.number}` : "ישיבת מליאה"}
        </h1>

        <p className="text-sm text-muted-foreground">
          {formatDateTime(session.startDate)}
          {session.finishDate ? ` – ${formatTime(session.finishDate)}` : null}
          {" · "}
          {countLabel(session.items.length, "סעיף אחד", "סעיפים")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <Card data-testid="plenum-bills">
            <CardHeader>
              <CardTitle>הצעות חוק על סדר היום</CardTitle>
              <CardDescription>
                השלב שבו נדונה כל הצעה בישיבה זו, לפי KNS_PlmSessionItem.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {bills.length === 0 ? (
                <EmptyState>לא נדונו הצעות חוק בישיבה זו.</EmptyState>
              ) : (
                bills.map((item) => {
                  const body = (
                    <>
                      <p className="font-medium leading-snug">{truncate(item.name ?? item.bill?.name, 120)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {item.status?.desc ? <StatusBadge label={item.status.desc} /> : null}
                        {item.isDiscussion ? (
                          <Badge
                            variant="secondary"
                            className="gap-1 border-0 bg-violet-500/12 text-[0.6875rem] font-normal text-violet-700 dark:text-violet-400"
                          >
                            <MessagesSquare className="size-3" />
                            נדון בפועל
                          </Badge>
                        ) : (
                          <span>הונח על שולחן הכנסת</span>
                        )}
                        {!item.bill ? (
                          <span className="text-muted-foreground/70">· אינה במאגר המקומי</span>
                        ) : null}
                      </div>
                    </>
                  );

                  // A bill outside the ingested sample still belongs in this
                  // list; it just has nowhere to link to yet.
                  return item.bill ? (
                    <Link
                      key={item.plmSessionItemId}
                      href={`/bills/${item.billId}`}
                      className="-mx-2 block rounded-md px-2 py-3 transition-colors hover:bg-secondary/60"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={item.plmSessionItemId} className="-mx-2 px-2 py-3">
                      {body}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {other.length > 0 ? (
            <Card data-testid="plenum-other">
              <CardHeader>
                <CardTitle>סעיפים נוספים</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {other.map((item) => (
                    <li key={item.plmSessionItemId} className="text-sm">
                      <span className="block leading-snug">{item.name ?? "ללא כותרת"}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.itemTypeDesc ?? "סעיף"}
                        {item.status?.desc ? ` · ${item.status.desc}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>פרוטוקולים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {primary.length === 0 ? (
                <EmptyState>טרם פורסם פרוטוקול לישיבה זו.</EmptyState>
              ) : (
                primary.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.filePath!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <FileDown className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                      {doc.groupTypeDesc?.trim()}
                      {doc.applicationDesc ? ` (${doc.applicationDesc})` : ""}
                    </span>
                  </a>
                ))
              )}
              {rest.length > 0 ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  ועוד {countLabel(rest.length, "מסמך אחד", "מסמכים")} נלווים (בעיקר תור מליאה).
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>מקור</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <a
                href={sourceRecordUrl("KNS_PlenumSession", session.plenumSessionId)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                הרשומה המקורית
              </a>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
