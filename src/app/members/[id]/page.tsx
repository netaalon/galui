import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocBadge, GovernmentBadge } from "@/components/bloc-badge";
import { MemberActivityChart } from "@/components/member-activity-chart";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/page-header";
import { BillTypeBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatRelative, fullName, knessetMemberUrl, truncate } from "@/lib/format";
import { getMember, getMemberActivityByMonth, getMemberCommittees } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getMember(Number(id));
  return { title: member ? fullName(member) : "חבר/ת כנסת" };
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) notFound();

  const member = await getMember(personId);
  if (!member) notFound();

  const [activity, committees] = await Promise.all([
    getMemberActivityByMonth(personId),
    getMemberCommittees(personId),
  ]);

  const leadCount = member.billsInitiated.filter((b) => b.isInitiator).length;
  const siteUrl = knessetMemberUrl(member.mkSiteCode);

  return (
    <>
      <header className="mb-8 flex flex-wrap items-start gap-5">
        <MemberAvatar person={member} className="size-20 text-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{fullName(member)}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {member.factionName ? <Badge variant="secondary">{member.factionName.trim()}</Badge> : null}
            <BlocBadge bloc={member.bloc} />
            <GovernmentBadge role={member.governmentRole} />
            {/* roleDesc can restate the government role; show it only when it adds something. */}
            {member.roleDesc && member.roleDesc !== member.governmentRole ? (
              <Badge variant="outline">{member.roleDesc}</Badge>
            ) : null}
            {member.mkEndDate ? (
              <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                סיים/ה כהונה {formatDate(member.mkEndDate)}
              </Badge>
            ) : member.isMk ? (
              <Badge className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" variant="secondary">
                מכהן/ת
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {member.mkStartDate ? `בכנסת מאז ${formatDate(member.mkStartDate)}` : "הכנסת ה־25"}
            {member.email ? (
              <>
                {" · "}
                <a href={`mailto:${member.email}`} className="hover:text-foreground hover:underline">
                  {member.email}
                </a>
              </>
            ) : null}
          </p>
          {siteUrl ? (
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              העמוד הרשמי באתר הכנסת
            </a>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>פעילות חקיקה</CardTitle>
              <CardDescription>
                {member.billsInitiated.length} הצעות חוק במדגם, מתוכן {leadCount} כיוזם/ת ראשי/ת.
                החלוקה לחודשים היא לפי המועד המוקדם ביותר שבו ההצעה עלתה על סדר היום
                של המליאה או של ועדה — ולא לפי מועד העדכון האחרון, שמשתנה בהינף אחד
                עבור כל הצעות החוק של חבר/ת כנסת שפורש/ת.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState>
                  לא נמצאו הצעות חוק של חבר/ת הכנסת במדגם שנשאב. הרחיבו את המדגם עם{" "}
                  <code className="font-mono">npm run ingest -- --bills=1000</code>.
                </EmptyState>
              ) : (
                <MemberActivityChart data={activity} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>הצעות חוק אחרונות</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {member.billsInitiated.length === 0 ? (
                <EmptyState>אין הצעות חוק במאגר המקומי.</EmptyState>
              ) : (
                member.billsInitiated.slice(0, 15).map((s) => (
                  <Link
                    key={s.billInitiatorId}
                    href={`/bills/${s.billId}`}
                    className="-mx-2 block rounded-md px-2 py-3 transition-colors hover:bg-secondary/60"
                  >
                    <p className="font-medium leading-snug">{truncate(s.bill.name, 110)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge label={s.bill.status?.desc} />
                      <BillTypeBadge label={s.bill.subTypeDesc} />
                      {s.isInitiator ? (
                        <Badge variant="outline" className="border-primary/30 text-primary">
                          יוזם/ת ראשי/ת
                        </Badge>
                      ) : null}
                      <span className="ms-auto tabular-nums">{formatRelative(s.bill.firstStepDate)}</span>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>ועדות</CardTitle>
            </CardHeader>
            <CardContent>
              {committees.length === 0 ? (
                <EmptyState>לא רשומות חברויות בוועדות.</EmptyState>
              ) : (
                <ul className="space-y-2.5">
                  {committees.map((c) => (
                    <li key={c.personToPositionId} className="text-sm">
                      <span className="block leading-snug">{c.committeeName}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.positionDesc ?? "חבר/ת ועדה"}
                        {c.isCurrent ? "" : " · בעבר"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>תפקידים</CardTitle>
            </CardHeader>
            <CardContent>
              {member.positions.length === 0 ? (
                <EmptyState>אין תפקידים רשומים.</EmptyState>
              ) : (
                <ul className="space-y-2.5">
                  {member.positions
                    .filter((p) => p.committeeId === null)
                    .map((p) => (
                      <li key={p.personToPositionId} className="text-sm">
                        <span className="block leading-snug">
                          {p.dutyDesc ?? p.positionDesc ?? "תפקיד"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(p.startDate)}
                          {p.finishDate ? ` – ${formatDate(p.finishDate)}` : " – היום"}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
