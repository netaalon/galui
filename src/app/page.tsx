import { ArrowLeft, FileText, Landmark, MessageCircleQuestion, Speech, Users } from "lucide-react";
import Link from "next/link";
import { BillTypeBadge, StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDashboardStats,
  getLastIngest,
  getRecentBills,
  getRecentPlenumSessions,
  getRecentSessions,
  getUpcomingSessions,
} from "@/lib/queries";
import { countLabel, formatDateTime, formatRelative, fullName, truncate } from "@/lib/format";

// Every view reads the local SQLite mirror, which the ETL refreshes out of
// band; rendering per request keeps the dashboard in step with the last run.
export const dynamic = "force-dynamic";

const STATS = [
  { key: "bills", label: "הצעות חוק", icon: FileText, href: "/bills" },
  { key: "members", label: "חברי כנסת", icon: Users, href: "/members" },
  { key: "plenumSittings", label: "ישיבות מליאה", icon: Speech, href: "/plenum" },
  { key: "questions", label: "שאילתות", icon: MessageCircleQuestion, href: "/questions" },
] as const;

export default async function DashboardPage() {
  const [stats, bills, sessions, plenum, upcoming, lastIngest] = await Promise.all([
    getDashboardStats(),
    getRecentBills(5),
    getRecentSessions(5),
    getRecentPlenumSessions(5),
    getUpcomingSessions(4),
    getLastIngest(),
  ]);

  return (
    <>
      <div className="mb-8 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">מה קורה בכנסת</h1>
        <p className="text-muted-foreground">
          הכנסת ה־25
          {lastIngest?.finishedAt ? ` · עודכן ${formatRelative(lastIngest.finishedAt)}` : null}
        </p>
      </div>

      <section className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map(({ key, label, icon: Icon, href }) => {
          const body = (
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex items-center gap-3 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xl font-semibold tabular-nums leading-tight">
                    {stats[key].toLocaleString("he-IL")}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{label}</span>
                </span>
              </CardContent>
            </Card>
          );
          return href ? <Link key={key} href={href}>{body}</Link> : <div key={key}>{body}</div>;
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Recently updated bills ----------------------------------- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>הצעות חוק שהונחו לאחרונה</CardTitle>
            <Link
              href="/bills"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              הכול <ArrowLeft className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {bills.length === 0 ? (
              <EmptyState>אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.</EmptyState>
            ) : (
              bills.map((bill) => (
                <Link
                  key={bill.billId}
                  href={`/bills/${bill.billId}`}
                  className="-mx-2 block rounded-md px-2 py-3 transition-colors hover:bg-secondary/60"
                >
                  <p className="font-medium leading-snug">{truncate(bill.name, 110)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge label={bill.status?.desc} />
                    <BillTypeBadge label={bill.subTypeDesc} />
                    {bill.initiators[0]?.person ? (
                      <span>יוזם/ת: {fullName(bill.initiators[0].person)}</span>
                    ) : null}
                    <span className="ms-auto tabular-nums">{formatRelative(bill.firstStepDate)}</span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* --- Recent committee sessions -------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>ישיבות ועדה אחרונות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {sessions.length === 0 ? (
              <EmptyState>אין ישיבות במאגר.</EmptyState>
            ) : (
              sessions.map((session) => (
                <div key={session.committeeSessionId} className="-mx-2 rounded-md px-2 py-3">
                  <p className="font-medium leading-snug">
                    {session.committee?.name ?? "ועדה לא ידועה"}
                  </p>
                  {session.note ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">{truncate(session.note, 90)}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatDateTime(session.startDate)}</span>
                    <span>·</span>
                    <span>{countLabel(session._count.items, "סעיף אחד", "סעיפים")}</span>
                    {session._count.documents > 0 ? (
                      <>
                        <span>·</span>
                        <span>{countLabel(session._count.documents, "מסמך אחד", "מסמכים")}</span>
                      </>
                    ) : null}
                    {session.sessionUrl ? (
                      <a
                        href={session.sessionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ms-auto text-primary hover:underline"
                      >
                        לישיבה
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- Recent plenum sittings ------------------------------------ */}
      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>ישיבות מליאה אחרונות</CardTitle>
          <Link
            href="/plenum"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            הכול <ArrowLeft className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {plenum.length === 0 ? (
            <EmptyState>אין ישיבות מליאה במאגר.</EmptyState>
          ) : (
            plenum.map((session) => (
              <Link
                key={session.plenumSessionId}
                href={`/plenum/${session.plenumSessionId}`}
                className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 transition-colors hover:bg-secondary/60"
              >
                <Landmark className="size-4 shrink-0 text-violet-500" />
                <span className="font-medium leading-snug">
                  {session.number ? `ישיבה מס׳ ${session.number}` : "ישיבת מליאה"}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(session.startDate)}
                </span>
                <span className="ms-auto text-xs text-muted-foreground">
                  {countLabel(session._count.items, "סעיף אחד", "סעיפים")}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {upcoming.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>ישיבות קרובות</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((session) => (
              <div key={session.committeeSessionId} className="rounded-lg border p-3">
                <p className="text-sm font-medium leading-snug">
                  {session.committee?.name ?? "ועדה לא ידועה"}
                </p>
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(session.startDate)} · {formatRelative(session.startDate)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
