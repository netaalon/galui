import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { MemberSort } from "@/lib/member-sort";
import type { QuestionFilter, QuestionSort } from "@/lib/question-sort";

/**
 * The bills that most recently entered the legislative process.
 *
 * Deliberately not ordered by `lastUpdatedDate`: a single administrative event
 * restamps hundreds of rows, so that ordering fills the dashboard with one
 * member's back catalogue the day they resign (9 of the top 10, when checked).
 */
export async function getRecentBills(take = 5) {
  return prisma.bill.findMany({
    orderBy: { firstStepDate: "desc" },
    take,
    include: {
      status: true,
      committee: true,
      initiators: {
        where: { isInitiator: true },
        orderBy: { ordinal: "asc" },
        take: 1,
        include: { person: true },
      },
    },
  });
}

/** Committee sessions that have already taken place, newest first. */
export async function getRecentSessions(take = 5, now = new Date()) {
  return prisma.committeeSession.findMany({
    where: { startDate: { lte: now } },
    orderBy: { startDate: "desc" },
    take,
    include: {
      committee: true,
      _count: { select: { items: true, documents: true } },
    },
  });
}

/** Sessions scheduled in the future, soonest first. */
export async function getUpcomingSessions(take = 5, now = new Date()) {
  return prisma.committeeSession.findMany({
    where: { startDate: { gt: now } },
    orderBy: { startDate: "asc" },
    take,
    include: { committee: true, _count: { select: { items: true } } },
  });
}

export async function getDashboardStats() {
  const [bills, members, sessions, committees, discussions, protocols, plenumSittings, readings] =
    await Promise.all([
      prisma.bill.count(),
      prisma.person.count({ where: { isMk: true } }),
      prisma.committeeSession.count(),
      prisma.committee.count({ where: { isCurrent: true } }),
      prisma.sessionItem.count({ where: { billId: { not: null } } }),
      prisma.sessionDocument.count(),
      prisma.plenumSession.count(),
      prisma.plenumSessionItem.count({ where: { billId: { not: null } } }),
    ]);
  const questions = await prisma.question.count();
  return { bills, members, sessions, committees, discussions, protocols, plenumSittings, readings, questions };
}

/** Plenum sittings that have already been held, newest first. */
export async function getRecentPlenumSessions(take = 5, now = new Date()) {
  return prisma.plenumSession.findMany({
    where: { startDate: { lte: now } },
    orderBy: { startDate: "desc" },
    take,
    include: { _count: { select: { items: true, documents: true } } },
  });
}

export async function listPlenumSessions(opts: { take?: number; skip?: number } = {}) {
  const { take = 60, skip = 0 } = opts;
  const [rows, total] = await Promise.all([
    prisma.plenumSession.findMany({
      orderBy: { startDate: "desc" },
      take,
      skip,
      include: {
        _count: { select: { items: true, documents: true } },
        // Counted by item type, not by whether the bill is in the local sample.
        items: { where: { itemTypeId: 2 }, select: { itemId: true } },
      },
    }),
    prisma.plenumSession.count(),
  ]);
  return { rows, total };
}

export async function getPlenumSession(plenumSessionId: number) {
  return prisma.plenumSession.findUnique({
    where: { plenumSessionId },
    include: {
      documents: { orderBy: { groupTypeId: "asc" } },
      items: {
        orderBy: [{ ordinal: "asc" }],
        include: { status: true, bill: { include: { status: true } } },
      },
    },
  });
}

/** When the ETL last completed successfully. */
export async function getLastIngest() {
  return prisma.ingestRun.findFirst({
    where: { ok: true },
    orderBy: { finishedAt: "desc" },
  });
}

export async function listBills(opts: { q?: string; take?: number; skip?: number } = {}) {
  const { q, take = 50, skip = 0 } = opts;
  const where = q ? { name: { contains: q } } : {};
  const [rows, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      // Newest into the process first — see getRecentBills on why not lastUpdatedDate.
      orderBy: { firstStepDate: "desc" },
      take,
      skip,
      include: {
        status: true,
        committee: true,
        initiators: { where: { isInitiator: true }, take: 1, include: { person: true } },
        _count: { select: { sessionItems: true, initiators: true, documents: true } },
      },
    }),
    prisma.bill.count({ where }),
  ]);
  return { rows, total };
}

