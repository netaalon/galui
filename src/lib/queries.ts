import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { factionNamesMatchingShort } from "@/lib/factions";
import type { MemberSort } from "@/lib/member-sort";
import type { QuestionFilter, QuestionSort } from "@/lib/question-sort";
import { FUNNEL_STAGES, GOV_JOINS_AT_RUNG, STATUS_RUNG } from "@/lib/funnel";

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
      // First-named sponsor. Not "the lead sponsor": `IsInitiator` is true on
      // 98% of rows and marks nothing useful, and even `Ordinal` 1 is shared by
      // more than one sponsor on 68 bills. See the knesset-odata skill.
      initiators: { orderBy: { ordinal: "asc" }, take: 1, include: { person: true } },
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
      votes: { orderBy: [{ ordinal: "asc" }] },
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
        initiators: { orderBy: { ordinal: "asc" }, take: 1, include: { person: true } },
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
      votes: { orderBy: [{ voteDateTime: "asc" }, { ordinal: "asc" }] },
      // Ordinal order, which is the order the Knesset lists them in. Sorting by
      // `IsInitiator` first implied a lead-sponsor distinction the feed does not
      // actually draw.
      initiators: { orderBy: { ordinal: "asc" }, include: { person: true } },
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
        // The site shows short faction names, so they have to be searchable:
        // ש"ס is registered under a name that does not contain those letters.
        { factionName: { in: factionNamesMatchingShort(w) } },
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

  // One series, not two. This used to stack "lead" against "co-signed" from
  // `IsInitiator`, which is true on 98% of rows — so every bar was one colour
  // with an occasional sliver, splitting the data on a distinction the feed
  // does not draw.
  const buckets = new Map<string, { month: string; total: number }>();
  for (const s of sponsorships) {
    const when = s.bill.firstStepDate;
    if (!when) continue;
    const key = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { month: key, total: 0 };
    bucket.total += 1;
    buckets.set(key, bucket);
  }

  // Months with no activity must still appear, otherwise a two-year gap renders
  // as two adjacent bars and the timeline reads as continuous work.
  const keys = [...buckets.keys()].sort();
  if (keys.length === 0) return [];
  const [startY, startM] = keys[0].split("-").map(Number);
  const [endY, endM] = keys[keys.length - 1].split("-").map(Number);
  const filled: Array<{ month: string; total: number }> = [];
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    filled.push(buckets.get(key) ?? { month: key, total: 0 });
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
  const out: Array<{ month: string; total: number }> = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, total: buckets.get(key) ?? 0 });
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
// ---------------------------------------------------------------------------
// Official committee rosters
//
// From KNS_PersonToPosition rows carrying a CommitteeID — the composition the
// Knesset actually appoints, as opposed to who turned up, which is what
// CommitteeParticipant records. The two are not interchangeable and both pages
// show them separately: Finance has 20 appointed members against 67 people who
// have attended it.
// ---------------------------------------------------------------------------

/** יו"ר ועדה. */
const POSITION_COMMITTEE_CHAIR = 41;
/**
 * חבר ועדה / חברת ועדה — the same role in masculine and feminine, not two
 * roles. 102 men hold 42 and 31 women hold 66, and nobody holds both on one
 * committee; splitting on them would split every roster by gender.
 */
const POSITION_COMMITTEE_MEMBER = [42, 66];
/** מ"מ חבר ועדה — a substitute, who is NOT a member. Counting them together
 *  inflates every committee: Finance has 20 members and 5 substitutes. */
const POSITION_COMMITTEE_SUBSTITUTE = 67;

const ROSTER_POSITIONS = [POSITION_COMMITTEE_CHAIR, ...POSITION_COMMITTEE_MEMBER, POSITION_COMMITTEE_SUBSTITUTE];

export type RosterSeat = {
  personToPositionId: number;
  role: "chair" | "member" | "substitute";
  startDate: Date | null;
  finishDate: Date | null;
  person: {
    personId: number;
    firstName: string | null;
    lastName: string | null;
    factionName: string | null;
    bloc: string | null;
    imageUrl: string | null;
    imageCredit: string | null;
  };
};

function seatRole(positionId: number): RosterSeat["role"] {
  if (positionId === POSITION_COMMITTEE_CHAIR) return "chair";
  if (positionId === POSITION_COMMITTEE_SUBSTITUTE) return "substitute";
  return "member";
}

