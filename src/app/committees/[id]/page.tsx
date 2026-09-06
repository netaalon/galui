import { ExternalLink, FileDown, Gavel } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberActivityChart } from "@/components/member-activity-chart";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countLabel, formatDateTime, formatRelative, truncate } from "@/lib/format";
import {
  getCommittee,
  getCommitteeActivity,
  getCommitteeBills,
  getCommitteeMembership,
  getCommitteeSessions,
} from "@/lib/queries";
import { fullName } from "@/lib/format";
import { sourceRecordUrl } from "@/lib/odata-link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCommittee(Number(id));
  return { title: c?.name ?? "ועדה" };
}

export default async function CommitteePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const committeeId = Number(id);
  if (!Number.isInteger(committeeId)) notFound();

  const committee = await getCommittee(committeeId);
  if (!committee) notFound();

  const [sessions, bills, activity, membership] = await Promise.all([
    getCommitteeSessions(committeeId, 25),
    getCommitteeBills(committeeId, 25),
    getCommitteeActivity(committeeId),
    getCommitteeMembership(committeeId),
  ]);

  return (
    <>
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Gavel className="size-3.5" />
            {committee.committeeTypeDesc ?? "ועדה"}
          </Badge>
          {committee.isCurrent ? (
            <Badge variant="secondary" className="border-0 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">פעילה</Badge>
          ) : (
            <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">לא פעילה</Badge>
          )}
        </div>

        <h1 className="text-2xl font-semibold leading-tight tracking-tight break-words sm:text-3xl">
          {committee.name}
        </h1>

        <p className="text-sm text-muted-foreground">
          {countLabel(committee._count.sessions, "ישיבה אחת", "ישיבות")}
          {bills.total > 0 ? ` · ${countLabel(bills.total, "הצעת חוק אחת", "הצעות חוק")}` : ""}
          {committee.parent ? (
            <>
              {" · ועדת משנה של "}
              <Link href={`/committees/${committee.parent.committeeId}`} className="text-primary hover:underline">
                {committee.parent.name}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          {activity.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>קצב הישיבות</CardTitle>
                <CardDescription>מספר הישיבות שקיימה הוועדה בכל חודש.</CardDescription>
              </CardHeader>
              <CardContent>
                <MemberActivityChart data={activity} singleSeries labels={{ lead: "ישיבות", rest: "ישיבות" }} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>הצעות חוק שנדונו</CardTitle>
              <CardDescription>
                {bills.total > bills.rows.length
                  ? `מוצגות ${bills.rows.length} מתוך ${bills.total}, לפי הדיון האחרון.`
                  : "לפי הדיון האחרון."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {bills.rows.length === 0 ? (
                <EmptyState>הוועדה לא דנה בהצעות חוק שנשמרו במאגר.</EmptyState>
              ) : (
                bills.rows.map((item) => (
                  <Link
                    key={item.cmtSessionItemId}
                    href={`/bills/${item.billId}`}
                    className="-mx-2 block rounded-md px-2 py-3 transition-colors hover:bg-secondary/60"
                  >
                    <p className="font-medium leading-snug">{truncate(item.bill?.name ?? item.name, 130)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge label={item.bill?.status?.desc} />
                      {item.discussions > 1 ? (
                        <span>{countLabel(item.discussions, "דיון אחד", "דיונים")} בוועדה</span>
                      ) : null}
                      <span className="ms-auto tabular-nums">{formatRelative(item.session.startDate)}</span>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ישיבות אחרונות</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {sessions.length === 0 ? (
                <EmptyState>לא נרשמו ישיבות.</EmptyState>
              ) : (
                sessions.map((s) => (
                  <div key={s.committeeSessionId} className="-mx-2 rounded-md px-2 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium tabular-nums">{formatDateTime(s.startDate)}</span>
                      <span className="text-xs text-muted-foreground">
                        {countLabel(s._count.items, "סעיף אחד", "סעיפים")}
                        {s._count.documents > 0 ? ` · ${countLabel(s._count.documents, "מסמך אחד", "מסמכים")}` : ""}
                      </span>
                    </div>
                    {s.note ? <p className="mt-1 text-sm leading-snug text-muted-foreground">{truncate(s.note, 120)}</p> : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs">
                      {s.location ? <span className="text-muted-foreground">{s.location}</span> : null}
                      {s.sessionUrl ? (
                        <a href={s.sessionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <ExternalLink className="size-3.5" />
                          עמוד הישיבה
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {committee._count.sessions > sessions.length ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  מוצגות {sessions.length} מתוך {committee._count.sessions} ישיבות.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          {committee.jointParticipants.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>ועדה משותפת</CardTitle>
                <CardDescription>הוועדות המרכיבות אותה.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {committee.jointParticipants.map((j) => (
                    <li key={j.participantCommitteeId} className="text-sm leading-snug">
                      <Link href={`/committees/${j.participantCommitteeId}`} className="hover:text-foreground hover:underline">
                        {j.participant.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {committee.jointMemberships.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>שותפה בוועדות</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {committee.jointMemberships.map((j) => (
                    <li key={j.committeeId} className="text-sm leading-snug">
                      <Link href={`/committees/${j.committeeId}`} className="hover:text-foreground hover:underline">
                        {j.committee.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {committee.subcommittees.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>ועדות משנה</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {committee.subcommittees.map((sub) => (
                    <li key={sub.committeeId} className="text-sm leading-snug">
                      <Link href={`/committees/${sub.committeeId}`} className="hover:text-foreground hover:underline">
                        {sub.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {countLabel(sub._count.sessions, "ישיבה אחת", "ישיבות")}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>הרכב</CardTitle>
              <CardDescription>
                לפי נוכחות בפועל בפרוטוקולים, ולא לפי ההרכב הרשמי — מי שלא נכח
                בישיבה אינו מופיע כאן.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {membership.members.length === 0 ? (
                <EmptyState>לא נמצאו פרוטוקולים עם רשימת נוכחים לוועדה זו.</EmptyState>
              ) : (
                <ul className="space-y-3">
                  {membership.members.map((m) => (
                    <li key={m.person.personId}>
                      <Link
                        href={`/members/${m.person.personId}`}
                        className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-secondary/60"
                      >
                        <MemberAvatar person={m.person} className="size-8" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{fullName(m.person)}</span>
                            {/* The count matters: chairing 621 sittings and
                                standing in once are not the same thing. */}
                            {m.asChair > 0 ? (
                              <Badge variant="secondary" className="shrink-0 border-0 bg-primary/10 text-[0.6875rem] text-primary">
                                {m.asChair > 1 ? `יו״ר ×${m.asChair.toLocaleString("he-IL")}` : "יו״ר"}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.person.factionName?.trim() ?? ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {m.sittings.toLocaleString("he-IL")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {membership.totalSittings > 0 ? (
                <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  המספר לצד כל שם הוא מספר הישיבות שבהן נכח/ה, מתוך{" "}
                  {membership.totalSittings.toLocaleString("he-IL")} ישיבות עם פרוטוקול.
                  {membership.moreCount > 0
                    ? ` מוצגים ${membership.members.length} הנוכחים הקבועים ביותר; עוד ${membership.moreCount} נכחו לפחות פעם אחת.`
                    : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>מקור</CardTitle>
            </CardHeader>
            <CardContent>
              <a
                href={sourceRecordUrl("KNS_Committee", committee.committeeId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <FileDown className="size-3.5" />
                הרשומה המקורית
              </a>
            </CardContent>
          </Card>

        </aside>
      </div>
    </>
  );
}
