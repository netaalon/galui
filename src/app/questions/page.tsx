import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { QuestionControls } from "@/components/question-controls";
import { QuestionRow } from "@/components/question-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseQuestionFilter, parseQuestionSort } from "@/lib/question-sort";
import { getMinistryQuestionStats, getQuestionStats, listQuestions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "שאילתות" };

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; filter?: string; ministry?: string }>;
}) {
  const sp = await searchParams;
  const sort = parseQuestionSort(sp.sort);
  const filter = parseQuestionFilter(sp.filter);
  const ministryId = Number(sp.ministry) || undefined;

  const [{ rows, total }, stats, ministries] = await Promise.all([
    listQuestions({ q: sp.q, sort, filter, ministryId, take: 60 }),
    getQuestionStats(),
    getMinistryQuestionStats(10),
  ]);

  return (
    <>
      <PageHeader
        title="שאילתות"
        description={`${stats.total.toLocaleString("he-IL")} שאילתות בכנסת ה־25 · ${stats.answered} נענו · ${stats.pending} ממתינות`}
      />

      <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "נענו באיחור", value: `${stats.latePct}%`, hint: `${stats.late} מתוך ${stats.withLateness} שנענו במועד ידוע` },
          { label: "איחור ממוצע", value: `${stats.avgDaysLate}`, hint: "ימים מעבר למועד שנקבע" },
          { label: "האיחור הגדול ביותר", value: `${stats.maxDaysLate.toLocaleString("he-IL")}`, hint: "ימים" },
          { label: "ממתינות מעבר למועד", value: `${stats.pendingOverdue}`, hint: "טרם נענו והמועד חלף" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-5">
              <span className="block text-2xl font-semibold tabular-nums leading-tight">{s.value}</span>
              <span className="mt-0.5 block text-sm font-medium">{s.label}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">{s.hint}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-4">
          <Suspense fallback={null}>
            <QuestionControls sort={sort} filter={filter} />
          </Suspense>

          <Card>
            <CardHeader>
              <CardTitle>
                {total.toLocaleString("he-IL")} שאילתות
                {rows.length < total ? ` · מוצגות ${rows.length}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {rows.length === 0 ? (
                <EmptyState>לא נמצאו שאילתות תואמות.</EmptyState>
              ) : (
                rows.map((question) => <QuestionRow key={question.questionId} question={question} />)
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>משרדים</CardTitle>
              <CardDescription>מספר השאילתות שהופנו לכל משרד, והאיחור הממוצע במענה.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {ministries.map((m) => (
                  <li key={m.ministryId} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 leading-snug">{m.name}</span>
                      <span className="shrink-0 tabular-nums font-medium">{m.asked}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {m.avgDaysLate > 0 ? `איחור ממוצע ${m.avgDaysLate} ימים` : "בממוצע במועד"}
                      {m.pending > 0 ? ` · ${m.pending} ממתינות` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        האיחור מחושב מהפרש בין מועד התשובה שנקבע (ReplyDatePlanned) למועד שבו נמסרה
        התשובה בפועל (ReplyMinisterDate), שני שדות שמגיעים כמות שהם מ־KNS_Query.
        עבור שאילתות שטרם נענו, האיחור נמדד מול היום.
      </p>
    </>
  );
}