/**
 * A committee's appointed composition, current seats and past ones separately.
 *
 * `isCurrent` is trustworthy here: across the term's 1,632 committee-position
 * rows, not one is flagged current while carrying a finish date, nor flagged
 * past without one.
 */
export async function getCommitteeRoster(committeeId: number, knessetNum = 25) {
  const rows = await prisma.personPosition.findMany({
    where: { committeeId, knessetNum, positionId: { in: ROSTER_POSITIONS } },
    orderBy: [{ positionId: "asc" }, { startDate: "asc" }],
    include: {
      person: {
        select: {
          personId: true, firstName: true, lastName: true,
          factionName: true, bloc: true, imageUrl: true, imageCredit: true,
        },
      },
    },
  });

  const seats: Array<RosterSeat & { isCurrent: boolean }> = rows.map((r) => ({
    personToPositionId: r.personToPositionId,
    role: seatRole(r.positionId),
    startDate: r.startDate,
    finishDate: r.finishDate,
    isCurrent: r.isCurrent,
    person: r.person,
  }));

  const current = seats.filter((s) => s.isCurrent);
  const past = seats.filter((s) => !s.isCurrent);

  // **A chair holds a member seat too**, on 71 of the term's 83 committees, so
  // the same person arrives here twice. That is correct upstream — the chair of
  // a committee is one of its members — but listing them in both groups shows
  // them twice, and counting both rows inflates the bloc split by one.
  //
  // So each person is placed once, in their strongest role: chair, else member,
  // else substitute. One person currently holds both a member and a substitute
  // seat, which the same rule settles.
  const chairs = current.filter((s) => s.role === "chair");
  const chairIds = new Set(chairs.map((s) => s.person.personId));
  const allMembers = current.filter((s) => s.role === "member");
  const memberIds = new Set(allMembers.map((s) => s.person.personId));

  const others = allMembers.filter((s) => !chairIds.has(s.person.personId));
  const substitutes = current.filter(
    (s) => s.role === "substitute" && !chairIds.has(s.person.personId) && !memberIds.has(s.person.personId),
  );

  // Blocs count people, not seats: everyone with a member seat, plus a chair
  // who somehow has none. Substitutes are not members and are left out.
  const onCommittee = new Map<number, (typeof current)[number]>();
  for (const s of [...chairs, ...allMembers]) onCommittee.set(s.person.personId, s);
  const blocs = new Map<string, number>();
  for (const s of onCommittee.values()) {
    const key = s.person.bloc ?? "unknown";
    blocs.set(key, (blocs.get(key) ?? 0) + 1);
  }

  return {
    chairs,
    /** Members other than the chair, who is listed above rather than twice. */
    members: others,
    substitutes,
    /** Everyone holding a seat, the chair counted once. */
    memberCount: onCommittee.size,
    /** Seats that have ended — a former chair or member. */
    past,
    /** Coalition/opposition split by person, chair counted once. */
    blocs,
    hasRoster: seats.length > 0,
  };
}

/**
 * The committee seats a member holds, and the ones they have held.
 *
 * One entry per committee per period, in the strongest role. A chair also holds
 * a member seat on the same committee, so the raw rows would list the committee
 * twice — once as יו"ר and once as חבר/ה.
 */
export async function getMemberCommitteeSeats(personId: number, knessetNum = 25) {
  const rows = await prisma.personPosition.findMany({
    where: { personId, knessetNum, positionId: { in: ROSTER_POSITIONS }, committeeId: { not: null } },
    // Chair first, so it wins the de-duplication below.
    orderBy: [{ isCurrent: "desc" }, { positionId: "asc" }],
    select: {
      personToPositionId: true, positionId: true, committeeId: true, committeeName: true,
      isCurrent: true, startDate: true, finishDate: true,
    },
  });

  // One entry per committee. The ordering above puts a serving seat and the
  // chair role first, so that is what survives — a member who sits on a
  // committee now does not also need a line saying they used to.
  const seen = new Set<number>();
  return rows
    .map((r) => ({ ...r, role: seatRole(r.positionId) }))
    .filter((r) => {
      const key = r.committeeId!;
      return seen.has(key) ? false : (seen.add(key), true);
    });
}

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

