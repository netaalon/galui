import Link from "next/link";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { countLabel, fullName } from "@/lib/format";
import { listMembers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "חברי כנסת" };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const members = await listMembers({ q });
  const serving = members.filter((m) => m.mkEndDate === null);

  return (
    <>
      <PageHeader
        title="חברי כנסת"
        description={
          q
            ? `${members.length} תוצאות עבור “${q}”`
            : `${members.length} חברי וחברות הכנסת ה־25 · ${serving.length} מכהנים כעת`
        }
      />

      {members.length === 0 ? (
        <EmptyState>
          {q ? "לא נמצאו חברי כנסת תואמים." : <>אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.</>}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
            <Card key={member.personId} className="p-0 transition-colors hover:border-primary/40">
              <Link href={`/members/${member.personId}`} className="flex items-center gap-3 p-4">
                <MemberAvatar person={member} className="size-11" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium leading-tight">{fullName(member)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.factionName ?? "ללא שיוך סיעתי"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {member._count.billsInitiated > 0
                      ? `${countLabel(member._count.billsInitiated, "הצעת חוק אחת", "הצעות חוק")} במאגר`
                      : "אין הצעות חוק במדגם"}
                    {member.mkEndDate ? " · סיים/ה כהונה" : ""}
                  </p>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
