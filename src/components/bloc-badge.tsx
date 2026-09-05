import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BLOC_LABELS, type Bloc } from "@/lib/factions";
import { cn } from "@/lib/utils";

const TONES: Record<Bloc, string> = {
  coalition: "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
  opposition: "border-orange-500/30 text-orange-700 dark:text-orange-400",
};

export function BlocBadge({ bloc, className }: { bloc: string | null; className?: string }) {
  if (bloc !== "coalition" && bloc !== "opposition") return null;
  return (
    <Badge variant="outline" className={cn("font-medium", TONES[bloc], className)}>
      {BLOC_LABELS[bloc]}
    </Badge>
  );
}

/** Role in the sitting government — minister, deputy minister, PM. */
export function GovernmentBadge({ role, className }: { role: string | null; className?: string }) {
  if (!role) return null;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 border-0 bg-sky-500/12 font-medium text-sky-700 dark:text-sky-400",
        className,
      )}
    >
      <Landmark className="size-3" />
      {role.trim()}
    </Badge>
  );
}