// ---------------------------------------------------------------------------
// Plenum votes
//
// These stand alone: a vote is not yet joined to its sitting, its bill or the
// members who cast it. `PlenumVoteResult.mkId` is a third Knesset person id
// space — see the note on the model — so names come from the columns the feed
// denormalises onto each result row.
// ---------------------------------------------------------------------------

export type VoteOutcome = "passed" | "failed" | "tied" | "unknown";

/** Whether a vote carried, from its own tallies. Abstentions do not count. */
export function voteOutcome(v: { forCount: number; againstCount: number; totalCount: number }): VoteOutcome {
  if (v.totalCount === 0) return "unknown";
  if (v.forCount > v.againstCount) return "passed";
  if (v.forCount < v.againstCount) return "failed";
  return "tied";
}

export async function listVotes({
  q,
  take = 50,
  skip = 0,
}: { q?: string; take?: number; skip?: number } = {}) {
  const where = q?.trim()
    ? { OR: [{ title: { contains: q.trim() } }, { subject: { contains: q.trim() } }] }
    : {};

  const [rows, total] = await Promise.all([
    prisma.plenumVote.findMany({
      where,
      orderBy: [{ voteDateTime: "desc" }, { ordinal: "desc" }],
      take,
      skip,
    }),
    prisma.plenumVote.count({ where }),
  ]);
  return { rows, total };
}

export async function getVoteStats() {
  const [total, onBills, earliest, latest, agg] = await Promise.all([
    prisma.plenumVote.count(),
    prisma.plenumVote.count({ where: { billId: { not: null } } }),
    prisma.plenumVote.findFirst({ orderBy: { voteDateTime: "asc" }, select: { voteDateTime: true } }),
    prisma.plenumVote.findFirst({ orderBy: { voteDateTime: "desc" }, select: { voteDateTime: true } }),
    prisma.plenumVote.aggregate({ _sum: { totalCount: true }, _avg: { totalCount: true } }),
  ]);
  return {
    total,
    onBills,
    earliest: earliest?.voteDateTime ?? null,
    latest: latest?.voteDateTime ?? null,
    ballots: agg._sum.totalCount ?? 0,
    avgTurnout: Math.round(agg._avg.totalCount ?? 0),
  };
}

export async function getVote(voteId: number) {
  return prisma.plenumVote.findUnique({
    where: { voteId },
    include: {
      session: { select: { plenumSessionId: true, name: true, startDate: true } },
      bill: { select: { billId: true, name: true, subTypeDesc: true } },
      results: {
        orderBy: [{ resultCode: "asc" }, { lastName: "asc" }],
        include: {
          person: {
            select: { personId: true, firstName: true, lastName: true, factionName: true, bloc: true },
          },
        },
      },
    },
  });
}

/**
 * A member's voting record: how they voted overall, and their most recent votes.
 *
 * Keyed on the derived `personId`, so it covers only the results whose name
 * resolved to exactly one person. `getVoteLinkage()` reports that coverage, and
 * the member page shows it rather than implying the record is complete.
 */
export async function getMemberVotingRecord(personId: number, take = 10) {
  const [byResult, recent, total] = await Promise.all([
    prisma.plenumVoteResult.groupBy({
      by: ["resultCode", "resultDesc"],
      where: { personId },
      _count: { _all: true },
      orderBy: { resultCode: "asc" },
    }),
    prisma.plenumVoteResult.findMany({
      where: { personId },
      take,
      orderBy: { vote: { voteDateTime: "desc" } },
      include: {
        vote: {
          select: {
            voteId: true, title: true, subject: true, voteDateTime: true,
            forCount: true, againstCount: true, abstainCount: true,
            presentCount: true, totalCount: true,
          },
        },
      },
    }),
    prisma.plenumVoteResult.count({ where: { personId } }),
  ]);
  return {
    total,
    byResult: byResult.map((r) => ({
      code: r.resultCode,
      label: r.resultDesc,
      count: r._count._all,
    })),
    recent,
  };
}

/** How much of the vote record is attached to a member, for honest labelling. */
export async function getVoteLinkage() {
  const [rows, linked, voters] = await Promise.all([
    prisma.plenumVoteResult.count(),
    prisma.plenumVoteResult.count({ where: { personId: { not: null } } }),
    prisma.plenumVoteResult.findMany({ distinct: ["mkId"], select: { mkId: true } }),
  ]);
  return { rows, linked, voterIds: voters.length };
}

