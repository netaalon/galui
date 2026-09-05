"use client";

import { ArrowUpDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { MEMBER_SORTS, MEMBER_SORT_LABELS, type MemberSort } from "@/lib/member-sort";
import { cn } from "@/lib/utils";

type Controls = { sort: MemberSort; onlyServing: boolean };

export function MemberControls({ sort, onlyServing }: Controls) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // These inputs are driven by the URL, which only changes once the server has
  // re-rendered. Without an optimistic value the control snaps back to its old
  // state for the duration of the navigation.
  const [state, setState] = useOptimistic<Controls>({ sort, onlyServing });

  function apply(next: Controls) {
    const params_ = new URLSearchParams(params.toString());
    if (next.sort === "name") params_.delete("sort");
    else params_.set("sort", next.sort);
    if (next.onlyServing) params_.set("serving", "1");
    else params_.delete("serving");

    const qs = params_.toString();
    startTransition(() => {
      setState(next);
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 transition-opacity",
        pending && "opacity-60",
      )}
    >
      <label className="flex items-center gap-2 text-sm">
        <ArrowUpDown className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">מיון לפי</span>
        <select
          value={state.sort}
          onChange={(e) => apply({ ...state, sort: e.target.value as MemberSort })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm font-medium shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {MEMBER_SORTS.map((s) => (
            <option key={s} value={s}>
              {MEMBER_SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.onlyServing}
          onChange={(e) => apply({ ...state, onlyServing: e.target.checked })}
          className="size-4 rounded border-input accent-primary"
        />
        <span>מכהנים בלבד</span>
      </label>
    </div>
  );
}
