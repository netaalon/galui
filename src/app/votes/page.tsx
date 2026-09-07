import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VoteKindBadge } from "@/components/vote-kind-badge";
import { OutcomeBadge, VoteTally } from "@/components/vote-tally";
import { formatDateTime, truncate } from "@/lib/format";
import { getVoteStats, listVotes } from "@/lib/queries";
import { VOTE_KIND_LABELS, VOTE_KIND_NOTES, parseVoteKind } from "@/lib/vote-kind";

export const dynamic = "force-dynamic";

export const metadata = { title: "הצבעות" };

const PAGE_SIZE = 50;

export default async function VotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;
  const kind = parseVoteKind(sp.kind);

  const [{ rows, total }, stats] = await Promise.all([
    listVotes({ q, kind, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    getVoteStats(),
  ]);

  // Filter links keep the search term and drop the page, since page 7 of one
  // filter is nowhere in another.
  const hrefFor = (k: string | null) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (k) params.set("kind", k);
    const s = params.toString();
    return s ? `/votes?${s}` : "/votes";
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="הצבעות במליאה"
        description={`${stats.total.toLocaleString("he-IL")} הצבעות בכנסת ה־25 · ${stats.ballots.toLocaleString("he-IL")} קולות · ${stats.avgTurnout} מצביעים בממוצע להצבעה`}
      />

      <p className="mb-6 text-sm text-muted-foreground">
        כל הצבעה מקושרת לישיבת המליאה שבה נערכה ולחברי הכנסת שהצביעו. שיוך
        המצביעים נגזר מהשם שברשומת ההצבעה, שכן מזהה חבר הכנסת בטבלת ההצבעות שייך
        למרחב מזהים נפרד; שם שאינו מזוהה בוודאות נותר ללא קישור. הצבעות על הצעות
        חוק מקושרות גם להצעה עצמה — {(stats.total - stats.onBills).toLocaleString("he-IL")} מההצבעות
        הוכרעו בעניין אחר, כגון הצעה לסדר היום או פעולה על פי חוק. הסיווג נגזר
        אצלנו: לרשומת ההצבעה אין כלל שדה סוג, והוא נלמד מרשומת הפריט במליאה,
        ממנשא ההצעות לסדר היום, ובהצעות אי־אמון — מנוסח הכותרת, שכן השדה שאמור
        לסמן אותן ריק בכל ההצבעות.
      </p>

      {/* Filter by what was decided. The counts are the whole point: they say
          how lopsided the plenum's business is before you click anything. */}
      <nav aria-label="סינון לפי סוג ההצבעה" className="mb-6 flex flex-wrap gap-2">
        <Link
          href={hrefFor(null)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            kind ? "hover:bg-secondary" : "border-primary bg-primary/10 font-medium"
          }`}
        >
          הכול ({stats.total.toLocaleString("he-IL")})
        </Link>
        {stats.byKind.map((k) => (
          <Link
            key={k.kind}
            href={hrefFor(k.kind)}
            title={VOTE_KIND_NOTES[k.kind]}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              kind === k.kind ? "border-primary bg-primary/10 font-medium" : "hover:bg-secondary"
            }`}
          >
            {VOTE_KIND_LABELS[k.kind]} ({k.count.toLocaleString("he-IL")})
          </Link>
        ))}
      </nav>

      <form method="get" className="mb-6">
        {/* Searching inside a filter must keep the filter. */}
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="חיפוש בכותרת ההצבעה או בנושא"
          aria-label="חיפוש הצבעות"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:max-w-md"
        />
      </form>

      {kind && VOTE_KIND_NOTES[kind] ? (
        <p className="mb-4 text-xs text-muted-foreground">{VOTE_KIND_NOTES[kind]}.</p>
      ) : null}

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
                      <VoteKindBadge kind={v.kind} />
                    </div>

                    <VoteTally tally={v} className="mt-3" />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="mt-6 flex items-center justify-between gap-3 text-sm" aria-label="ניווט בין עמודים">
              <PageLink q={q} kind={kind} page={page - 1} disabled={page <= 1}>
                הקודם
              </PageLink>
              <span className="text-muted-foreground tabular-nums">
                {page.toLocaleString("he-IL")} / {pages.toLocaleString("he-IL")}
              </span>
              <PageLink q={q} kind={kind} page={page + 1} disabled={page >= pages}>
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
  kind,
  page,
  disabled,
  children,
}: {
  q?: string;
  kind?: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>;
  }
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return (
    <Link href={`/votes${query ? `?${query}` : ""}`} className="rounded-md border px-3 py-1.5 font-medium hover:bg-secondary">
      {children}
    </Link>
  );
}