// ---------------------------------------------------------------------------
// Agenda control
//
// These four measures are one finding from different angles: the coalition
// decides what reaches the floor and what dies there, including for its own
// members. They are deliberately presented together, because separately each
// invites a wrong reading — the bill graveyard in particular looks like a
// measure of sincerity until you notice the highest-volume tablers are all
// opposition members who cannot pass anything without coalition consent.
// ---------------------------------------------------------------------------

/** Head-to-head votes: what happens when the two blocs disagree. */
export async function getBlocHeadToHead() {
  const rows = await prisma.$queryRaw<Array<{ decided: number; coalitionWon: number; oppositionWon: number }>>`
    WITH pos AS (
      SELECT r."voteId", p."bloc",
             SUM(CASE WHEN r."resultCode" = 7 THEN 1 ELSE 0 END) AS f,
             SUM(CASE WHEN r."resultCode" = 8 THEN 1 ELSE 0 END) AS a
        FROM "PlenumVoteResult" r
        JOIN "Person" p ON p."personId" = r."personId"
       WHERE r."resultCode" IN (7, 8) AND p."bloc" IS NOT NULL
       GROUP BY r."voteId", p."bloc"
      HAVING f + a >= 5
    ),
    sides AS (
      SELECT c."voteId",
             CASE WHEN c.f > c.a THEN 7 WHEN c.a > c.f THEN 8 END AS coal,
             CASE WHEN o.f > o.a THEN 7 WHEN o.a > o.f THEN 8 END AS opp,
             v."forCount", v."againstCount",
             c.f + c.a AS coalVoted
        FROM pos c
        JOIN pos o ON o."voteId" = c."voteId" AND o."bloc" = 'opposition'
        JOIN "PlenumVote" v ON v."voteId" = c."voteId"
       WHERE c."bloc" = 'coalition'
    )
    SELECT COUNT(*) AS decided,
           SUM(CASE WHEN (CASE WHEN "forCount" > "againstCount" THEN 7 ELSE 8 END) = coal THEN 1 ELSE 0 END) AS "coalitionWon",
           SUM(CASE WHEN (CASE WHEN "forCount" > "againstCount" THEN 7 ELSE 8 END) = opp THEN 1 ELSE 0 END) AS "oppositionWon"
      FROM sides
     WHERE coal IS NOT NULL AND opp IS NOT NULL AND coal <> opp AND "forCount" <> "againstCount"
  `;
  const r = rows[0];
  return { decided: Number(r.decided), coalitionWon: Number(r.coalitionWon), oppositionWon: Number(r.oppositionWon) };
}

/**
 * The votes the government lost while present.
 *
 * Turnout matters: half the opposition's head-to-head wins are the coalition
 * failing to show up, which is a different thing from being outvoted. The
 * threshold keeps only the votes where it turned out and still lost.
 */
export async function getGovernmentDefeats(minCoalitionVoting = 30) {
  const rows = await prisma.$queryRaw<
    Array<{ voteId: number; voteDateTime: string | null; forCount: number; againstCount: number; totalCount: number; methodDesc: string | null; coalVoted: number; billId: number | null; title: string | null }>
  >`
    WITH pos AS (
      SELECT r."voteId", p."bloc",
             SUM(CASE WHEN r."resultCode" = 7 THEN 1 ELSE 0 END) AS f,
             SUM(CASE WHEN r."resultCode" = 8 THEN 1 ELSE 0 END) AS a
        FROM "PlenumVoteResult" r
        JOIN "Person" p ON p."personId" = r."personId"
       WHERE r."resultCode" IN (7, 8) AND p."bloc" IS NOT NULL
       GROUP BY r."voteId", p."bloc"
    )
    SELECT v."voteId", v."voteDateTime", v."forCount", v."againstCount", v."totalCount",
           v."methodDesc", (c.f + c.a) AS "coalVoted", v."billId", v."title"
      FROM pos c
      JOIN pos o ON o."voteId" = c."voteId" AND o."bloc" = 'opposition'
      JOIN "PlenumVote" v ON v."voteId" = c."voteId"
     WHERE c."bloc" = 'coalition'
       AND c.f + c.a >= ${minCoalitionVoting}
       AND o.f + o.a >= 5
       AND (CASE WHEN c.f > c.a THEN 7 WHEN c.a > c.f THEN 8 END) IS NOT NULL
       AND (CASE WHEN o.f > o.a THEN 7 WHEN o.a > o.f THEN 8 END) IS NOT NULL
       AND (CASE WHEN c.f > c.a THEN 7 ELSE 8 END) <> (CASE WHEN o.f > o.a THEN 7 ELSE 8 END)
       AND v."forCount" <> v."againstCount"
       AND (CASE WHEN v."forCount" > v."againstCount" THEN 7 ELSE 8 END)
           <> (CASE WHEN c.f > c.a THEN 7 ELSE 8 END)
     ORDER BY v."voteDateTime"
  `;
  return rows.map((r) => ({
    ...r,
    voteDateTime: r.voteDateTime ? new Date(r.voteDateTime) : null,
    coalVoted: Number(r.coalVoted),
  }));
}