export async function getBill(billId: number) {
  return prisma.bill.findUnique({
    where: { billId },
    include: {
      status: true,
      committee: true,
      // groupTypeId runs in legislative order, so this reads as progression.
      documents: { orderBy: [{ groupTypeId: "asc" }, { documentBillId: "asc" }] },
      initiators: {
        orderBy: [{ isInitiator: "desc" }, { ordinal: "asc" }],
        include: { person: true },
      },
      sessionItems: {
        include: {
          status: true,
          session: {
            include: {
              committee: true,
              documents: { orderBy: { groupTypeId: "asc" } },
            },
          },
        },
      },
      plenumItems: {
        include: {
          status: true,
          session: { include: { documents: true } },
        },
      },
    },
  });
}

/**
 * Build a name filter that tolerates multi-word queries.
 *
 * `contains` tests the whole string against one column, so searching a full
 * name ("עופר כסיף") matched nothing while either half matched fine — first and
 * last names live in separate columns. Requiring every word to appear in *some*
 * name field fixes that without loosening the match.
 */
function nameSearchFilter(q: string): Prisma.PersonWhereInput | undefined {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  return {
    AND: words.map((w) => ({
      OR: [
        { firstName: { contains: w } },
        { lastName: { contains: w } },
        { factionName: { contains: w } },
        { governmentRole: { contains: w } },
      ],
    })),
  };
}

const MEMBER_ORDER_BY: Record<MemberSort, Prisma.PersonOrderByWithRelationInput[]> = {
  name: [{ lastName: "asc" }, { firstName: "asc" }],
  faction: [{ factionName: "asc" }, { lastName: "asc" }],
  // "coalition" sorts before "opposition" alphabetically, which is the order we want.
  bloc: [{ bloc: "asc" }, { factionName: "asc" }, { lastName: "asc" }],
  bills: [{ billsInitiated: { _count: "desc" } }, { lastName: "asc" }],
  seniority: [{ mkStartDate: "asc" }, { lastName: "asc" }],
};

export async function listMembers(
  opts: { q?: string; onlyServing?: boolean; sort?: MemberSort } = {},
) {
  const { q, onlyServing = false, sort = "name" } = opts;
  return prisma.person.findMany({
    where: {
      isMk: true,
      ...(onlyServing ? { mkEndDate: null } : {}),
      ...(q ? (nameSearchFilter(q) ?? {}) : {}),
    },
    orderBy: MEMBER_ORDER_BY[sort],
    include: { _count: { select: { billsInitiated: true } } },
  });
}

/** Headline counts for the members page. */
export async function getMemberBlocCounts() {
  const [serving, coalition, opposition, government, unaligned] = await Promise.all([
    prisma.person.count({ where: { isMk: true, mkEndDate: null } }),
    prisma.person.count({ where: { isMk: true, mkEndDate: null, bloc: "coalition" } }),
    prisma.person.count({ where: { isMk: true, mkEndDate: null, bloc: "opposition" } }),
    prisma.person.count({ where: { isMk: true, mkEndDate: null, isMinister: true } }),
    prisma.person.count({ where: { isMk: true, mkEndDate: null, bloc: null } }),
  ]);
  return { serving, coalition, opposition, government, unaligned };
}

export async function getMember(personId: number) {
  return prisma.person.findUnique({
    where: { personId },
    include: {
      positions: { orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }] },
      billsInitiated: {
        orderBy: [{ bill: { firstStepDate: "desc" } }],
        include: { bill: { include: { status: true, committee: true } } },
      },
    },
  });
}

/**
 * Bills sponsored per month, for the member activity chart.
 *
 * Buckets on `firstStepDate` — the first sitting that had the bill on its
 * agenda. Do not be tempted back to `lastUpdatedDate`: the Knesset rewrites it
 * in bulk, so a member who resigns has every pending bill restamped with their
 * last day and the chart shows a term's work as one enormous final month.
 */
