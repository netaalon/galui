import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoteKindBadge } from "@/components/vote-kind-badge";
import { MajorityNote, OutcomeBadge, RESULT_LABELS, VoteTally } from "@/components/vote-tally";
import { shortFactionName } from "@/lib/factions";
import { formatDateTime, fullName } from "@/lib/format";
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
  const unlinked = vote.results.filter((r) => r.person == null).length;

  return (
    <>
      <PageHeader title={vote.title || "הצבעה"} description={vote.subject ?? undefined} />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <OutcomeBadge tally={vote} />
        <span>{formatDateTime(vote.voteDateTime)}</span>
        {vote.methodDesc ? <Badge variant="outline">{vote.methodDesc}</Badge> : null}
        {vote.statusDesc ? <Badge variant="outline">{vote.statusDesc}</Badge> : null}
        <VoteKindBadge kind={vote.kind} />
      </div>

      <Card className="mb-6">
        <CardContent className="py-5">
          <VoteTally tally={vote} />
          <MajorityNote tally={vote} className="mt-3" />
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
                      {m.person ? (
                        <Link href={`/members/${m.person.personId}`} className="hover:underline">
                          {fullName(m.person)}
                        </Link>
                      ) : (
                        [m.firstName, m.lastName].filter(Boolean).join(" ") || `מזהה ${m.mkId}`
                      )}
                      {m.person?.factionName ? (
                        <span className="ms-2 text-xs text-muted-foreground">
                          {shortFactionName(m.person.factionName)}
                        </span>
                      ) : null}
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
              {vote.bill ? (
                <p>
                  <Link href={`/bills/${vote.bill.billId}`} className="font-medium text-primary hover:underline">
                    {vote.bill.name ?? "הצעת החוק שבה הוכרע"}
                  </Link>
                </p>
              ) : vote.agenda ? (
                /* A motion for the agenda. The subtype matters: an urgent one
                   needs the Speaker's approval to be tabled at all, and a
                   "כוללת" motion was merged into a joint debate — which is also
                   why it has no proposer, the feed records one only on the
                   standalone ones. */
                <div className="space-y-1">
                  <p className="font-medium">{vote.agenda.name ?? "הצעה לסדר היום"}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      vote.agenda.subTypeDesc ? `הצעה ${vote.agenda.subTypeDesc}` : null,
                      vote.agenda.classificationDesc,
                      vote.agenda.status?.desc,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {vote.agenda.initiator ? (
                    <p className="text-xs text-muted-foreground">
                      הציע/ה{" "}
                      <Link
                        href={`/members/${vote.agenda.initiator.personId}`}
                        className="text-primary hover:underline"
                      >
                        {fullName(vote.agenda.initiator)}
                      </Link>
                      {vote.agenda.initiator.factionName
                        ? ` · ${shortFactionName(vote.agenda.initiator.factionName)}`
                        : ""}
                    </p>
                  ) : null}
                  {vote.agenda.committee?.committeeId ? (
                    <p className="text-xs text-muted-foreground">
                      הועברה ל
                      <Link
                        href={`/committees/${vote.agenda.committee.committeeId}`}
                        className="text-primary hover:underline"
                      >
                        {vote.agenda.committee.name ?? "ועדה"}
                      </Link>
                    </p>
                  ) : null}
                  {vote.agenda.postponementReasonDesc ? (
                    <p className="text-xs text-muted-foreground">{vote.agenda.postponementReasonDesc}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  ההצבעה אינה על הצעת חוק ואינה על הצעה לסדר היום, ולכן אין
                  רשומה נפרדת לקשר אליה.
                </p>
              )}
              {vote.session ? (
                <p>
                  <Link href={`/plenum/${vote.session.plenumSessionId}`} className="font-medium text-primary hover:underline">
                    {vote.session.name ?? "הישיבה שבה נערכה ההצבעה"}
                  </Link>
                </p>
              ) : null}
              {vote.ordinal != null ? (
                <p className="text-muted-foreground">הצבעה מס׳ {vote.ordinal.toLocaleString("he-IL")} בישיבה</p>
              ) : null}
              {unlinked > 0 ? (
                <p className="text-muted-foreground">
                  {unlinked.toLocaleString("he-IL")} מהמצביעים אינם מקושרים לעמוד חבר כנסת. השיוך
                  נגזר מהשם שברשומת ההצבעה, שכן מזהה חבר הכנסת בטבלת ההצבעות שייך למרחב
                  מזהים נפרד; שם שאינו מזוהה בוודאות נותר ללא קישור.
                </p>
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