/** Who supplies the votes that sink a private bill. */
export async function getPrivateBillKillers() {
  const rows = await prisma.$queryRaw<Array<{ sponsorBloc: string; votes: number; killedByOwn: number; avgOwnShare: number }>>`
    WITH sponsor AS (
      SELECT bi."billId", MIN(bi."ordinal") AS o FROM "BillInitiator" bi GROUP BY bi."billId"
    ),
    lead AS (
      SELECT s."billId", p."bloc" AS "sponsorBloc"
        FROM sponsor s
        JOIN "BillInitiator" bi ON bi."billId" = s."billId" AND bi."ordinal" = s.o
        JOIN "Person" p ON p."personId" = bi."personId"
       WHERE p."bloc" IS NOT NULL
    ),
    failed AS (
      SELECT v."voteId", l."sponsorBloc"
        FROM "PlenumVote" v
        JOIN "Bill" b ON b."billId" = v."billId"
        JOIN lead l ON l."billId" = v."billId"
       WHERE v."totalCount" >= 20 AND v."againstCount" > v."forCount" AND b."subTypeDesc" = 'פרטית'
    ),
    against AS (
      SELECT f."voteId", f."sponsorBloc",
             SUM(CASE WHEN p."bloc" = f."sponsorBloc" THEN 1 ELSE 0 END) AS own,
             COUNT(*) AS total
        FROM failed f
        JOIN "PlenumVoteResult" r ON r."voteId" = f."voteId" AND r."resultCode" = 8
        JOIN "Person" p ON p."personId" = r."personId" AND p."bloc" IS NOT NULL
       GROUP BY f."voteId", f."sponsorBloc"
    )
    SELECT "sponsorBloc", COUNT(*) AS votes,
           SUM(CASE WHEN own * 2 > total THEN 1 ELSE 0 END) AS "killedByOwn",
           ROUND(AVG(CAST(own AS REAL) / total) * 100, 1) AS "avgOwnShare"
      FROM against WHERE total >= 10 GROUP BY "sponsorBloc"
  `;
  return rows.map((r) => ({ ...r, votes: Number(r.votes), killedByOwn: Number(r.killedByOwn) }));
}

/**
 * Private bills by sponsor, and how far they got.
 *
 * `stalled` counts bills with at most one recorded appearance anywhere — tabled
 * and never taken up again. The median for a member with 20+ such bills is 65%,
 * so a high figure is the norm rather than a mark against anyone; the point of
 * showing volume beside conversion is that the two sort by bloc, not by member.
 */
export async function getSponsorThroughput(minBills = 20) {
  const rows = await prisma.$queryRaw<
    Array<{ personId: number; firstName: string | null; lastName: string | null; bloc: string | null; tabled: number; stalled: number; passed: number }>
  >`
    WITH ev AS (
      SELECT b."billId", b."statusId",
             (SELECT COUNT(*) FROM "PlenumSessionItem" pi WHERE pi."billId" = b."billId")
           + (SELECT COUNT(*) FROM "SessionItem" si WHERE si."billId" = b."billId") AS n
        FROM "Bill" b WHERE b."subTypeDesc" = 'פרטית'
    )
    SELECT p."personId", p."firstName", p."lastName", p."bloc",
           COUNT(*) AS tabled,
           SUM(CASE WHEN e.n <= 1 THEN 1 ELSE 0 END) AS stalled,
           SUM(CASE WHEN s."desc" = 'התקבלה בקריאה שלישית' THEN 1 ELSE 0 END) AS passed
      FROM "BillInitiator" bi
      JOIN ev e ON e."billId" = bi."billId"
      JOIN "Person" p ON p."personId" = bi."personId"
      LEFT JOIN "Status" s ON s."statusId" = e."statusId"
     WHERE bi."ordinal" = 1 AND p."isMk" = 1
     GROUP BY p."personId" HAVING tabled >= ${minBills}
     ORDER BY tabled DESC
  `;
  return rows.map((r) => ({ ...r, tabled: Number(r.tabled), stalled: Number(r.stalled), passed: Number(r.passed) }));
}