export async function getMemberActivityByMonth(personId: number) {
  const sponsorships = await prisma.billInitiator.findMany({
    where: { personId },
    include: { bill: { select: { firstStepDate: true, subTypeDesc: true } } },
  });

  const buckets = new Map<string, { month: string; total: number; lead: number }>();
  for (const s of sponsorships) {
    const when = s.bill.firstStepDate;
    if (!when) continue;
    const key = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { month: key, total: 0, lead: 0 };
    bucket.total += 1;
    if (s.isInitiator) bucket.lead += 1;
    buckets.set(key, bucket);
  }

  // Months with no activity must still appear, otherwise a two-year gap renders
  // as two adjacent bars and the timeline reads as continuous work.
  const keys = [...buckets.keys()].sort();
  if (keys.length === 0) return [];
  const [startY, startM] = keys[0].split("-").map(Number);
  const [endY, endM] = keys[keys.length - 1].split("-").map(Number);
  const filled: Array<{ month: string; total: number; lead: number }> = [];
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    filled.push(buckets.get(key) ?? { month: key, total: 0, lead: 0 });
  }
  return filled;
}

/** Committee sessions this member sits on, via their committee positions. */
export async function getMemberCommittees(personId: number) {
  const rows = await prisma.personPosition.findMany({
    where: { personId, committeeId: { not: null } },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
  });
  // One person can hold several roles on the same committee over a term.
  const seen = new Set<number>();
  return rows.filter((r) => (r.committeeId != null && !seen.has(r.committeeId) ? (seen.add(r.committeeId), true) : false));
}

export async function search(q: string, take = 8) {
  if (!q.trim()) return { bills: [], members: [], sessions: [], plenum: [] };
  const [bills, members, sessions, plenum] = await Promise.all([
    prisma.bill.findMany({
      where: { name: { contains: q } },
      orderBy: { firstStepDate: "desc" },
      take,
      include: { status: true },
    }),
    prisma.person.findMany({
      where: { isMk: true, ...(nameSearchFilter(q) ?? {}) },
      orderBy: { lastName: "asc" },
      take,
    }),
    prisma.committeeSession.findMany({
      where: { OR: [{ note: { contains: q } }, { committee: { name: { contains: q } } }] },
      orderBy: { startDate: "desc" },
      take,
      include: { committee: true },
    }),
    prisma.plenumSession.findMany({
      where: { OR: [{ name: { contains: q } }, { items: { some: { name: { contains: q } } } }] },
      orderBy: { startDate: "desc" },
      take,
    }),
  ]);
  return { bills, members, sessions, plenum };
}

// ---------------------------------------------------------------------------
// Written questions (שאילתות)
// ---------------------------------------------------------------------------

const QUESTION_ORDER_BY: Record<QuestionSort, Prisma.QuestionOrderByWithRelationInput[]> = {
  recent: [{ submitDate: "desc" }],
  "latest-reply": [{ replyMinisterDate: "desc" }],
  // Nulls (unanswered) sort last; their live lateness is computed for display.
  overdue: [{ replyDaysLate: "desc" }, { submitDate: "desc" }],
  ministry: [{ ministry: { name: "asc" } }, { submitDate: "desc" }],
  asker: [{ person: { lastName: "asc" } }, { submitDate: "desc" }],
};

function questionWhere(opts: { q?: string; filter?: QuestionFilter; ministryId?: number }) {
  const { q, filter = "all", ministryId } = opts;
  return {
    ...(ministryId ? { govMinistryId: ministryId } : {}),
    ...(filter === "answered" ? { replyMinisterDate: { not: null } } : {}),
    ...(filter === "pending" ? { replyMinisterDate: null } : {}),
    ...(filter === "late" ? { replyDaysLate: { gt: 0 } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { person: nameSearchFilter(q) },
            { ministry: { name: { contains: q } } },
          ],
        }
      : {}),
  } satisfies Prisma.QuestionWhereInput;
}

