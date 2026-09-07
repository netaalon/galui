import { ExternalLink, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BillDocuments } from "@/components/bill-documents";
import { BillTimeline } from "@/components/bill-timeline";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/page-header";
import { BillTypeBadge, StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, fullName } from "@/lib/format";
import { getBill, getBillOwnBlocOpposition } from "@/lib/queries";
import { buildBillTimeline } from "@/lib/timeline";
import { sourceRecordUrl } from "@/lib/odata-link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bill = await getBill(Number(id));
  return { title: bill?.name ?? "הצעת חוק" };
}

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billId = Number(id);
  if (!Number.isInteger(billId)) notFound();

  const bill = await getBill(billId);
  if (!bill) notFound();

  // Where a private bill was voted down, say whose votes did it. For a
  // coalition member's bill that is almost always their own side: 878 of 881
  // such defeats across the term.
  const ownBloc = await getBillOwnBlocOpposition(billId);

  const events = buildBillTimeline(bill);
  // Published in ספר החוקים, i.e. it became law. This maps exactly onto the
  // status "התקבלה בקריאה שלישית" — checked across the corpus, no enacted bill
  // lacks the series and no unenacted bill carries it — so it serves as the
  // test without matching a Hebrew status string.
  const becameLaw = bill.publicationSeriesDesc != null;
  // One list, in the order the Knesset lists them. There is no lead-sponsor
  // split to make: `KNS_BillInitiator.IsInitiator` is true on 98% of rows.
  // Government bills are initiated by a ministry, not by MKs, so KNS_BillInitiator
  // is legitimately empty for them — worth saying, rather than showing a blank card.
  const isGovernmentBill = bill.subTypeDesc?.includes("ממשלתית") ?? false;

  return (
    <>
      <div className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={bill.status?.desc} />
          <BillTypeBadge label={bill.subTypeDesc} />
          {bill.number ? (
            <span className="text-xs text-muted-foreground">מספר חוק {bill.number}</span>
          ) : bill.privateNumber ? (
            <span className="text-xs text-muted-foreground">פ/{bill.privateNumber}</span>
          ) : null}
        </div>

        <h1 className="text-2xl font-semibold leading-tight tracking-tight break-words sm:text-3xl">{bill.name}</h1>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {bill.committee?.name ? (
            <div className="flex gap-1.5">
              <dt>ועדה אחראית:</dt>
              <dd>
                <Link href={`/committees/${bill.committeeId}`} className="text-primary hover:underline">
                  {bill.committee.name}
                </Link>
              </dd>
            </div>
          ) : null}
          {bill.firstStepDate ? (
            <div className="flex gap-1.5">
              <dt>הונחה:</dt>
              <dd className="text-foreground">{formatDate(bill.firstStepDate)}</dd>
            </div>
          ) : null}
          {bill.publicationDate ? (
            <div className="flex gap-1.5">
              <dt>פורסם:</dt>
              <dd className="text-foreground">{formatDate(bill.publicationDate)}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt>עודכן:</dt>
            <dd className="text-foreground">{formatDate(bill.lastUpdatedDate)}</dd>
          </div>
        </dl>

        {bill.postponementReasonDesc ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
            {bill.postponementReasonDesc}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {bill.summaryLaw ? (
            <Card>
              <CardHeader>
                <CardTitle>תקציר</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm leading-relaxed break-words text-muted-foreground">
                  {bill.summaryLaw}
                </p>
              </CardContent>
            </Card>
          ) : becameLaw ? (
            // A bill that passed and has no summary used to render nothing here,
            // which is indistinguishable from the page being broken — the
            // Knesset simply had not written one yet. 39 of the term's 594
            // enacted bills are in this position, mostly recent ones, and every
            // single one of them does carry the published text below.
            <Card data-testid="bill-summary-pending">
              <CardHeader>
                <CardTitle>תקציר</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  הצעת החוק התקבלה ופורסמה ברשומות, אך הכנסת טרם פרסמה עבורה תקציר.
                  נוסח החוק כפי שפורסם מופיע במסמכים שלהלן.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card data-testid="bill-documents">
            <CardHeader>
              <CardTitle>מסמכי הצעת החוק</CardTitle>
              <CardDescription>נוסחי ההצעה כפי שהונחו בכנסת, לפי סדר שלבי החקיקה.</CardDescription>
            </CardHeader>
            <CardContent>
              <BillDocuments documents={bill.documents} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ציר הזמן</CardTitle>
            </CardHeader>
            <CardContent>
              <BillTimeline events={events} />
            </CardContent>
          </Card>

        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <Users className="size-4 text-muted-foreground" />
              <CardTitle>יוזמים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bill.initiators.length === 0 ? (
                <EmptyState>
                  {isGovernmentBill
                    ? "הצעת חוק ממשלתית — מוגשת על ידי הממשלה, ולכן אין לה יוזמים מקרב חברי הכנסת."
                    : "לא רשומים יוזמים."}
                </EmptyState>
              ) : (
                <ul className="space-y-3">
                  {bill.initiators.map((i) => (
                    <li key={i.billInitiatorId}>
                      <Link
                        href={`/members/${i.personId}`}
                        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60"
                      >
                        <MemberAvatar person={i.person} className="size-9" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{fullName(i.person)}</span>
                          {i.person.factionName ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {i.person.factionName}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {ownBloc && ownBloc.own * 2 > ownBloc.total ? (
            <Card data-testid="bill-own-bloc">
              <CardHeader>
                <CardTitle>מי הפיל את ההצעה</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-muted-foreground">
                בהצבעה שבה נפלה,{" "}
                <Link href={`/votes/${ownBloc.voteId}`} className="font-medium text-primary hover:underline">
                  {ownBloc.own} מתוך {ownBloc.total} המתנגדים
                </Link>{" "}
                היו מ{ownBloc.sponsorBloc === "coalition" ? "הקואליציה" : "האופוזיציה"} — אותו גוש
                שממנו באה היוזמת. ראו{" "}
                <Link href="/patterns" className="text-primary hover:underline">
                  דפוסי חקיקה והצבעה
                </Link>
                .
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>מקור</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                כל הנתונים בעמוד זה נשאבו מ־KNS_Bill ומהישויות הקשורות בשירות ה־OData של הכנסת.
              </p>
              <a
                href={sourceRecordUrl("KNS_Bill", bill.billId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                הרשומה המקורית
              </a>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