/** How far private bills get overall, so a member's figure has a baseline. */
export async function getBillProgressBaseline() {
  const rows = await prisma.$queryRaw<Array<{ bucket: string; n: number }>>`
    WITH ev AS (
      SELECT b."billId",
             (SELECT COUNT(*) FROM "PlenumSessionItem" pi WHERE pi."billId" = b."billId")
           + (SELECT COUNT(*) FROM "SessionItem" si WHERE si."billId" = b."billId") AS n
        FROM "Bill" b
    )
    SELECT CASE WHEN n = 0 THEN 'none' WHEN n = 1 THEN 'one' WHEN n <= 4 THEN 'few' ELSE 'many' END AS bucket,
           COUNT(*) AS n
      FROM ev GROUP BY 1
  `;
  const by = new Map(rows.map((r) => [r.bucket, Number(r.n)]));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return { total, none: by.get("none") ?? 0, one: by.get("one") ?? 0, few: by.get("few") ?? 0, many: by.get("many") ?? 0 };
}

/** Votes decided by a hair. */
export async function getClosestVotes(maxMargin = 2, minTurnout = 20, take = 20) {
  return prisma.plenumVote.findMany({
    where: { totalCount: { gte: minTurnout } },
    orderBy: [{ voteDateTime: "desc" }],
    include: { bill: { select: { billId: true, name: true } } },
  }).then((all) =>
    all
      .filter((v) => Math.abs(v.forCount - v.againstCount) <= maxMargin)
      .sort((a, b) => Math.abs(a.forCount - a.againstCount) - Math.abs(b.forCount - b.againstCount))
      .slice(0, take),
  );
}

