import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Rough grouping of KNS_Status labels into a visual tone. */
function toneFor(label: string | null | undefined): string {
  if (!label) return "bg-muted text-muted-foreground";
  if (/התקבל|פורסם|אושר|חוק/.test(label)) return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400";
  if (/הוסר|נדחה|נפל|בוטל|הוחזר|התפזר/.test(label)) return "bg-rose-500/12 text-rose-700 dark:text-rose-400";
  if (/ועדה|קריאה|דיון|הכנה/.test(label)) return "bg-sky-500/12 text-sky-700 dark:text-sky-400";
  return "bg-amber-500/12 text-amber-700 dark:text-amber-400";
}

export function StatusBadge({ label, className }: { label: string | null | undefined; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", toneFor(label), className)}>
      {label ?? "לא ידוע"}
    </Badge>
  );
}

/** "פרטית" vs "ממשלתית" — the bill's origin. */
export function BillTypeBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  const isPrivate = label.includes("פרטית");
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        isPrivate ? "border-violet-500/30 text-violet-700 dark:text-violet-400" : "border-slate-500/30 text-slate-700 dark:text-slate-300",
      )}
    >
      {label}
    </Badge>
  );
}
