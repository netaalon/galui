import { Gavel } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { countLabel } from "@/lib/format";
import { listCommittees } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "ועדות" };

/** Main committees first, then the ad-hoc and subsidiary ones. */
const TYPE_ORDER = ["ועדה ראשית", "ועדת הכנסת", "ועדה מיוחדת", "ועדה משותפת", "ועדת משנה"];

export default async function CommitteesPage() {
  const committees = await listCommittees(25);

  const groups = new Map<string, typeof committees>();
  for (const c of committees) {
    const key = c.committeeTypeDesc ?? "אחר";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99),
  );

  const active = committees.filter((c) => c._count.sessions > 0).length;

  return (
    <>
      <PageHeader
        title="ועדות הכנסת"
        description={`${committees.length} ועדות בכנסת ה־25 · ${active} מהן קיימו ישיבות`}
      />

      {committees.length === 0 ? (
        <EmptyState>אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.</EmptyState>
      ) : (
        <div className="space-y-8">
          {ordered.map(([type, rows]) => (
            <section key={type}>
              <h2 className="mb-3 flex items-baseline gap-2 border-b pb-2 text-sm font-semibold">
                {type}
                <span className="text-xs font-normal text-muted-foreground">
                  {countLabel(rows.length, "ועדה אחת", "ועדות")}
                </span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {rows
                  .slice()
                  .sort((a, b) => b._count.sessions - a._count.sessions)
                  .map((c) => (
                    <Card key={c.committeeId} className="p-0 transition-colors hover:border-primary/40">
                      <Link href={`/committees/${c.committeeId}`} className="block p-4">
                        <div className="flex items-start gap-2">
                          <Gavel className="mt-0.5 size-4 shrink-0 text-primary" />
                          <h3 className="min-w-0 flex-1 font-medium leading-snug break-words">
                            {c.name}
                          </h3>
                          {!c.isCurrent ? (
                            <Badge variant="outline" className="shrink-0 border-muted-foreground/30 text-muted-foreground">
                              לא פעילה
                            </Badge>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="tabular-nums">
                            {c._count.sessions > 0
                              ? countLabel(c._count.sessions, "ישיבה אחת", "ישיבות")
                              : "לא קיימה ישיבות"}
                          </span>
                          {c.billItems > 0 ? (
                            <span className="tabular-nums">· {countLabel(c.billItems, "דיון אחד בהצעת חוק", "דיונים בהצעות חוק")}</span>
                          ) : null}
                          {c._count.subcommittees > 0 ? (
                            <span>· {countLabel(c._count.subcommittees, "ועדת משנה אחת", "ועדות משנה")}</span>
                          ) : null}
                        </div>

                        {c.parent ? (
                          <p className="mt-1.5 text-xs text-muted-foreground">מתוך {c.parent.name}</p>
                        ) : null}
                      </Link>
                    </Card>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        הרכב הוועדות אינו מתפרסם ב־API של הכנסת — סוגי התפקיד «יו״ר ועדה» ו«חבר
        ועדה» מוגדרים בו אך אין להם רשומות כלל. לכן הוועדות מתוארות כאן לפי
        פעילותן: ישיבות שקיימו והצעות חוק שדנו בהן.
      </p>
    </>
  );
}
