import "server-only";
import { prisma } from "@/lib/db";

/** Bills whose upstream record changed most recently. */
export async function getRecentBills(take = 5) {
  return prisma.bill.findMany({
    orderBy: { lastUpdatedDate: "desc" },
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
  return { bills, members, sessions, committees, discussions, protocols, plenumSittings, readings };
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
      orderBy: { lastUpdatedDate: "desc" },
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

export async function listMembers(opts: { q?: string; onlyServing?: boolean } = {}) {
  const { q, onlyServing = false } = opts;
  return prisma.person.findMany({
    where: {
      isMk: true,
      ...(onlyServing ? { mkEndDate: null } : {}),
      ...(q
        ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { factionName: { contains: q } }] }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { _count: { select: { billsInitiated: true } } },
  });
}

export async function getMember(personId: number) {
  return prisma.person.findUnique({
    where: { personId },
    include: {
      positions: { orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }] },
      billsInitiated: {
        orderBy: [{ bill: { lastUpdatedDate: "desc" } }],
        include: { bill: { include: { status: true, committee: true } } },
      },
    },
  });
}

/**
 * Bills sponsored per month, for the member activity chart.
 *
 * A bill's date is its publication date where the Knesset has published one,
 * falling back to the last-updated stamp so bills still in progress (which is
 * most private members' bills) still register on the chart.
 */
export async function getMemberActivityByMonth(personId: number) {
  const sponsorships = await prisma.billInitiator.findMany({
    where: { personId },
    include: { bill: { select: { publicationDate: true, lastUpdatedDate: true, subTypeDesc: true } } },
  });

  const buckets = new Map<string, { month: string; total: number; lead: number }>();
  for (const s of sponsorships) {
    const when = s.bill.publicationDate ?? s.bill.lastUpdatedDate;
    if (!when) continue;
    const key = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { month: key, total: 0, lead: 0 };
    bucket.total += 1;
    if (s.isInitiator) bucket.lead += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
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
      orderBy: { lastUpdatedDate: "desc" },
      take,
      include: { status: true },
    }),
    prisma.person.findMany({
      where: {
        isMk: true,
        OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { factionName: { contains: q } }],
      },
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
