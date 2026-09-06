import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OutcomeBadge, VoteTally } from "@/components/vote-tally";
import { formatDateTime, truncate } from "@/lib/format";
import { getVoteStats, listVotes } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "הצבעות" };

const PAGE_SIZE = 50;

export default async function VotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;

  const [{ rows, total }, stats] = await Promise.all([
    listVotes({ q, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    getVoteStats(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="הצבעות במליאה"
        description={`${stats.total.toLocaleString("he-IL")} הצבעות בכנסת ה־25 · ${stats.ballots.toLocaleString("he-IL")} קולות · ${stats.avgTurnout} מצביעים בממוצע להצבעה`}
      />

      <p className="mb-6 text-sm text-muted-foreground">
        כל הצבעה מוצגת כשלעצמה. הקישור להצעת החוק שנדונה, לישיבה שבה נערכה ולחברי
        הכנסת שהצביעו טרם נבנה — מזהה חבר הכנסת בטבלת ההצבעות שייך למרחב מזהים
        שלישי, שונה משני המזהים שבשאר האתר, ולכן השמות כאן מגיעים מתוך רשומת
        ההצבעה עצמה.
      </p>

      <form method="get" className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="חיפוש בכותרת ההצבעה או בנושא"
          aria-label="חיפוש הצבעות"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:max-w-md"
        />
      </form>

      {rows.length === 0 ? (
        <EmptyState>לא נמצאו הצבעות התואמות לחיפוש.</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {total.toLocaleString("he-IL")} תוצאות
            {pages > 1 ? ` · עמוד ${page.toLocaleString("he-IL")} מתוך ${pages.toLocaleString("he-IL")}` : ""}
          </p>

          <ul className="space-y-3">
            {rows.map((v) => (
              <li key={v.voteId}>
                <Card>
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/votes/${v.voteId}`}
                          className="font-medium leading-snug hover:underline"
                        >
                          {truncate(v.title, 160) || "הצבעה ללא כותרת"}
                        </Link>
                        {v.subject ? (
                          <p className="mt-1 text-sm text-muted-foreground">{truncate(v.subject, 140)}</p>
                        ) : null}
                      </div>
                      <OutcomeBadge tally={v} />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDateTime(v.voteDateTime)}</span>
                      {v.methodDesc ? <Badge variant="outline">{v.methodDesc}</Badge> : null}
                      {v.isNoConfidence ? (
                        <Badge variant="secondary" className="border-0 bg-rose-500/12 text-rose-700 dark:text-rose-400">
                          אי־אמון
                        </Badge>
                      ) : null}
                    </div>

                    <VoteTally tally={v} className="mt-3" />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="mt-6 flex items-center justify-between gap-3 text-sm" aria-label="ניווט בין עמודים">
              <PageLink q={q} page={page - 1} disabled={page <= 1}>
                הקודם
              </PageLink>
              <span className="text-muted-foreground tabular-nums">
                {page.toLocaleString("he-IL")} / {pages.toLocaleString("he-IL")}
              </span>
              <PageLink q={q} page={page + 1} disabled={page >= pages}>
                הבא
              </PageLink>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

function PageLink({
  q,
  page,
  disabled,
  children,
}: {
  q?: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>;
  }
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return (
    <Link href={`/votes${query ? `?${query}` : ""}`} className="rounded-md border px-3 py-1.5 font-medium hover:bg-secondary">
      {children}
    </Link>
  );
}
