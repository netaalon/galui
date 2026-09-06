import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OutcomeBadge, RESULT_LABELS, VoteTally } from "@/components/vote-tally";
import { formatDateTime } from "@/lib/format";
import { sourceRecordUrl } from "@/lib/odata-link";
import { getVote } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** The order the groups read in: for, against, abstained, present. */
const GROUP_ORDER = [7, 8, 9, 6];

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vote = await getVote(Number(id));
  if (!vote) notFound();

  const groups = GROUP_ORDER.map((code) => ({
    code,
    label: RESULT_LABELS[code] ?? "אחר",
    members: vote.results.filter((r) => r.resultCode === code),
  })).filter((g) => g.members.length > 0);

  const ungrouped = vote.results.filter((r) => r.resultCode == null || !GROUP_ORDER.includes(r.resultCode));

  return (
    <>
      <PageHeader title={vote.title || "הצבעה"} description={vote.subject ?? undefined} />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <OutcomeBadge tally={vote} />
        <span>{formatDateTime(vote.voteDateTime)}</span>
        {vote.methodDesc ? <Badge variant="outline">{vote.methodDesc}</Badge> : null}
        {vote.statusDesc ? <Badge variant="outline">{vote.statusDesc}</Badge> : null}
        {vote.isNoConfidence ? (
          <Badge variant="secondary" className="border-0 bg-rose-500/12 text-rose-700 dark:text-rose-400">אי־אמון</Badge>
        ) : null}
      </div>

      <Card className="mb-6">
        <CardContent className="py-5">
          <VoteTally tally={vote} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          {groups.map((g) => (
            <Card key={g.code}>
              <CardHeader>
                <CardTitle className="text-base">
                  {g.label}
                  <span className="ms-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {g.members.length.toLocaleString("he-IL")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {g.members.map((m) => (
                    <li key={m.id} className="min-w-0 break-words">
                      {[m.firstName, m.lastName].filter(Boolean).join(" ") || `מזהה ${m.mkId}`}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {ungrouped.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">אחר</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {ungrouped.map((m) => (
                    <li key={m.id} className="min-w-0 break-words">
                      {[m.firstName, m.lastName].filter(Boolean).join(" ") || `מזהה ${m.mkId}`}
                      {m.resultDesc ? <span className="text-muted-foreground"> — {m.resultDesc}</span> : null}
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
              <CardTitle className="text-base">על ההצבעה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                השמות מגיעים מרשומת ההצבעה עצמה ואינם מקושרים לעמודי חברי הכנסת
                באתר: מזהה חבר הכנסת כאן שייך למרחב מזהים שלישי, שאינו זהה
                למזהים שבשאר הנתונים. קישור לפי מספר היה משייך הצבעה לאדם הלא נכון.
              </p>
              {vote.plenumSessionId ? (
                <p className="text-muted-foreground">
                  ישיבת מליאה מס׳ {vote.plenumSessionId.toLocaleString("he-IL")}
                </p>
              ) : null}
              {vote.ordinal != null ? (
                <p className="text-muted-foreground">הצבעה מס׳ {vote.ordinal.toLocaleString("he-IL")} בישיבה</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">מקור</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href={sourceRecordUrl("KNS_PlenumVote", vote.voteId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                הרשומה המקורית
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