export async function listQuestions(
  opts: { q?: string; sort?: QuestionSort; filter?: QuestionFilter; ministryId?: number; take?: number } = {},
) {
  const { sort = "recent", take = 60 } = opts;
  const where = questionWhere(opts);
  const [rows, total] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: QUESTION_ORDER_BY[sort],
      take,
      include: { person: true, ministry: true, status: true, documents: { orderBy: { groupTypeId: "asc" } } },
    }),
    prisma.question.count({ where }),
  ]);
  return { rows, total };
}

export async function getQuestionStats(now = new Date()) {
  const [total, answered, pending, late, agg, refused, pendingOverdue] = await Promise.all([
    prisma.question.count(),
    prisma.question.count({ where: { replyMinisterDate: { not: null } } }),
    prisma.question.count({ where: { replyMinisterDate: null } }),
    prisma.question.count({ where: { replyDaysLate: { gt: 0 } } }),
    prisma.question.aggregate({ _avg: { replyDaysLate: true }, _max: { replyDaysLate: true }, where: { replyDaysLate: { not: null } } }),
    prisma.question.count({ where: { status: { desc: { contains: "סירב" } } } }),
    prisma.question.count({ where: { replyMinisterDate: null, replyDatePlanned: { lt: now } } }),
  ]);
  const withLateness = await prisma.question.count({ where: { replyDaysLate: { not: null } } });
  return {
    total, answered, pending, late, refused, pendingOverdue, withLateness,
    avgDaysLate: Math.round(agg._avg.replyDaysLate ?? 0),
    maxDaysLate: agg._max.replyDaysLate ?? 0,
    latePct: withLateness ? Math.round((late / withLateness) * 100) : 0,
  };
}

/** Ministries ranked by how many questions they were asked. */
export async function getMinistryQuestionStats(take = 12) {
  const grouped = await prisma.question.groupBy({
    by: ["govMinistryId"],
    where: { govMinistryId: { not: null } },
    _count: true,
    _avg: { replyDaysLate: true },
    orderBy: { _count: { govMinistryId: "desc" } },
    take,
  });
  const ministries = await prisma.govMinistry.findMany({
    where: { govMinistryId: { in: grouped.map((g) => g.govMinistryId!) } },
  });
  const byId = new Map(ministries.map((m) => [m.govMinistryId, m]));
  return Promise.all(
    grouped.map(async (g) => ({
      ministryId: g.govMinistryId!,
      name: byId.get(g.govMinistryId!)?.name ?? "—",
      asked: g._count,
      avgDaysLate: Math.round(g._avg.replyDaysLate ?? 0),
      pending: await prisma.question.count({ where: { govMinistryId: g.govMinistryId, replyMinisterDate: null } }),
    })),
  );
}

/** A member's written questions, plus how well they were answered. */
export async function getMemberQuestions(personId: number, take = 10) {
  const [rows, total, answered, late, agg] = await Promise.all([
    prisma.question.findMany({
      where: { personId },
      orderBy: { submitDate: "desc" },
      take,
      include: { ministry: true, status: true, documents: { orderBy: { groupTypeId: "asc" } } },
    }),
    prisma.question.count({ where: { personId } }),
    prisma.question.count({ where: { personId, replyMinisterDate: { not: null } } }),
    prisma.question.count({ where: { personId, replyDaysLate: { gt: 0 } } }),
    prisma.question.aggregate({ _avg: { replyDaysLate: true }, where: { personId, replyDaysLate: { not: null } } }),
  ]);
  return { rows, total, answered, late, avgDaysLate: Math.round(agg._avg.replyDaysLate ?? 0) };
}

/** MKs who ask the most questions. */
export async function getTopQuestioners(take = 5) {
  const grouped = await prisma.question.groupBy({
    by: ["personId"],
    where: { personId: { not: null } },
    _count: true,
    orderBy: { _count: { personId: "desc" } },
    take,
  });
  const people = await prisma.person.findMany({ where: { personId: { in: grouped.map((g) => g.personId!) } } });
  const byId = new Map(people.map((p) => [p.personId, p]));
  return grouped.map((g) => ({ person: byId.get(g.personId!)!, asked: g._count })).filter((r) => r.person);
}
