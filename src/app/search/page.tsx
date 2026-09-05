import { Landmark } from "lucide-react";
import Link from "next/link";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative, fullName, truncate } from "@/lib/format";
import { search } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "חיפוש" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const { bills, members, sessions, plenum } = await search(q, 12);
  const totalHits = bills.length + members.length + sessions.length + plenum.length;

  return (
    <>
      <PageHeader
        title="חיפוש"
        description={q ? `${totalHits} תוצאות עבור “${q}”` : "הקלידו מונח בשורת החיפוש למעלה."}
      />

      {!q ? null : totalHits === 0 ? (
        <EmptyState>לא נמצאו תוצאות. החיפוש מוגבל לנתונים שנשאבו למאגר המקומי.</EmptyState>
      ) : (
        <div className="space-y-6">
          {members.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>חברי כנסת ({members.length})</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {members.map((m) => (
                  <Link
                    key={m.personId}
                    href={`/members/${m.personId}`}
                    className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-secondary/60"
                  >
                    <MemberAvatar person={m} className="size-9" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{fullName(m)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{m.factionName ?? "—"}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {bills.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>הצעות חוק ({bills.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {bills.map((b) => (
                  <Link
                    key={b.billId}
                    href={`/bills/${b.billId}`}
                    className="-mx-2 block rounded-md px-2 py-2.5 transition-colors hover:bg-secondary/60"
                  >
                    <p className="text-sm font-medium leading-snug">{truncate(b.name, 120)}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge label={b.status?.desc} />
                      <span className="ms-auto tabular-nums">{formatRelative(b.lastUpdatedDate)}</span>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {plenum.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>ישיבות מליאה ({plenum.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {plenum.map((s) => (
                  <Link
                    key={s.plenumSessionId}
                    href={`/plenum/${s.plenumSessionId}`}
                    className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2.5 transition-colors hover:bg-secondary/60"
                  >
                    <Landmark className="size-4 shrink-0 text-violet-500" />
                    <span className="text-sm font-medium">
                      {s.number ? `ישיבה מס׳ ${s.number}` : "ישיבת מליאה"}
                    </span>
                    <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(s.startDate)}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {sessions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>ישיבות ועדה ({sessions.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {sessions.map((s) => (
                  <div key={s.committeeSessionId} className="-mx-2 rounded-md px-2 py-2.5">
                    <p className="text-sm font-medium leading-snug">{s.committee?.name ?? "ועדה"}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(s.startDate)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
