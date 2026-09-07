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

export type TimelineVote = {
  voteId: number;
  date: Date | null;
  title: string | null;
  subject: string | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  presentCount: number;
  totalCount: number;
  /** Null for every bill vote; carried so the badge scores the same way here. */
  majorityRequired: number | null;
};

export type TimelineEvent = {
  id: string;
  date: Date | null;
  kind: "publication" | "committee" | "plenum" | "vote" | "status";
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
  /** Set on a "vote" event: the votes taken on this bill in one sitting. */
  votes?: TimelineVote[];
  /** How many more that sitting held beyond the ones listed. */
  moreVotes?: number;
  /** The sitting a vote event belongs to, which lists the rest. */
  plenumSessionId?: number | null;
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
 * Votes shown inline on a timeline node before the rest are left to the sitting
 * page — the same treatment the document lists get, and for the same reason:
 * the 2023 budget was voted through section by section, 212 times over two
 * sittings, which would bury the legislative spine it belongs to.
 */
const VOTES_SHOWN = 6;

/**
 * Assemble a bill's history from the pieces the OData service exposes:
 * publication in the official gazette, every committee session that had it on
 * the agenda (KNS_CmtSessionItem), every plenum sitting where it was tabled or
 * read (KNS_PlmSessionItem — whose StatusID gives the reading stage), the votes
 * taken on it (KNS_PlenumVote), and its current status as the closing node.
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

  // Votes group by sitting rather than becoming one node each. Every one of the
  // term's 6,762 bill votes falls in a sitting that already has a plenum item
  // for that bill, so these land beside the reading they belong to — but a
  // sitting can hold several items for one bill and nothing in the feed says
  // which reading a given vote decided, so they are not attached to an item.
  // Dating the node at its first vote's own timestamp is what puts it after the
  // sitting's reading events, which are dated from the sitting's start.
  const votesBySitting = new Map<number, Bill["votes"]>();
  for (const v of bill.votes) {
    if (v.plenumSessionId == null) continue;
    votesBySitting.set(v.plenumSessionId, [...(votesBySitting.get(v.plenumSessionId) ?? []), v]);
  }

  for (const [plenumSessionId, votes] of votesBySitting) {
    const ordered = [...votes].sort((a, b) => {
      const at = a.voteDateTime?.getTime() ?? 0;
      const bt = b.voteDateTime?.getTime() ?? 0;
      return at - bt || (a.ordinal ?? 0) - (b.ordinal ?? 0);
    });
    const passed = ordered.filter((v) => v.totalCount > 0 && v.forCount > v.againstCount).length;
    const failed = ordered.filter((v) => v.totalCount > 0 && v.forCount < v.againstCount).length;

    events.push({
      id: `vote-${plenumSessionId}`,
      date: ordered[0]?.voteDateTime ?? null,
      kind: "vote",
      title: ordered.length === 1 ? "הצבעה במליאה" : `${ordered.length.toLocaleString("he-IL")} הצבעות במליאה`,
      subtitle: [passed ? `${passed} עברו` : null, failed ? `${failed} נפלו` : null]
        .filter(Boolean)
        .join(" · ") || null,
      docs: [],
      plenumSessionId,
      votes: ordered.slice(0, VOTES_SHOWN).map((v) => ({
        voteId: v.voteId,
        date: v.voteDateTime,
        title: v.title,
        subject: v.subject,
        forCount: v.forCount,
        againstCount: v.againstCount,
        abstainCount: v.abstainCount,
        presentCount: v.presentCount,
        totalCount: v.totalCount,
        majorityRequired: v.majorityRequired,
      })),
      moreVotes: Math.max(0, ordered.length - VOTES_SHOWN),
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
