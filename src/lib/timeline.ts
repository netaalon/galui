import type { getBill } from "@/lib/queries";

type Bill = NonNullable<Awaited<ReturnType<typeof getBill>>>;
type CommitteeSessionRef = Bill["sessionItems"][number]["session"];
type PlenumSessionRef = Bill["plenumItems"][number]["session"];

export type TimelineDoc = {
  id: string;
  label: string;
  application: string | null;
  href: string;
};

export type TimelineEvent = {
  id: string;
  date: Date | null;
  kind: "publication" | "committee" | "plenum" | "status";
  title: string;
  subtitle?: string | null;
  /** Where the event happened, e.g. the committee room. */
  location?: string | null;
  /** Legislative stage for plenum readings ("לדיון במליאה לקראת קריאה שלישית"). */
  stage?: string | null;
  /** Plenum items distinguish an actual debate from merely being tabled. */
  debated?: boolean;
  docs: TimelineDoc[];
  href?: string | null;
};

/**
 * Plenum sittings carry thousands of per-item queue files ("תור מליאה") that
 * would drown the useful documents. Rank the meaningful kinds and keep the top
 * few; the sitting page links the rest.
 */
const DOC_PRIORITY = ["דברי הכנסת", "סטנוגרמה", "פרוטוקול ועדה", "נוסח לדיון בוועדה", "תוכן עניינים"];

function docRank(label: string | null | undefined): number {
  if (!label) return DOC_PRIORITY.length + 1;
  const trimmed = label.trim();
  const i = DOC_PRIORITY.findIndex((p) => trimmed.startsWith(p));
  return i === -1 ? DOC_PRIORITY.length : i;
}

function toDocs(
  documents: Array<{
    filePath: string | null;
    groupTypeDesc: string | null;
    applicationDesc: string | null;
  }>,
  ids: string[],
  limit: number,
): TimelineDoc[] {
  return documents
    .map((d, i) => ({ d, id: ids[i] }))
    .filter(({ d }) => d.filePath)
    .sort((a, b) => docRank(a.d.groupTypeDesc) - docRank(b.d.groupTypeDesc))
    .slice(0, limit)
    .map(({ d, id }) => ({
      id,
      label: d.groupTypeDesc?.trim() || "מסמך",
      application: d.applicationDesc,
      href: d.filePath!,
    }));
}

function committeeDocs(session: CommitteeSessionRef): TimelineDoc[] {
  return toDocs(
    session.documents,
    session.documents.map((d) => d.id),
    6,
  );
}

function plenumDocs(session: PlenumSessionRef): TimelineDoc[] {
  return toDocs(
    session.documents,
    session.documents.map((d) => d.id),
    3,
  );
}

/**
 * Assemble a bill's history from the pieces the OData service exposes:
 * publication in the official gazette, every committee session that had it on
 * the agenda (KNS_CmtSessionItem), every plenum sitting where it was tabled or
 * read (KNS_PlmSessionItem — whose StatusID gives the reading stage), and its
 * current status as the closing node.
 *
 * The service has no per-bill event log, so this is a reconstruction: it is as
 * complete as the committee and plenum item tables, no more.
 */
export function buildBillTimeline(bill: Bill): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (bill.publicationDate) {
    events.push({
      id: `pub-${bill.billId}`,
      date: bill.publicationDate,
      kind: "publication",
      title: "פורסמה ברשומות",
      subtitle: bill.publicationSeriesDesc,
      docs: [],
    });
  }

  for (const item of bill.sessionItems) {
    events.push({
      id: `cmt-${item.cmtSessionItemId}`,
      date: item.session.startDate,
      kind: "committee",
      title: item.session.committee?.name ?? "ועדה לא ידועה",
      subtitle: item.name,
      stage: item.status?.desc ?? null,
      location: item.session.location,
      docs: committeeDocs(item.session),
      href: item.session.sessionUrl,
    });
  }

  for (const item of bill.plenumItems) {
    events.push({
      id: `plm-${item.plmSessionItemId}`,
      date: item.session.startDate,
      kind: "plenum",
      // The stage is the headline here — "מליאת הכנסת" alone says nothing.
      title: item.status?.desc ?? "דיון במליאה",
      subtitle: item.session.number ? `ישיבה מס׳ ${item.session.number}` : item.session.name,
      stage: item.status?.desc ?? null,
      debated: item.isDiscussion,
      docs: plenumDocs(item.session),
    });
  }

  // Undated events sort last so the dated spine stays chronological.
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

  if (bill.status?.desc) {
    events.push({
      id: `status-${bill.billId}`,
      date: bill.lastUpdatedDate,
      kind: "status",
      title: bill.status.desc,
      subtitle: bill.postponementReasonDesc,
      docs: [],
    });
  }

  return events;
}
