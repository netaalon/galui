import { FileText } from "lucide-react";
import { EmptyState } from "@/components/page-header";

type Doc = {
  id: string;
  documentBillId: string;
  groupTypeId: number | null;
  groupTypeDesc: string | null;
  applicationDesc: string | null;
  filePath: string | null;
};

/**
 * The Knesset publishes each bill text once per format, as separate rows
 * sharing a documentBillId. Present them as one entry with a link per format
 * rather than as near-duplicate rows.
 */
function group(docs: Doc[]) {
  const byDoc = new Map<string, { label: string; stage: number; formats: Array<{ id: string; label: string; href: string }> }>();

  for (const d of docs) {
    if (!d.filePath) continue;
    const entry = byDoc.get(d.documentBillId) ?? {
      label: d.groupTypeDesc?.trim() || "מסמך",
      stage: d.groupTypeId ?? 999,
      formats: [],
    };
    entry.formats.push({ id: d.id, label: d.applicationDesc ?? "קובץ", href: d.filePath });
    byDoc.set(d.documentBillId, entry);
  }

  return [...byDoc.values()].sort((a, b) => a.stage - b.stage);
}

export function BillDocuments({ documents }: { documents: Doc[] }) {
  const entries = group(documents);

  if (entries.length === 0) {
    return <EmptyState>לא פורסמו מסמכים להצעת חוק זו.</EmptyState>;
  }

  return (
    <ul className="space-y-2.5">
      {entries.map((entry, i) => (
        <li key={`${entry.label}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <FileText className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm leading-snug">{entry.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            {entry.formats.map((f) => (
              <a
                key={f.id}
                href={f.href}
                target="_blank"
                rel="noreferrer"
                className="rounded border px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-secondary"
              >
                {f.label}
              </a>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