/** For one bill: did its own sponsor's bloc supply the votes that sank it? */
export async function getBillOwnBlocOpposition(billId: number) {
  const rows = await prisma.$queryRaw<Array<{ voteId: number; own: number; total: number; sponsorBloc: string }>>`
    WITH sponsor AS (
      SELECT MIN("ordinal") AS o FROM "BillInitiator" WHERE "billId" = ${billId}
    ),
    lead AS (
      SELECT p."bloc" AS "sponsorBloc"
        FROM "BillInitiator" bi, sponsor s
        JOIN "Person" p ON p."personId" = bi."personId"
       WHERE bi."billId" = ${billId} AND bi."ordinal" = s.o AND p."bloc" IS NOT NULL
    )
    SELECT v."voteId", l."sponsorBloc",
           SUM(CASE WHEN p."bloc" = l."sponsorBloc" THEN 1 ELSE 0 END) AS own,
           COUNT(*) AS total
      FROM "PlenumVote" v, lead l
      JOIN "PlenumVoteResult" r ON r."voteId" = v."voteId" AND r."resultCode" = 8
      JOIN "Person" p ON p."personId" = r."personId" AND p."bloc" IS NOT NULL
     WHERE v."billId" = ${billId} AND v."againstCount" > v."forCount" AND v."totalCount" >= 20
     GROUP BY v."voteId", l."sponsorBloc"
     HAVING total >= 10
     ORDER BY CAST(own AS REAL) / total DESC
     LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { voteId: r.voteId, own: Number(r.own), total: Number(r.total), sponsorBloc: r.sponsorBloc };
}

/**
 * How far private bills get, as a funnel.
 *
 * Private bills only. Government bills follow a different path — they enter at
 * first reading and their committee stage comes *after* it, not before — so
 * plotting them on this ladder would credit them with a preliminary reading
 * they never had. Their pass rate is returned separately for contrast.
 */
export async function getBillFunnel() {
  const cases = Object.entries(STATUS_RUNG)
    .map(([id, rung]) => `WHEN ${Number(id)} THEN ${rung}`)
    .join(" ");

  const rows = await prisma.$queryRawUnsafe<
    Array<{ subType: string | null; bloc: string | null; faction: string | null; rung: number; n: number }>
  >(`
    WITH st AS (
      SELECT "billId", "statusId" FROM "Bill" WHERE "statusId" IS NOT NULL
      UNION ALL SELECT "billId", "statusId" FROM "PlenumSessionItem" WHERE "billId" IS NOT NULL AND "statusId" IS NOT NULL
      UNION ALL SELECT "billId", "statusId" FROM "SessionItem" WHERE "billId" IS NOT NULL AND "statusId" IS NOT NULL
    ),
    rung AS (
      SELECT b."billId", b."subTypeDesc" AS "subType",
             MAX(CASE s."statusId" ${cases} ELSE -1 END) AS rung
        FROM st s JOIN "Bill" b ON b."billId" = s."billId"
       GROUP BY b."billId"
    )
    SELECT r."subType", p."bloc", TRIM(p."factionName") AS faction, r.rung, COUNT(*) AS n
      FROM rung r
      LEFT JOIN "BillInitiator" bi ON bi."billId" = r."billId" AND bi."ordinal" = 1
      LEFT JOIN "Person" p ON p."personId" = bi."personId"
     GROUP BY 1, 2, 3, 4
  `);

  const stageCount = FUNNEL_STAGES.length;
  const cumulative = (byRung: Map<number, number>) =>
    Array.from({ length: stageCount }, (_, i) =>
      [...byRung.entries()].reduce((sum, [r, n]) => (r >= i ? sum + n : sum), 0),
    );

  const bucket = (pick: (r: (typeof rows)[number]) => string | null, only: (r: (typeof rows)[number]) => boolean) => {
    const out = new Map<string, Map<number, number>>();
    for (const r of rows) {
      if (!only(r)) continue;
      const key = pick(r);
      if (!key) continue;
      const m = out.get(key) ?? new Map<number, number>();
      m.set(Number(r.rung), (m.get(Number(r.rung)) ?? 0) + Number(r.n));
      out.set(key, m);
    }
    return out;
  };

  const isPrivate = (r: (typeof rows)[number]) => r.subType === "פרטית" && Number(r.rung) >= 0;
  const total = bucket(() => "all", isPrivate);
  const govOnPrivateLadder = bucket(() => "government", (r) => r.subType === "ממשלתית" && Number(r.rung) >= 0);
  const byBloc = bucket((r) => r.bloc, isPrivate);
  const byFaction = bucket((r) => r.faction, isPrivate);

  const toSeries = (m: Map<string, Map<number, number>>, minTotal = 0) =>
    [...m.entries()]
      .map(([key, byRung]) => {
        const counts = cumulative(byRung);
        return { key, counts, total: counts[0], passed: counts[stageCount - 1] };
      })
      .filter((s) => s.total >= minTotal)
      .sort((a, b) => b.total - a.total);

  // Government bills on the private ladder, so both kinds share one chart.
  // Their line starts at the first-reading tabling: not one of the 638 has a
  // furthest rung below it, so the cumulative counts at the preliminary rungs
  // are artifacts of "at least this far" rather than stages they passed.
  const govSeries = toSeries(govOnPrivateLadder)[0];

  return {
    stages: [...FUNNEL_STAGES],
    total: toSeries(total)[0] ?? { key: "all", counts: [], total: 0, passed: 0 },
    /** Government bills placed on the private ladder, joining at rung 3. */
    governmentOnLadder: govSeries
      ? { ...govSeries, startAt: GOV_JOINS_AT_RUNG, total: govSeries.counts[GOV_JOINS_AT_RUNG] ?? 0 }
      : { key: "government", counts: [], total: 0, passed: 0, startAt: GOV_JOINS_AT_RUNG },
    byBloc: toSeries(byBloc),
    // 40 keeps the tail out — a faction with 11 bills and one law reads as a 9%
    // success rate, which is noise dressed as a finding — and eight lines is
    // already the most a reader can follow.
    byFaction: toSeries(byFaction, 40).slice(0, 8),
  };
}
