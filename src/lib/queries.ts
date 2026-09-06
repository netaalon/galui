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
      documents: { orderBy: [{ groupTypeId: "asc" }, { filePath: "asc" }] },
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

/*
 * Removed: getMemberCommittees().
 *
 * It read PersonPosition rows with a committeeId, which the Knesset service
 * never produces — PositionIDs 41/42/66/67 ("יו״ר ועדה", "חבר ועדה" …) are
 * defined in KNS_Position but carry zero rows, and not one PersonToPosition row
 * has a CommitteeID. The member page's committees card was therefore empty for
 * every member. getCommitteesForMember() replaces it with something derivable:
 * the committees that actually discussed that member's bills.
 */

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

// ---------------------------------------------------------------------------
// Committees
// ---------------------------------------------------------------------------

/**
 * Committees of the term, with how much they actually did.
 *
 * The service publishes no membership: PositionIDs 41/42/66/67 ("יו״ר ועדה",
 * "חבר ועדה" …) are defined in KNS_Position but carry zero rows, and no
 * PersonToPosition row has a CommitteeID. So a committee is described here by
 * its activity — sittings held and bills handled — not by who sits on it.
 */
export async function listCommittees(knessetNum = 25) {
  const committees = await prisma.committee.findMany({
    where: { knessetNum },
    include: {
      _count: { select: { sessions: true, subcommittees: true } },
      parent: { select: { committeeId: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  // Aggregated in SQL: doing this in JS meant loading every sitting in the
  // term on each request, and an `IN` over their ids blows SQLite's bound
  // parameter limit for the busier committees.
  const counts = await prisma.$queryRaw<Array<{ committeeId: number; billItems: bigint | number }>>`
    SELECT cs."committeeId" AS "committeeId", COUNT(si."cmtSessionItemId") AS "billItems"
      FROM "SessionItem" si
      JOIN "CommitteeSession" cs ON cs."committeeSessionId" = si."committeeSessionId"
     WHERE si."billId" IS NOT NULL AND cs."committeeId" IS NOT NULL
     GROUP BY cs."committeeId"
  `;
  const byCommittee = new Map(counts.map((c) => [Number(c.committeeId), Number(c.billItems)]));

  return committees.map((c) => ({ ...c, billItems: byCommittee.get(c.committeeId) ?? 0 }));
}

export async function getCommittee(committeeId: number) {
  return prisma.committee.findUnique({
    where: { committeeId },
    include: {
      parent: { select: { committeeId: true, name: true } },
      subcommittees: {
        select: { committeeId: true, name: true, isCurrent: true, _count: { select: { sessions: true } } },
        orderBy: { name: "asc" },
      },
      jointParticipants: { include: { participant: { select: { committeeId: true, name: true } } } },
      jointMemberships: { include: { committee: { select: { committeeId: true, name: true } } } },
      _count: { select: { sessions: true } },
    },
  });
}

export async function getCommitteeSessions(committeeId: number, take = 25) {
  return prisma.committeeSession.findMany({
    where: { committeeId },
    orderBy: { startDate: "desc" },
    take,
    include: { _count: { select: { items: true, documents: true } } },
  });
}

/** Bills this committee has had on an agenda, most recently discussed first. */
export async function getCommitteeBills(committeeId: number, take = 25) {
  // Filter through the relation. Collecting the committee's session ids and
  // passing them as an `IN` list exceeded SQLite's bound parameter limit —
  // ועדת הכספים alone has 1,146 sittings.
  const where = { billId: { not: null }, session: { committeeId } } satisfies Prisma.SessionItemWhereInput;

  // How many times each bill came up, without pulling every row.
  const grouped = await prisma.sessionItem.groupBy({ by: ["billId"], where, _count: true });
  const discussions = new Map(grouped.map((g) => [g.billId!, g._count]));

  const rows = await prisma.sessionItem.findMany({
    where,
    orderBy: { session: { startDate: "desc" } },
    distinct: ["billId"],
    take,
    include: { bill: { include: { status: true } }, session: { select: { startDate: true } }, status: true },
  });

  return {
    rows: rows.map((r) => ({ ...r, discussions: discussions.get(r.billId!) ?? 1 })),
    total: grouped.length,
  };
}

/** Monthly sitting counts, for a committee activity chart. */
export async function getCommitteeActivity(committeeId: number) {
  const sessions = await prisma.committeeSession.findMany({
    where: { committeeId, startDate: { not: null } },
    select: { startDate: true },
  });
  const buckets = new Map<string, number>();
  for (const s of sessions) {
    const d = s.startDate!;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const keys = [...buckets.keys()].sort();
  if (keys.length === 0) return [];
  const [sy, sm] = keys[0].split("-").map(Number);
  const [ey, em] = keys[keys.length - 1].split("-").map(Number);
  const out: Array<{ month: string; total: number; lead: number }> = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    // Reuses the member chart's shape: `lead` is unused here.
    out.push({ month: key, total: buckets.get(key) ?? 0, lead: 0 });
  }
  return out;
}

/** Committees that discussed a given member's bills — a stand-in for the
 *  membership the service does not publish. */
export async function getCommitteesForMember(personId: number, take = 8) {
  const items = await prisma.sessionItem.findMany({
    where: { billId: { not: null }, bill: { initiators: { some: { personId } } } },
    include: { session: { select: { committeeId: true, committee: { select: { committeeId: true, name: true } } } } },
  });
  const counts = new Map<number, { committeeId: number; name: string; discussions: number }>();
  for (const i of items) {
    const c = i.session.committee;
    if (!c) continue;
    const e = counts.get(c.committeeId) ?? { committeeId: c.committeeId, name: c.name ?? "—", discussions: 0 };
    e.discussions += 1;
    counts.set(c.committeeId, e);
  }
  return [...counts.values()].sort((a, b) => b.discussions - a.discussions).slice(0, take);
}

// ---------------------------------------------------------------------------
// Committee attendance (parsed from protocols — see scripts/protocols/)
// ---------------------------------------------------------------------------

/**
 * A committee's membership, reconstructed from who attended its sittings.
 *
 * The service publishes no roster, so this is derived: every protocol lists its
 * attendees under `חברי הוועדה:` with the chair marked. Someone who never
 * attends will not appear, and the counts are attendance, not tenure.
 */
export async function getCommitteeMembership(committeeId: number, take = 20) {
  const rows = await prisma.$queryRaw<
    Array<{ personId: number; sittings: bigint | number; asChair: bigint | number; lastSeen: string | null }>
  >`
    SELECT p."personId"                                        AS "personId",
           COUNT(DISTINCT p."committeeSessionId")              AS "sittings",
           SUM(CASE WHEN p."role" = 'chair' THEN 1 ELSE 0 END) AS "asChair",
           MAX(cs."startDate")                                 AS "lastSeen"
      FROM "CommitteeParticipant" p
      JOIN "CommitteeSession" cs ON cs."committeeSessionId" = p."committeeSessionId"
     WHERE cs."committeeId" = ${committeeId}
       AND p."personId" IS NOT NULL
       AND p."role" IN ('member', 'chair')
     GROUP BY p."personId"
     ORDER BY "sittings" DESC
  `;
  if (rows.length === 0) return { members: [], totalSittings: 0, moreCount: 0 };

  const people = await prisma.person.findMany({
    where: { personId: { in: rows.map((r) => r.personId) } },
  });
  const byId = new Map(people.map((p) => [p.personId, p]));

  const totalSittings = await prisma.committeeSession.count({
    where: { committeeId, participants: { some: {} } },
  });

  const all = rows
    .map((r) => ({
      person: byId.get(r.personId)!,
      sittings: Number(r.sittings),
      asChair: Number(r.asChair),
      lastSeen: r.lastSeen ? new Date(r.lastSeen) : null,
    }))
    .filter((r) => r.person);

  // Attendance has a long tail — a busy committee shows 60+ people once every
  // occasional visitor is counted, which reads as a roster and is not one.
  return { totalSittings, members: all.slice(0, take), moreCount: Math.max(0, all.length - take) };
}

/** Committees a member actually sat in, by attendance. */
export async function getMemberCommitteeAttendance(personId: number, take = 10) {
  const rows = await prisma.$queryRaw<
    Array<{ committeeId: number; name: string | null; sittings: bigint | number; asChair: bigint | number }>
  >`
    SELECT c."committeeId"                                     AS "committeeId",
           c."name"                                            AS "name",
           COUNT(DISTINCT p."committeeSessionId")              AS "sittings",
           SUM(CASE WHEN p."role" = 'chair' THEN 1 ELSE 0 END) AS "asChair"
      FROM "CommitteeParticipant" p
      JOIN "CommitteeSession" cs ON cs."committeeSessionId" = p."committeeSessionId"
      JOIN "Committee" c        ON c."committeeId" = cs."committeeId"
     WHERE p."personId" = ${personId} AND p."role" IN ('member', 'chair')
     GROUP BY c."committeeId", c."name"
     ORDER BY "sittings" DESC
     LIMIT ${take}
  `;
  return rows.map((r) => ({
    committeeId: r.committeeId,
    name: r.name,
    sittings: Number(r.sittings),
    asChair: Number(r.asChair),
  }));
}

/** How much attendance data exists, for honest labelling in the UI. */
export async function getAttendanceCoverage() {
  const [rows, sittings, withData] = await Promise.all([
    prisma.committeeParticipant.count(),
    prisma.committeeSession.count(),
    prisma.committeeSession.count({ where: { participants: { some: {} } } }),
  ]);
  return { rows, sittings, withData };
}
