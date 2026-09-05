import Link from "next/link";
import { Suspense } from "react";
import { BlocBadge, GovernmentBadge } from "@/components/bloc-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberControls } from "@/components/member-controls";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { BLOC_LABELS, BLOC_VERIFIED_ON } from "@/lib/factions";
import { countLabel, fullName } from "@/lib/format";
import { parseMemberSort } from "@/lib/member-sort";
import { getMemberBlocCounts, listMembers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "חברי כנסת" };

type Member = Awaited<ReturnType<typeof listMembers>>[number];

/** Sorting by faction or bloc reads far better with the groups called out. */
function groupsFor(members: Member[], sort: string): Array<[string, Member[]]> | null {
  if (sort !== "faction" && sort !== "bloc") return null;
  const out = new Map<string, Member[]>();
  for (const m of members) {
    const key =
      sort === "faction"
        ? (m.factionName?.trim() || "ללא שיוך סיעתי")
        : m.bloc === "coalition" || m.bloc === "opposition"
          ? BLOC_LABELS[m.bloc]
          : "לא מסווג";
    out.set(key, [...(out.get(key) ?? []), m]);
  }
  return [...out.entries()];
}

function MemberCard({ member }: { member: Member }) {
  return (
    <Card className="p-0 transition-colors hover:border-primary/40">
      <Link href={`/members/${member.personId}`} className="flex items-start gap-3 p-4">
        <MemberAvatar person={member} className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{fullName(member)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.factionName?.trim() || "ללא שיוך סיעתי"}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <BlocBadge bloc={member.bloc} />
            <GovernmentBadge role={member.governmentRole} />
          </div>

          <p className="mt-1.5 text-xs text-muted-foreground">
            {member._count.billsInitiated > 0
              ? `${countLabel(member._count.billsInitiated, "הצעת חוק אחת", "הצעות חוק")} במאגר`
              : "אין הצעות חוק במדגם"}
            {member.mkEndDate ? " · סיים/ה כהונה" : ""}
          </p>
        </div>
      </Link>
    </Card>
  );
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; serving?: string }>;
}) {
  const sp = await searchParams;
  const sort = parseMemberSort(sp.sort);
  const onlyServing = sp.serving === "1";

  const [members, counts] = await Promise.all([
    listMembers({ q: sp.q, sort, onlyServing }),
    getMemberBlocCounts(),
  ]);

  const groups = groupsFor(members, sort);

  return (
    <>
      <PageHeader
        title="חברי כנסת"
        description={
          sp.q
            ? `${members.length} תוצאות עבור “${sp.q}”`
            : `${counts.serving} מכהנים · ${counts.coalition} בקואליציה · ${counts.opposition} באופוזיציה · ${counts.government} בממשלה`
        }
      />

      <div className="mb-6">
        <Suspense fallback={null}>
          <MemberControls sort={sort} onlyServing={onlyServing} />
        </Suspense>
      </div>

      {members.length === 0 ? (
        <EmptyState>
          {sp.q ? "לא נמצאו חברי כנסת תואמים." : <>אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.</>}
        </EmptyState>
      ) : groups ? (
        <div className="space-y-8">
          {groups.map(([label, rows]) => (
            <section key={label}>
              <h2 className="mb-3 flex items-baseline gap-2 border-b pb-2 text-sm font-semibold">
                {label}
                <span className="text-xs font-normal text-muted-foreground">
                  {countLabel(rows.length, "חבר/ת כנסת אחד/ת", "חברי כנסת")}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((m) => (
                  <MemberCard key={m.personId} member={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <MemberCard key={m.personId} member={m} />
          ))}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        שיוך לקואליציה או לאופוזיציה אינו מתפרסם ב־API של הכנסת ונקבע לפי טבלה
        ידנית ({BLOC_VERIFIED_ON}). תפקידי הממשלה נלקחים ישירות מ־KNS_PersonToPosition.
        התצלומים מ־
        <a href="https://commons.wikimedia.org/" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
          ויקישיתוף
        </a>
        , ברישיונות חופשיים; הקרדיט המלא מופיע בעמוד של כל חבר/ת כנסת.
      </p>
    </>
  );
}
