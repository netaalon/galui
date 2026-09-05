"use client";

import { ArrowUpDown, Filter } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import {
  QUESTION_FILTERS,
  QUESTION_FILTER_LABELS,
  QUESTION_SORTS,
  QUESTION_SORT_LABELS,
  type QuestionFilter,
  type QuestionSort,
} from "@/lib/question-sort";
import { cn } from "@/lib/utils";

type State = { sort: QuestionSort; filter: QuestionFilter };

export function QuestionControls({ sort, filter }: State) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Same reason as the members page: the URL only changes after the server
  // responds, so a plain controlled input snaps back mid-navigation.
  const [state, setState] = useOptimistic<State>({ sort, filter });

  function apply(next: State) {
    const p = new URLSearchParams(params.toString());
    if (next.sort === "recent") p.delete("sort");
    else p.set("sort", next.sort);
    if (next.filter === "all") p.delete("filter");
    else p.set("filter", next.filter);
    const qs = p.toString();
    startTransition(() => {
      setState(next);
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const select = "rounded-md border bg-background px-2 py-1.5 text-sm font-medium shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 transition-opacity", pending && "opacity-60")}>
      <label className="flex items-center gap-2 text-sm">
        <ArrowUpDown className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">מיון</span>
        <select value={state.sort} onChange={(e) => apply({ ...state, sort: e.target.value as QuestionSort })} className={select}>
          {QUESTION_SORTS.map((s) => <option key={s} value={s}>{QUESTION_SORT_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Filter className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">הצג</span>
        <select value={state.filter} onChange={(e) => apply({ ...state, filter: e.target.value as QuestionFilter })} className={select}>
          {QUESTION_FILTERS.map((f) => <option key={f} value={f}>{QUESTION_FILTER_LABELS[f]}</option>)}
        </select>
      </label>
    </div>
  );
}
