import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BlocBadge } from "@/components/bloc-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OutcomeBadge } from "@/components/vote-tally";
import { formatDate, fullName, truncate } from "@/lib/format";
import {
  getBillProgressBaseline,
  getBlocHeadToHead,
  getClosestVotes,
  getGovernmentDefeats,
  getPrivateBillKillers,
  getSponsorThroughput,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "דפוסי חקיקה והצבעה" };

const pct = (n: number, of: number) => (of === 0 ? "0" : ((n / of) * 100).toFixed(1).replace(/\.0$/, ""));
const he = (n: number) => n.toLocaleString("he-IL");

export default async function PatternsPage() {
  const [head, defeats, killers, throughput, baseline, close] = await Promise.all([
    getBlocHeadToHead(),
    getGovernmentDefeats(),
    getPrivateBillKillers(),
    getSponsorThroughput(20),
    getBillProgressBaseline(),
    getClosestVotes(2, 20, 20),
  ]);

  const coalKiller = killers.find((k) => k.sponsorBloc === "coalition");
  const oppKiller = killers.find((k) => k.sponsorBloc === "opposition");
  const byVolume = [...throughput].slice(0, 6);
  const byPassed = [...throughput].sort((a, b) => b.passed - a.passed).slice(0, 6);

  return (
    <>
      <PageHeader
        title="דפוסי חקיקה והצבעה"
        description="מה שנראה בנתוני ההצבעות של הכנסת ה־25, ולא בכותרות"
      />

      <p className="mb-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        ארבעת החתכים שלהלן מתארים אותו דבר עצמו מזוויות שונות: מי קובע מה מגיע
        להכרעה במליאה ומה נעצר בדרך. הם מוצגים יחד בכוונה — כל אחד מהם לבדו מזמין
        פרשנות שגויה, ובפרט הנתון על הצעות חוק שלא התקדמו, שנראה כמדד לכוונותיהם
        של חברי הכנסת עד שמבחינים שמגישי הכמויות הגדולות הם דווקא מי שאינו יכול
        להעביר חקיקה ללא הסכמת הקואליציה.
      </p>

      <div className="space-y-6">
        <Card data-testid="pattern-headtohead">
          <CardHeader>
            <CardTitle>כשהגושים מצביעים הפוך</CardTitle>
            <CardDescription>
              הצבעות שבהן רוב הקואליציה ורוב האופוזיציה תמכו בעמדות מנוגדות
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat value={he(head.decided)} label="הצבעות חלוקות" />
              <Stat
                value={`${pct(head.coalitionWon, head.decided)}%`}
                label={`עמדת הקואליציה גברה (${he(head.coalitionWon)})`}
                tone="coalition"
              />
              <Stat
                value={he(defeats.length)}
                label="פעמים שהקואליציה נכחה והפסידה"
                tone="opposition"
              />
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              האופוזיציה גברה ב־{he(head.oppositionWon)} הצבעות, אך במחציתן
              הקואליציה כלל לא נכחה במספרים. אלה {he(defeats.length)} ההזדמנויות
              שבהן היא נכחה והפסידה בכל הכנסת הזאת:
            </p>

            <ul className="mt-3 space-y-2">
              {defeats.map((v) => (
                <li key={v.voteId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums text-muted-foreground">{formatDate(v.voteDateTime)}</span>
                  <Link href={`/votes/${v.voteId}`} className="font-medium tabular-nums hover:underline">
                    {v.forCount}–{v.againstCount}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {he(v.coalVoted)} מחברי הקואליציה הצביעו
                  </span>
                  {v.methodDesc ? <Badge variant="outline">{v.methodDesc}</Badge> : null}
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {truncate(v.title, 60)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card data-testid="pattern-killers">
          <CardHeader>
            <CardTitle>מי מפיל הצעות חוק פרטיות</CardTitle>
            <CardDescription>
              בהצבעות שבהן הצעה פרטית נפלה — מאיזה גוש הגיעו הקולות שהפילו אותה
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {coalKiller ? (
              <div>
                <p className="text-sm font-medium">הצעה של חבר/ת כנסת מהקואליציה</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  מתוך {he(coalKiller.votes)} הצבעות שבהן נפלה,{" "}
                  <strong className="text-foreground">{he(coalKiller.killedByOwn)}</strong> הופלו
                  ברוב קולות מגושה של המגישה עצמה — {pct(coalKiller.killedByOwn, coalKiller.votes)}%.
                  בממוצע {coalKiller.avgOwnShare}% מהמתנגדים היו מאותו גוש.
                </p>
              </div>
            ) : null}
            {oppKiller ? (
              <div>
                <p className="text-sm font-medium">הצעה של חבר/ת כנסת מהאופוזיציה</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  מתוך {he(oppKiller.votes)} הצבעות שבהן נפלה,{" "}
                  <strong className="text-foreground">{he(oppKiller.killedByOwn)}</strong> הופלו
                  ברוב קולות מגושה של המגישה. בממוצע {oppKiller.avgOwnShare}% מהמתנגדים היו מאותו
                  גוש — כלומר את ההצעות האלה מפיל הגוש האחר.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="pattern-throughput">
          <CardHeader>
            <CardTitle>מה קורה להצעות חוק פרטיות</CardTitle>
            <CardDescription>
              {he(baseline.one + baseline.none)} מתוך {he(baseline.total)} הצעות החוק במאגר הופיעו
              פעם אחת לכל היותר בוועדה או במליאה, ומעולם לא נדונו שוב
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat value={he(baseline.none)} label="ללא אירוע מתועד" />
              <Stat value={he(baseline.one)} label="הופעה אחת בלבד" />
              <Stat value={he(baseline.few)} label="שניים עד ארבעה" />
              <Stat value={he(baseline.many)} label="חמישה ומעלה" />
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              זהו הרוב המכריע, ולא חריג: אצל חבר/ת כנסת שהגיש/ה 20 הצעות פרטיות ומעלה,
              החציון של ההצעות שלא התקדמו הוא 65%. שתי הרשימות שלהלן ממוינות לפי כמות
              ולפי הצלחה — והן נחלקות לפי גוש, לא לפי אדם.
            </p>

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <SponsorTable title="הכי הרבה הצעות שהוגשו" rows={byVolume} />
              <SponsorTable title="הכי הרבה הצעות שהפכו לחוק" rows={byPassed} />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="pattern-close">
          <CardHeader>
            <CardTitle>הצבעות שהוכרעו בקול או שניים</CardTitle>
            <CardDescription>
              {he(close.length)} הצבעות עם 20 מצביעים ומעלה והפרש של עד שני קולות. אין אף תיקו
              בכל הכנסת הזאת
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {close.map((v) => (
                <li key={v.voteId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums text-muted-foreground">{formatDate(v.voteDateTime)}</span>
                  <Link href={`/votes/${v.voteId}`} className="font-medium tabular-nums hover:underline">
                    {v.forCount}–{v.againstCount}
                  </Link>
                  <OutcomeBadge tally={v} />
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {v.bill ? (
                      <Link href={`/bills/${v.bill.billId}`} className="hover:underline">
                        {truncate(v.bill.name, 56)}
                      </Link>
                    ) : (
                      truncate(v.title, 56)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "coalition" | "opposition" }) {
  return (
    <div>
      <span
        className={
          tone === "coalition"
            ? "block text-2xl font-semibold tabular-nums leading-tight text-primary"
            : tone === "opposition"
              ? "block text-2xl font-semibold tabular-nums leading-tight text-rose-600 dark:text-rose-400"
              : "block text-2xl font-semibold tabular-nums leading-tight"
        }
      >
        {value}
      </span>
      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{label}</span>
    </div>
  );
}

function SponsorTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ personId: number; firstName: string | null; lastName: string | null; bloc: string | null; tabled: number; stalled: number; passed: number }>;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.personId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <Link href={`/members/${r.personId}`} className="min-w-0 flex-1 truncate hover:underline">
              {fullName(r)}
            </Link>
            {r.bloc ? <BlocBadge bloc={r.bloc} /> : null}
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {he(r.tabled)} הוגשו · {he(r.passed)} חוקים
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
