import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { BillTypeBadge, StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { countLabel, formatRelative, formatShortDate, fullName, truncate } from "@/lib/format";
import { listBills } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "הצעות חוק" };

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { rows, total } = await listBills({ q, take: 100 });

  return (
    <>
      <PageHeader
        title="הצעות חוק"
        description={
          q
            ? `${total.toLocaleString("he-IL")} תוצאות עבור “${q}”`
            : `${total.toLocaleString("he-IL")} הצעות חוק במאגר המקומי`
        }
      />

      {rows.length === 0 ? (
        <EmptyState>
          {q ? "לא נמצאו הצעות חוק תואמות." : <>אין נתונים. הריצו <code className="font-mono">npm run ingest</code>.</>}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((bill) => (
            <Card key={bill.billId} className="p-0 transition-colors hover:border-primary/40">
              <Link href={`/bills/${bill.billId}`} className="block p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <h2 className="min-w-0 flex-1 font-medium leading-snug">{bill.name}</h2>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelative(bill.lastUpdatedDate)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge label={bill.status?.desc} />
                  <BillTypeBadge label={bill.subTypeDesc} />
                  {bill.committee?.name ? <span>· {truncate(bill.committee.name, 40)}</span> : null}
                  {bill.initiators[0]?.person ? (
                    <span>· {fullName(bill.initiators[0].person)}</span>
                  ) : null}
                  {bill._count.sessionItems > 0 ? (
                    <span>· {countLabel(bill._count.sessionItems, "דיון אחד בוועדה", "דיונים בוועדה")}</span>
                  ) : null}
                  {bill.publicationDate ? (
                    <span className="ms-auto tabular-nums">פורסם {formatShortDate(bill.publicationDate)}</span>
                  ) : null}
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
