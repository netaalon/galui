/**
 * Galui ETL — pulls the 25th Knesset from the official Knesset OData v4 service
 * into the local SQLite database.
 *
 *   npx tsx scripts/fetch-odata.ts
 *   npx tsx scripts/fetch-odata.ts --knesset=25 --bills=100 --sessions=100
 *
 * Safe to re-run: every write is an upsert keyed on the OData primary key.
 */

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { blocFor, unmappedFactions } from "../src/lib/factions.js";
import { ODATA_BASE, ODATA_V2_BASE, chunk, count, fetchAll, fetchByIds, parseBool, parseDate } from "./lib/odata.js";

// ---------------------------------------------------------------------------
// OData row shapes (only the fields we persist)
// ---------------------------------------------------------------------------

interface RawStatus { Id: number; Desc: string | null; TypeDesc: string | null; IsActive: boolean | null }
interface RawFaction { Id: number; Name: string | null; KnessetNum: number | null; StartDate: string | null; FinishDate: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawCommittee { Id: number; Name: string | null; CategoryDesc: string | null; KnessetNum: number | null; CommitteeTypeDesc: string | null; ParentCommitteeID: number | null; CommitteeParentName: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawPerson { Id: number; FirstName: string | null; LastName: string | null; GenderDesc: string | null; Email: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
/** Read from v2, so this keeps v2's field names. See ingestPeople. */
interface RawMkSiteCode { MKSiteCode: string; KnsID: number; SiteId: number }
interface RawPersonToPosition { Id: number; PersonID: number; PositionID: number; KnessetNum: number | null; StartDate: string | null; FinishDate: string | null; FactionID: number | null; FactionName: string | null; DutyDesc: string | null; CommitteeID: number | null; CommitteeName: string | null; GovMinistryName: string | null; GovernmentNum: number | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawPosition { Id: number; Description: string | null }
interface RawBill { Id: number; KnessetNum: number | null; Name: string | null; SubTypeID: number | null; SubTypeDesc: string | null; PrivateNumber: number | null; Number: number | null; CommitteeID: number | null; StatusID: number | null; PostponementReasonDesc: string | null; PublicationDate: string | null; SummaryLaw: string | null; PublicationSeriesDesc: string | null; IsContinuationBill: boolean | null; LastUpdatedDate: string | null }
interface RawBillInitiator { Id: number; BillID: number; PersonID: number; IsInitiator: boolean | null; Ordinal: number | null; LastUpdatedDate: string | null }
interface RawCommitteeSession { Id: number; Number: number | null; KnessetNum: number | null; TypeDesc: string | null; CommitteeID: number | null; StatusDesc: string | null; Location: string | null; SessionUrl: string | null; BroadcastUrl: string | null; StartDate: string | null; FinishDate: string | null; Note: string | null; LastUpdatedDate: string | null }
interface RawCmtSessionItem { Id: number; ItemID: number | null; ItemTypeID: number | null; CommitteeSessionID: number; Ordinal: number | null; StatusID: number | null; Name: string | null; LastUpdatedDate: string | null }
interface RawSessionDocument { Id: number; CommitteeSessionID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }
interface RawItemType { Id: number; Desc: string | null }
interface RawBroadcast { Id: number; BroadcastId: number | null; BroadcastUrl: string | null }
interface RawJointCommittee { Id: number; CommitteeID: number; ParticipantCommitteeID: number; LastUpdatedDate: string | null }
interface RawGovMinistry { Id: number; Name: string | null; IsActive: boolean | null; LastUpdatedDate: string | null }
interface RawQuery { Id: number; Number: number | null; KnessetNum: number | null; Name: string | null; TypeID: number | null; TypeDesc: string | null; StatusID: number | null; PersonID: number | null; GovMinistryID: number | null; SubmitDate: string | null; ReplyMinisterDate: string | null; ReplyDatePlanned: string | null; LastUpdatedDate: string | null }
/**
 * Lower-cased on purpose: unlike every other entity here, this one is not
 * served through OData. See ingestQuestionDocuments.
 */
interface RawQueryDocument { id: number; queryID: number; groupTypeID: number | null; groupTypeDesc: string | null; applicationDesc: string | null; filePath: string | null; lastUpdatedDate: string | null }
interface RawBillDocument { Id: number; BillID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }
interface RawPlenumSession { Id: number; Number: number | null; KnessetNum: number | null; Name: string | null; StartDate: string | null; FinishDate: string | null; IsSpecialMeeting: boolean | null; LastUpdatedDate: string | null }
interface RawPlmSessionItem { Id: number; ItemID: number | null; PlenumSessionID: number; ItemTypeID: number | null; ItemTypeDesc: string | null; Ordinal: number | string | null; Name: string | null; StatusID: number | null; IsDiscussion: number | null; LastUpdatedDate: string | null }
interface RawPlenumDocument { Id: number; PlenumSessionID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function arg(name: string, fallback: number | undefined): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const KNESSET = arg("knesset", 25)!;

/**
 * The ETL mirrors the whole term by default.
 *
 * It used to take a sample, and every gap that produced looked like a bug in
 * the app rather than a missing row: bills on a sitting's agenda with nowhere
 * to link, timelines missing the committee stage that produced a reading, 95%
 * of committee items absent for backfilled bills. A partial mirror cannot be
 * told apart from broken data by anyone using the site.
 *
 * The limits survive only as an escape hatch for quick local iteration
 * (`--bills=100`); leaving them unset ingests everything.
 */
const BILL_LIMIT = arg("bills", undefined);
const SESSION_LIMIT = arg("sessions", undefined);
const PLENUM_AGENDA_LIMIT = arg("plenum", undefined);

/** KNS_Position ids that mean "this person is a Knesset Member". */
const POSITION_MK = [43, 61]; // חבר הכנסת / חברת הכנסת
/** KNS_Position id carrying the person's faction. */
const POSITION_FACTION_MEMBER = 54; // חבר/ת סיעה
/** Roles worth surfacing on a member card, most senior first. */
const NOTABLE_POSITIONS = [45, 73, 31, 50, 65, 122, 123, 39, 57, 40, 59, 131, 130, 29, 30, 48, 41, 70, 71];
/** Positions that make someone a member of the government. */
const GOVERNMENT_POSITIONS = [45, 73, 51, 31, 50, 65, 39, 57, 40, 59];
/** KNS_ItemType id for a bill. */
const ITEM_TYPE_BILL = 2;

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function step(msg: string) { console.log(`\n[${stamp()}] ${msg}`); }
function done(msg: string) { console.log(`  ✓ ${msg}`); }

/**
 * Document URLs arrive with mixed separators — v4 writes bill paths as
 * `https://fs.knesset.gov.il/25\law\25_lst_2807878.docx` where v2 wrote the
 * same file with forward slashes, and the committee and plenum tables use
 * forward slashes in both feeds. A backslash never means anything in a URL
 * path, so normalise: the link is tidier, and the path becomes a stable
 * identity for the file across both feeds.
 */
function normaliseFilePath(path: string | null): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

/**
 * The row key is the document id paired with ApplicationID.
 *
 * v2 forced this: it reused one id across a document's published formats, so
 * the id alone collided. v4 gives every row a distinct `Id`, which would make
 * the plain id enough — but the pairing is still a correct key, and changing
 * the format would rewrite every document row and invalidate the attendance
 * cache, which is keyed on it, for no gain.
 */
function docKey(documentId: string | number, applicationId: number | null): { id: string; applicationId: number } {
  const appId = applicationId ?? 0;
  return { id: `${documentId}:${appId}`, applicationId: appId };
}

/** Run upserts in batches so a large entity does not become one huge transaction. */
async function writeBatched<T>(rows: T[], toOp: (row: T) => Promise<unknown>, size = 250): Promise<number> {
  let written = 0;
  for (const part of chunk(rows, size)) {
    await prisma.$transaction(part.map((r) => toOp(r) as never));
    written += part.length;
    process.stdout.write(`\r  … ${written}/${rows.length}`);
  }
  if (rows.length) process.stdout.write("\r".padEnd(30) + "\r");
  return written;
}

async function record(entity: string, fetched: number, written: number, ok: boolean, message?: string) {
  await prisma.ingestRun.create({
    data: { entity, finishedAt: new Date(), rowsFetched: fetched, rowsWritten: written, ok, message },
  });
}

// ---------------------------------------------------------------------------
// Ingest steps
// ---------------------------------------------------------------------------

async function ingestStatuses() {
  step("KNS_Status — bill / item status labels");
  const rows = await fetchAll<RawStatus>("KNS_Status");
  const n = await writeBatched(rows, (r) => {
    const data = { statusId: r.Id, desc: r.Desc, typeDesc: r.TypeDesc, isActive: parseBool(r.IsActive) };
    return prisma.status.upsert({ where: { statusId: r.Id }, create: data, update: data });
  });
  await record("KNS_Status", rows.length, n, true);
  done(`${n} statuses`);
}

async function ingestFactions() {
  step("KNS_Faction");
  // Not filtered by Knesset: bills and members reach back into earlier terms.
  const rows = await fetchAll<RawFaction>("KNS_Faction");
  const n = await writeBatched(rows, (r) => {
    const data = {
      factionId: r.Id, name: r.Name, knessetNum: r.KnessetNum,
      startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      isCurrent: parseBool(r.IsCurrent), lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.faction.upsert({ where: { factionId: r.Id }, create: data, update: data });
  });
  await record("KNS_Faction", rows.length, n, true);
  done(`${n} factions`);
}

/**
 * Committees reference their parent committee, so a row can only be written
 * once its parent exists. The feed does not guarantee that order — one of the
 * 2,901 rows arrives before its parent — and against an empty database that is
 * a foreign key violation on the first batch. Sort by depth in the parent
 * chain, and drop a parent id the feed does not itself define.
 */
function orderParentsFirst(rows: RawCommittee[]): RawCommittee[] {
  const known = new Set(rows.map((r) => r.Id));
  const parentOf = new Map(rows.map((r) => [r.Id, r.ParentCommitteeID]));

  const depth = (id: number) => {
    let d = 0;
    for (let p = parentOf.get(id); p != null && known.has(p) && d < 50; p = parentOf.get(p)) d++;
    return d;
  };
  return [...rows].sort((a, b) => depth(a.Id) - depth(b.Id));
}

async function ingestCommittees() {
  step("KNS_Committee");
  const rows = await fetchAll<RawCommittee>("KNS_Committee");
  const known = new Set(rows.map((r) => r.Id));
  const orphaned = rows.filter((r) => r.ParentCommitteeID != null && !known.has(r.ParentCommitteeID)).length;

  const n = await writeBatched(orderParentsFirst(rows), (r) => {
    const parentCommitteeId = r.ParentCommitteeID != null && known.has(r.ParentCommitteeID) ? r.ParentCommitteeID : null;
    const data = {
      committeeId: r.Id, name: r.Name, categoryDesc: r.CategoryDesc, knessetNum: r.KnessetNum,
      committeeTypeDesc: r.CommitteeTypeDesc, parentCommitteeId,
      parentName: r.CommitteeParentName, isCurrent: parseBool(r.IsCurrent),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.committee.upsert({ where: { committeeId: r.Id }, create: data, update: data });
  });
  await record("KNS_Committee", rows.length, n, true, orphaned ? `${orphaned} parent ids not in the feed` : undefined);
  done(`${n} committees${orphaned ? ` (${orphaned} with an unknown parent, unlinked)` : ""}`);
}

async function ingestPeople() {
  step("KNS_Person + KNS_MkSiteCode");
  // ~1.2k people in total — small enough to mirror wholesale, which keeps every
  // bill-initiator foreign key resolvable regardless of which term they served.
  const [people, siteCodes] = await Promise.all([
    fetchAll<RawPerson>("KNS_Person"),
    // The one table still read from the deprecated v2 service, because v4's
    // copy is broken: both feeds carry the same 1,115 rows with the same
    // SiteIds, but 177 of v4's `KnsID` values point at people who do not exist
    // in KNS_Person, so those rows resolve to nobody. v2's all resolve, and
    // Wikidata's P9770 confirms v2 is the correct mapping — SiteId 953 is
    // אמיר אוחנה in both. Taking v4 here would strip the SiteId from 105 of the
    // 151 members of this Knesset, and SiteId is the key the photo pipeline
    // joins on. Revisit when the resolution rate below stops complaining.
    fetchAll<RawMkSiteCode>("KNS_MkSiteCode", { base: ODATA_V2_BASE }),
  ]);
  const codeByPerson = new Map(siteCodes.map((s) => [s.KnsID, String(s.MKSiteCode)]));
  const siteIdByPerson = new Map(siteCodes.map((s) => [s.KnsID, s.SiteId]));

  const n = await writeBatched(people, (r) => {
    const data = {
      personId: r.Id, firstName: r.FirstName, lastName: r.LastName,
      genderDesc: r.GenderDesc, email: r.Email, isCurrent: parseBool(r.IsCurrent),
      mkSiteCode: codeByPerson.get(r.Id) ?? null,
      siteId: siteIdByPerson.get(r.Id) ?? null,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.person.upsert({ where: { personId: r.Id }, create: data, update: data });
  });
  const resolved = people.filter((p) => codeByPerson.has(p.Id)).length;
  if (resolved < siteCodes.length) {
    console.warn(`  ! ${siteCodes.length - resolved} of ${siteCodes.length} site codes name a person the feed does not publish`);
  }
  await record("KNS_Person", people.length, n, true, `${resolved}/${siteCodes.length} site codes resolved`);
  done(`${n} people (${resolved} with a site code)`);
}

/**
 * A member's headline role, as a label.
 *
 * `DutyDesc` is the Knesset's own phrasing and wins when it exists. Otherwise
 * the position description alone is often too vague to be useful — v4's
 * committee rows describe 143 chairmanships as the bare "יו\"ר ועדה" — so name
 * the committee when the row carries one.
 */
function describePosition(
  row: RawPersonToPosition,
  descById: Map<number, string | null>,
): string | null {
  if (row.DutyDesc) return row.DutyDesc;
  const desc = descById.get(row.PositionID) ?? null;
  if (!desc || !row.CommitteeName) return desc;
  // Every committee-bearing position description ends in the generic word the
  // committee name already carries, so joining them naively stutters:
  // "יו\"ר ועדה — הוועדה המיוחדת לזכויות הילד". Drop the generic word and the
  // Hebrew reads as the Knesset writes it: "יו\"ר הוועדה המיוחדת לזכויות הילד".
  const prefix = desc.replace(/\s+ועדה$/, "");
  return prefix === desc ? `${desc} — ${row.CommitteeName}` : `${prefix} ${row.CommitteeName}`;
}

async function ingestPositions() {
  step(`KNS_PersonToPosition — Knesset ${KNESSET}`);
  const [rows, positionTypes] = await Promise.all([
    fetchAll<RawPersonToPosition>("KNS_PersonToPosition", { filter: `KnessetNum eq ${KNESSET}` }),
    fetchAll<RawPosition>("KNS_Position"),
  ]);
  const descById = new Map(positionTypes.map((p) => [p.Id, p.Description]));

  // Only keep rows whose person we actually mirrored, so the FK holds.
  const known = new Set((await prisma.person.findMany({ select: { personId: true } })).map((p) => p.personId));
  const usable = rows.filter((r) => known.has(r.PersonID));

  const n = await writeBatched(usable, (r) => {
    const data = {
      personToPositionId: r.Id, personId: r.PersonID, positionId: r.PositionID,
      positionDesc: descById.get(r.PositionID) ?? null, knessetNum: r.KnessetNum,
      startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      factionId: r.FactionID, factionName: r.FactionName, dutyDesc: r.DutyDesc,
      committeeId: r.CommitteeID, committeeName: r.CommitteeName,
      govMinistryName: r.GovMinistryName, governmentNum: r.GovernmentNum,
      isCurrent: parseBool(r.IsCurrent),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.personPosition.upsert({ where: { personToPositionId: r.Id }, create: data, update: data });
  });
  await record("KNS_PersonToPosition", rows.length, n, true);
  done(`${n} positions`);

  // --- Derive the "MK" view the OData service does not provide -------------
  step("Deriving MK flags, factions, blocs and government roles");
  // The term spans two governments; only the highest-numbered one is sitting.
  const currentGovernment = Math.max(
    ...usable.map((r) => r.GovernmentNum ?? 0),
    0,
  );
  console.log(`  sitting government: ${currentGovernment}`);
  const byPerson = new Map<number, RawPersonToPosition[]>();
  for (const r of usable) {
    const list = byPerson.get(r.PersonID) ?? [];
    list.push(r);
    byPerson.set(r.PersonID, list);
  }

  const updates: Array<{ personId: number; data: Record<string, unknown> }> = [];
  for (const [personId, list] of byPerson) {
    const mkRows = list.filter((r) => POSITION_MK.includes(r.PositionID));
    if (mkRows.length === 0) continue;

    const factionRow = list
      .filter((r) => r.PositionID === POSITION_FACTION_MEMBER && r.FactionID != null)
      .sort((a, b) => Number(parseBool(b.IsCurrent)) - Number(parseBool(a.IsCurrent)))[0];

    const notable = list
      .filter((r) => NOTABLE_POSITIONS.includes(r.PositionID))
      .sort((a, b) => NOTABLE_POSITIONS.indexOf(a.PositionID) - NOTABLE_POSITIONS.indexOf(b.PositionID))[0];

    const starts = mkRows.map((r) => parseDate(r.StartDate)).filter((d): d is Date => d !== null);
    // A term that is still running has no finish date — keep the end null.
    const stillServing = mkRows.some((r) => r.FinishDate == null);
    const ends = mkRows.map((r) => parseDate(r.FinishDate)).filter((d): d is Date => d !== null);

    // A role in the *sitting* government only. Knesset 25 opened while the 36th
    // government was still in office, so its ministers appear here too and must
    // not be shown as serving ministers.
    const govRow = list
      .filter((r) => GOVERNMENT_POSITIONS.includes(r.PositionID))
      .filter((r) => r.GovernmentNum === currentGovernment)
      .filter((r) => parseBool(r.IsCurrent) || r.FinishDate == null)
      .sort((a, b) => GOVERNMENT_POSITIONS.indexOf(a.PositionID) - GOVERNMENT_POSITIONS.indexOf(b.PositionID))[0];

    const governmentRole = govRow
      ? (govRow.DutyDesc ?? [descById.get(govRow.PositionID), govRow.GovMinistryName].filter(Boolean).join(" — ") ?? null)
      : null;

    updates.push({
      personId,
      data: {
        isMk: true,
        knessetNum: KNESSET,
        factionId: factionRow?.FactionID ?? null,
        factionName: factionRow?.FactionName?.trim() ?? null,
        bloc: blocFor(factionRow?.FactionID),
        governmentRole,
        isMinister: govRow != null,
        roleDesc: notable ? describePosition(notable, descById) : null,
        mkStartDate: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
        mkEndDate: stillServing || ends.length === 0 ? null : new Date(Math.max(...ends.map((d) => d.getTime()))),
      },
    });
  }

  await writeBatched(updates, (u) => prisma.person.update({ where: { personId: u.personId }, data: u.data }));
  const ministers = updates.filter((u) => u.data.isMinister).length;
  const unBloc = updates.filter((u) => u.data.bloc == null).length;
  done(`${updates.length} members flagged · ${ministers} in the sitting government · ${unBloc} without a bloc`);

  // A faction missing from the curated map silently loses its bloc badge, so say so.
  const missing = unmappedFactions(updates.map((u) => u.data.factionId as number | null));
  if (missing.length) {
    console.warn(`  ! factions absent from src/lib/factions.ts: ${missing.join(", ")} — their members will show no bloc`);
  }
}

async function ingestBills(): Promise<number[]> {
  step(`KNS_Bill — ${BILL_LIMIT ? `${BILL_LIMIT} most recently updated` : "all"} in Knesset ${KNESSET}`);
  const total = await count("KNS_Bill", `KnessetNum eq ${KNESSET}`);
  const rows = await fetchAll<RawBill>("KNS_Bill", {
    filter: `KnessetNum eq ${KNESSET}`,
    orderby: "LastUpdatedDate desc",
    limit: BILL_LIMIT,
  });

  const knownCommittees = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const n = await writeBatched(rows, (r) => {
    const data = {
      billId: r.Id, knessetNum: r.KnessetNum, name: r.Name,
      subTypeId: r.SubTypeID, subTypeDesc: r.SubTypeDesc,
      privateNumber: r.PrivateNumber, number: r.Number,
      committeeId: r.CommitteeID != null && knownCommittees.has(r.CommitteeID) ? r.CommitteeID : null,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      postponementReasonDesc: r.PostponementReasonDesc,
      publicationDate: parseDate(r.PublicationDate),
      summaryLaw: r.SummaryLaw, publicationSeriesDesc: r.PublicationSeriesDesc,
      isContinuationBill: r.IsContinuationBill,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.bill.upsert({ where: { billId: r.Id }, create: data, update: data });
  });
  await record("KNS_Bill", rows.length, n, true, `${total} available upstream`);
  done(`${n} bills (of ${total} in Knesset ${KNESSET})`);
  return rows.map((r) => r.Id);
}

async function ingestBillInitiators(billIds: number[]) {
  step("KNS_BillInitiator — sponsors of the ingested bills");
  const rows = await fetchByIds<RawBillInitiator>("KNS_BillInitiator", "BillID", billIds, { label: "initiators" });
  const knownPeople = new Set((await prisma.person.findMany({ select: { personId: true } })).map((p) => p.personId));
  const usable = rows.filter((r) => knownPeople.has(r.PersonID));

  const n = await writeBatched(usable, (r) => {
    const data = {
      billInitiatorId: r.Id, billId: r.BillID, personId: r.PersonID,
      isInitiator: parseBool(r.IsInitiator), ordinal: r.Ordinal,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.billInitiator.upsert({ where: { billInitiatorId: r.Id }, create: data, update: data });
  });
  await record("KNS_BillInitiator", rows.length, n, true);
  done(`${n} sponsorships${rows.length - usable.length ? ` (${rows.length - usable.length} skipped: unknown person)` : ""}`);
}

/** Session items for the ingested bills — these drive the bill timeline. */
async function findSessionsForBills(billIds: number[]): Promise<{ items: RawCmtSessionItem[]; sessionIds: number[] }> {
  step("KNS_CmtSessionItem — committee discussions of the ingested bills");
  const items = await fetchByIds<RawCmtSessionItem>("KNS_CmtSessionItem", "ItemID", billIds, {
    prefix: `ItemTypeID eq ${ITEM_TYPE_BILL}`,
    label: "bill committee items",
  });
  const sessionIds = [...new Set(items.map((i) => i.CommitteeSessionID))];
  done(`${items.length} discussions across ${sessionIds.length} sessions`);
  return { items, sessionIds };
}

async function ingestSessions(extraSessionIds: number[]): Promise<number[]> {
  step(`KNS_CommitteeSession — ${SESSION_LIMIT ? `${SESSION_LIMIT} most recent` : "all"} in Knesset ${KNESSET}`);
  const rows = await fetchAll<RawCommitteeSession>("KNS_CommitteeSession", {
    filter: `KnessetNum eq ${KNESSET}`,
    orderby: "StartDate desc",
    limit: SESSION_LIMIT,
  });

  // Bills can be discussed in sittings of an earlier term; pull those in too.
  const have = new Set(rows.map((r) => r.Id));
  const missing = extraSessionIds.filter((id) => !have.has(id));
  rows.push(...(await fetchByIds<RawCommitteeSession>("KNS_CommitteeSession", "Id", missing, { label: "extra sessions" })));

  const knownCommittees = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const n = await writeBatched(rows, (r) => {
    const data = {
      committeeSessionId: r.Id, number: r.Number, knessetNum: r.KnessetNum,
      typeDesc: r.TypeDesc,
      committeeId: r.CommitteeID != null && knownCommittees.has(r.CommitteeID) ? r.CommitteeID : null,
      statusDesc: r.StatusDesc, location: r.Location, sessionUrl: r.SessionUrl,
      broadcastUrl: r.BroadcastUrl, startDate: parseDate(r.StartDate),
      finishDate: parseDate(r.FinishDate), note: r.Note,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.committeeSession.upsert({ where: { committeeSessionId: r.Id }, create: data, update: data });
  });
  await record("KNS_CommitteeSession", rows.length, n, true);
  done(`${n} sessions (${missing.length} pulled in for bill timelines)`);
  return rows.map((r) => r.Id);
}

/** Fetch every agenda item for the ingested sessions (bill items already in hand). */
async function collectSessionItems(billItems: RawCmtSessionItem[], sessionIds: number[]): Promise<RawCmtSessionItem[]> {
  step("KNS_CmtSessionItem — full agendas of the ingested sessions");
  const items = [...billItems];
  const seen = new Set(items.map((i) => i.Id));
  const fetched = await fetchByIds<RawCmtSessionItem>("KNS_CmtSessionItem", "CommitteeSessionID", sessionIds, { label: "agendas" });
  for (const row of fetched) {
    if (!seen.has(row.Id)) { seen.add(row.Id); items.push(row); }
  }
  done(`${items.length} agenda items`);
  return items;
}

/**
 * Agenda items — committee and plenum alike — routinely reference bills outside
 * the "most recently updated" window. Pulling those in is what makes a bill
 * timeline non-empty and an agenda navigable, so backfill them (and their
 * sponsors) before any junction rows are written and linked.
 */
async function backfillReferencedBills(
  items: Array<{ ItemTypeID: number | null; ItemID: number | null }>,
): Promise<number[]> {
  step("KNS_Bill — backfilling bills referenced by those agendas");
  const have = new Set((await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId));
  const wanted = [...new Set(
    items.filter((i) => i.ItemTypeID === ITEM_TYPE_BILL && i.ItemID != null).map((i) => i.ItemID as number),
  )].filter((id) => !have.has(id));

  if (wanted.length === 0) { done("nothing to backfill"); return []; }

  const rows = await fetchByIds<RawBill>("KNS_Bill", "Id", wanted, { label: "backfill bills" });

  const knownCommittees = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const n = await writeBatched(rows, (r) => {
    const data = {
      billId: r.Id, knessetNum: r.KnessetNum, name: r.Name,
      subTypeId: r.SubTypeID, subTypeDesc: r.SubTypeDesc,
      privateNumber: r.PrivateNumber, number: r.Number,
      committeeId: r.CommitteeID != null && knownCommittees.has(r.CommitteeID) ? r.CommitteeID : null,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      postponementReasonDesc: r.PostponementReasonDesc,
      publicationDate: parseDate(r.PublicationDate),
      summaryLaw: r.SummaryLaw, publicationSeriesDesc: r.PublicationSeriesDesc,
      isContinuationBill: r.IsContinuationBill,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.bill.upsert({ where: { billId: r.Id }, create: data, update: data });
  });
  await record("KNS_Bill:backfill", rows.length, n, true);
  done(`${n} additional bills`);
  return rows.map((r) => r.Id);
}

async function writeSessionItems(items: RawCmtSessionItem[], sessionIds: number[]) {
  step("Writing agenda items and linking them to bills");
  const itemTypes = await fetchAll<RawItemType>("KNS_ItemType");
  const typeDesc = new Map(itemTypes.map((t) => [t.Id, t.Desc]));
  const knownSessions = new Set(sessionIds);
  const knownBills = new Set((await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const usable = items.filter((i) => knownSessions.has(i.CommitteeSessionID));
  const n = await writeBatched(usable, (r) => {
    // ItemID points at a bill only when the item type says so; link it locally
    // only if we actually hold that bill, otherwise the FK would dangle.
    const isBill = r.ItemTypeID === ITEM_TYPE_BILL && r.ItemID != null && knownBills.has(r.ItemID);
    const data = {
      cmtSessionItemId: r.Id, itemId: r.ItemID, itemTypeId: r.ItemTypeID,
      itemTypeDesc: r.ItemTypeID != null ? (typeDesc.get(r.ItemTypeID) ?? null) : null,
      committeeSessionId: r.CommitteeSessionID, billId: isBill ? r.ItemID : null,
      ordinal: r.Ordinal,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      name: r.Name,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.sessionItem.upsert({ where: { cmtSessionItemId: r.Id }, create: data, update: data });
  });
  await record("KNS_CmtSessionItem", items.length, n, true);
  done(`${n} agenda items written`);
}

/**
 * Delete document rows the feed no longer publishes, re-pointing anything that
 * referenced them first.
 *
 * Normally that means a retraction upstream, and there are none most runs. The
 * reason it exists is the v2 → v4 switch: the two feeds number the same file
 * differently — v2 called this protocol 552478 where v4 calls it 625948, and it
 * is v4's number that appears in the file's own URL — so upserting v4 rows into
 * a database built from v2 leaves the old rows behind and shows every protocol
 * and every bill text twice. `filePath` is byte-identical in both feeds, which
 * is what lets attendance keep its provenance across the change.
 *
 * Only rows under `parentIds` are considered, so a partial run (`--bills=100`)
 * cannot delete anything it did not just refresh.
 */
async function pruneStaleDocuments(
  label: string,
  parentIds: number[],
  written: Array<{ id: string; filePath: string | null }>,
  existing: Array<{ id: string; filePath: string | null; parentId: number }>,
  remove: (ids: string[]) => Promise<unknown>,
  relink?: (fromId: string, toId: string) => Promise<number>,
): Promise<void> {
  const inScope = new Set(parentIds);
  const kept = new Set(written.map((w) => w.id));
  const newIdByPath = new Map(written.flatMap((w) => (w.filePath ? [[w.filePath, w.id] as const] : [])));
  const stale = existing.filter((r) => inScope.has(r.parentId) && !kept.has(r.id));
  if (stale.length === 0) return;

  let relinked = 0;
  if (relink) {
    for (const row of stale) {
      const to = row.filePath ? newIdByPath.get(row.filePath) : undefined;
      if (to) relinked += await relink(row.id, to);
    }
  }
  for (const part of chunk(stale.map((r) => r.id), 250)) await remove(part);
  console.log(`  · ${stale.length} stale ${label} removed${relinked ? `, ${relinked} attendance rows re-pointed` : ""}`);
}

/**
 * Committee broadcast links.
 *
 * v4 empties `KNS_CommitteeSession.BroadcastUrl` — every one of the 7,384
 * Knesset 25 sittings that carried one under v2 is null there now — and moves
 * the data into a table of its own, keyed on an `Id` that is the
 * CommitteeSessionID. The URLs are better than the ones they replace: https
 * rather than http, and a per-committee archive page instead of the generic
 * AllCommitteesBroadcast one.
 */
async function ingestBroadcastUrls(sessionIds: number[]) {
  step("KNS_BroadcastCommitteSession — committee broadcast links");
  const rows = await fetchByIds<RawBroadcast>("KNS_BroadcastCommitteSession", "Id", sessionIds, { label: "broadcasts" });
  const known = new Set(sessionIds);
  const usable = rows.filter((r) => r.BroadcastUrl != null && known.has(r.Id));
  const n = await writeBatched(usable, (r) =>
    prisma.committeeSession.updateMany({ where: { committeeSessionId: r.Id }, data: { broadcastUrl: r.BroadcastUrl } }),
  );
  await record("KNS_BroadcastCommitteSession", rows.length, n, true);
  done(`${n} broadcast links across ${sessionIds.length} sittings`);
}

async function ingestSessionDocuments(sessionIds: number[]) {
  step("KNS_DocumentCommitteeSession — protocol files");
  const rows = await fetchByIds<RawSessionDocument>("KNS_DocumentCommitteeSession", "CommitteeSessionID", sessionIds, { label: "protocols" });
  const knownSessions = new Set(sessionIds);
  const usable = rows.filter((r) => knownSessions.has(r.CommitteeSessionID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.Id, r.ApplicationID);
    const data = {
      id, documentCommitteeSessionId: String(r.Id), applicationId,
      committeeSessionId: r.CommitteeSessionID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: normaliseFilePath(r.FilePath),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.sessionDocument.upsert({ where: { id }, create: data, update: data });
  });
  await pruneStaleDocuments(
    "protocol rows",
    sessionIds,
    usable.map((r) => ({ id: docKey(r.Id, r.ApplicationID).id, filePath: normaliseFilePath(r.FilePath) })),
    (await prisma.sessionDocument.findMany({ select: { id: true, filePath: true, committeeSessionId: true } }))
      .map((d) => ({ id: d.id, filePath: d.filePath, parentId: d.committeeSessionId })),
    (ids) => prisma.sessionDocument.deleteMany({ where: { id: { in: ids } } }),
    async (fromId, toId) =>
      (await prisma.committeeParticipant.updateMany({ where: { sourceDocumentId: fromId }, data: { sourceDocumentId: toId } })).count,
  );
  await record("KNS_DocumentCommitteeSession", rows.length, n, true);
  done(`${n} documents`);
}

// ---------------------------------------------------------------------------


/**
 * KNS_DocumentBill — the bill's own texts: what was laid before the Knesset at
 * each reading, the enacted law, and background material. For a bill that has
 * not yet reached committee this is often the only substantive content there
 * is, so it is fetched for every bill we hold, not just recent ones.
 */
async function ingestBillDocuments(billIds: number[]) {
  step("KNS_DocumentBill — bill texts and attachments");
  const rows = await fetchByIds<RawBillDocument>("KNS_DocumentBill", "BillID", billIds, { label: "bill documents" });
  const known = new Set(billIds);
  const usable = rows.filter((r) => known.has(r.BillID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.Id, r.ApplicationID);
    const data = {
      id, documentBillId: String(r.Id), applicationId, billId: r.BillID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: normaliseFilePath(r.FilePath),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.billDocument.upsert({ where: { id }, create: data, update: data });
  });
  await pruneStaleDocuments(
    "bill document rows",
    billIds,
    usable.map((r) => ({ id: docKey(r.Id, r.ApplicationID).id, filePath: normaliseFilePath(r.FilePath) })),
    (await prisma.billDocument.findMany({ select: { id: true, filePath: true, billId: true } }))
      .map((d) => ({ id: d.id, filePath: d.filePath, parentId: d.billId })),
    (ids) => prisma.billDocument.deleteMany({ where: { id: { in: ids } } }),
  );
  await record("KNS_DocumentBill", rows.length, n, true);
  const withDocs = new Set(usable.map((r) => r.BillID)).size;
  done(`${n} documents across ${withDocs} bills`);
}

/**
 * KNS_JointCommittee — which committees make up a joint committee.
 *
 * v2 declared a key, `JointCommitteeID`, that was not unique — the value "1"
 * recurred — so rows are keyed on the committee pair instead. v4 issues a
 * genuine unique `Id`, but the pair is still the right key for us: it is what
 * makes a re-run idempotent, and the same pair can appear twice upstream.
 */
async function ingestJointCommittees() {
  step("KNS_JointCommittee — composition of joint committees");
  const rows = await fetchAll<RawJointCommittee>("KNS_JointCommittee");
  const known = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const usable = rows.filter((r) => known.has(r.CommitteeID) && known.has(r.ParticipantCommitteeID));

  // The same pair can appear twice upstream; keep one row per pair.
  const seen = new Set<string>();
  const deduped = usable.filter((r) => {
    const key = `${r.CommitteeID}:${r.ParticipantCommitteeID}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });

  const n = await writeBatched(deduped, (r) => {
    const where = { committeeId_participantCommitteeId: { committeeId: r.CommitteeID, participantCommitteeId: r.ParticipantCommitteeID } };
    const data = {
      committeeId: r.CommitteeID, participantCommitteeId: r.ParticipantCommitteeID,
      jointCommitteeId: String(r.Id),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.jointCommittee.upsert({ where, create: data, update: data });
  });
  await record("KNS_JointCommittee", rows.length, n, true);
  const skipped = usable.length - deduped.length;
  done(`${n} links${skipped ? ` (${skipped} duplicate pairs)` : ""}${rows.length - usable.length ? `, ${rows.length - usable.length} skipped: committee not held` : ""}`);
}

// ---------------------------------------------------------------------------
// Plenum
// ---------------------------------------------------------------------------

/** Every plenum sitting of the term — Knesset 25 has only a few hundred. */
async function ingestPlenumSessions(): Promise<number[]> {
  step(`KNS_PlenumSession — all sittings of Knesset ${KNESSET}`);
  const rows = await fetchAll<RawPlenumSession>("KNS_PlenumSession", {
    filter: `KnessetNum eq ${KNESSET}`,
    orderby: "StartDate desc",
  });
  const n = await writeBatched(rows, (r) => {
    const data = {
      plenumSessionId: r.Id, number: r.Number, knessetNum: r.KnessetNum,
      name: r.Name, startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      isSpecialMeeting: parseBool(r.IsSpecialMeeting),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.plenumSession.upsert({ where: { plenumSessionId: r.Id }, create: data, update: data });
  });
  await record("KNS_PlenumSession", rows.length, n, true);
  done(`${n} plenum sittings`);
  return rows.map((r) => r.Id);
}

/** Every appearance of the given bills on a plenum agenda — the reading history. */
async function fetchPlenumReadings(billIds: number[]): Promise<RawPlmSessionItem[]> {
  return fetchByIds<RawPlmSessionItem>("KNS_PlmSessionItem", "ItemID", billIds, {
    prefix: `ItemTypeID eq ${ITEM_TYPE_BILL}`,
    label: "readings",
  });
}

/** Full agendas of the most recent sittings, so the plenum views have content. */
async function fetchPlenumAgendas(sessionIds: number[]): Promise<RawPlmSessionItem[]> {
  const scope = PLENUM_AGENDA_LIMIT ? sessionIds.slice(0, PLENUM_AGENDA_LIMIT) : sessionIds;
  return fetchByIds<RawPlmSessionItem>("KNS_PlmSessionItem", "PlenumSessionID", scope, { label: "plenum agendas" });
}

/** Merge item batches, keeping one row per upstream primary key. */
function mergePlenumItems(...batches: RawPlmSessionItem[][]): RawPlmSessionItem[] {
  const byId = new Map<number, RawPlmSessionItem>();
  for (const batch of batches) for (const r of batch) byId.set(r.Id, r);
  return [...byId.values()];
}

/**
 * A note on what is deliberately NOT done here: stale plenum items are not
 * pruned, even though the feeds renumbered them (the same 13,430 items carry v2
 * ids in 886,959–1,012,648 and v4 ids in 83,445–168,862, with no overlap), so a
 * database built against v2 keeps both copies and shows every reading twice.
 *
 * Pruning cannot be done safely for this entity. `KNS_PlmSessionItem` is the
 * one table that answers nondeterministically: the identical request — same
 * filter, same `$skip`, same `$orderby=Id` — returns a different ~7% of rows on
 * each call while `@odata.count` stays put. (`KNS_CmtSessionItem`,
 * `KNS_DocumentCommitteeSession` and `KNS_BillInitiator` were checked the same
 * way and are stable, so this is not general paging behaviour, which is why the
 * document tables above do prune.) Deleting whatever a run did not return would
 * throw away a thousand good rows and re-add them next time. Deleting only rows
 * whose content reappeared under a new id fails too: 1,376 content identities
 * are held by more than one row upstream, so a flickering row whose twin came
 * back would be deleted as if superseded.
 *
 * The renumbering is a one-time event, so it belongs in a one-time cleanup
 * rather than in every run. Upgrading a v2-built database: delete the rows in
 * the old id space once, after a full ingest —
 *
 *   DELETE FROM PlenumSessionItem WHERE plmSessionItemId > 800000;
 *
 * — and confirm against `SELECT MAX(plmSessionItemId)` that the surviving rows
 * are the v4 ones. This has already been applied to the database in this repo.
 */
async function writePlenumItems(items: RawPlmSessionItem[], sessionIds: number[]) {
  step("Writing plenum agenda items and linking them to bills");
  const knownSessions = new Set(sessionIds);
  const knownBills = new Set((await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const usable = items.filter((i) => knownSessions.has(i.PlenumSessionID));
  const rows = usable.map((r) => {
    const isBill = r.ItemTypeID === ITEM_TYPE_BILL && r.ItemID != null && knownBills.has(r.ItemID);
    // Ordinal is an Int64 upstream and arrives as a string.
    const ordinal = r.Ordinal == null ? null : Number(r.Ordinal);
    return {
      plmSessionItemId: r.Id, itemId: r.ItemID, itemTypeId: r.ItemTypeID,
      itemTypeDesc: r.ItemTypeDesc, plenumSessionId: r.PlenumSessionID,
      billId: isBill ? r.ItemID : null,
      ordinal: Number.isFinite(ordinal) ? ordinal : null,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      name: r.Name,
      isDiscussion: r.IsDiscussion === 1,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
  });
  const n = await writeBatched(rows, (data) =>
    prisma.plenumSessionItem.upsert({ where: { plmSessionItemId: data.plmSessionItemId }, create: data, update: data }),
  );
  await record("KNS_PlmSessionItem", items.length, n, true);
  const skipped = items.length - usable.length;
  // Continuation bills can be read in sittings of an earlier term, which we do
  // not mirror; those items are skipped rather than left dangling.
  done(`${n} plenum items${skipped ? ` (${skipped} skipped: sitting outside Knesset ${KNESSET})` : ""}`);
}

/** Transcripts ("דברי הכנסת") for the sittings that carry ingested items. */
async function ingestPlenumDocuments(sessionIds: number[]) {
  step("KNS_DocumentPlenumSession — plenum transcripts");
  const rows = await fetchByIds<RawPlenumDocument>("KNS_DocumentPlenumSession", "PlenumSessionID", sessionIds, { label: "transcripts" });
  const known = new Set(sessionIds);
  const usable = rows.filter((r) => known.has(r.PlenumSessionID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.Id, r.ApplicationID);
    const data = {
      id, documentPlenumSessionId: String(r.Id), applicationId,
      plenumSessionId: r.PlenumSessionID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: normaliseFilePath(r.FilePath),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.plenumDocument.upsert({ where: { id }, create: data, update: data });
  });
  await pruneStaleDocuments(
    "transcript rows",
    sessionIds,
    usable.map((r) => ({ id: docKey(r.Id, r.ApplicationID).id, filePath: normaliseFilePath(r.FilePath) })),
    (await prisma.plenumDocument.findMany({ select: { id: true, filePath: true, plenumSessionId: true } }))
      .map((d) => ({ id: d.id, filePath: d.filePath, parentId: d.plenumSessionId })),
    (ids) => prisma.plenumDocument.deleteMany({ where: { id: { in: ids } } }),
  );
  await record("KNS_DocumentPlenumSession", rows.length, n, true);
  done(`${n} transcripts`);
}

/**
 * Derive each bill's earliest dated step.
 *
 * The obvious candidate for "when did this bill happen" — `LastUpdatedDate` —
 * is a trap. The Knesset rewrites it in bulk: when an MK resigns, every pending
 * bill they sponsored is restamped with that date and given the postponement
 * reason "חה\"כ המציע התפטר". One member's four years of work then collapses
 * into the single month they left. Across the corpus 60% of bills date
 * differently under the two definitions.
 *
 * The honest date is the first sitting that actually had the bill on its
 * agenda, which the junction tables give us for every bill we hold.
 */
async function deriveBillFirstStep() {
  step("Deriving each bill's earliest dated step");

  // One statement rather than 1,000+ round trips; MIN over both junctions.
  await prisma.$executeRawUnsafe(`
    UPDATE "Bill" SET "firstStepDate" = (
      SELECT MIN(d) FROM (
        SELECT ps."startDate" AS d
          FROM "PlenumSessionItem" pi
          JOIN "PlenumSession" ps ON ps."plenumSessionId" = pi."plenumSessionId"
         WHERE pi."billId" = "Bill"."billId" AND ps."startDate" IS NOT NULL
        UNION ALL
        SELECT cs."startDate" AS d
          FROM "SessionItem" si
          JOIN "CommitteeSession" cs ON cs."committeeSessionId" = si."committeeSessionId"
         WHERE si."billId" = "Bill"."billId" AND cs."startDate" IS NOT NULL
      )
    )
  `);

  // Which junction supplied it, for the UI to be able to say so.
  await prisma.$executeRawUnsafe(`
    UPDATE "Bill" SET "firstStepSource" = CASE
      WHEN "firstStepDate" IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM "PlenumSessionItem" pi
          JOIN "PlenumSession" ps ON ps."plenumSessionId" = pi."plenumSessionId"
         WHERE pi."billId" = "Bill"."billId" AND ps."startDate" = "Bill"."firstStepDate"
      ) THEN 'plenum'
      ELSE 'committee' END
  `);

  // Only for bills with no agenda appearance at all.
  await prisma.$executeRawUnsafe(`
    UPDATE "Bill"
       SET "firstStepDate" = COALESCE("publicationDate", "lastUpdatedDate"),
           "firstStepSource" = CASE WHEN "publicationDate" IS NOT NULL THEN 'publication' ELSE 'lastUpdated' END
     WHERE "firstStepDate" IS NULL
  `);

  const bySource = await prisma.bill.groupBy({ by: ["firstStepSource"], _count: true });
  for (const r of bySource) console.log(`  ${String(r.firstStepSource).padEnd(12)} ${r._count}`);
  done("first-step dates set");
}


// ---------------------------------------------------------------------------
// Written questions (שאילתות)
// ---------------------------------------------------------------------------

async function ingestGovMinistries() {
  step("KNS_GovMinistry");
  const rows = await fetchAll<RawGovMinistry>("KNS_GovMinistry");
  const n = await writeBatched(rows, (r) => {
    const data = {
      govMinistryId: r.Id, name: r.Name?.trim() ?? null,
      isActive: parseBool(r.IsActive), lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.govMinistry.upsert({ where: { govMinistryId: r.Id }, create: data, update: data });
  });
  await record("KNS_GovMinistry", rows.length, n, true);
  done(`${n} ministries`);
}

/**
 * KNS_Query — written questions from MKs to ministers.
 *
 * `replyDaysLate` is derived here from the two dates the service already gives:
 * when a reply was due and when it arrived. Only answered questions get a
 * value; for the rest lateness depends on today's date, so it belongs in the
 * query layer rather than frozen in a column.
 */
async function ingestQuestions(): Promise<number[]> {
  step(`KNS_Query — written questions, Knesset ${KNESSET}`);
  const rows = await fetchAll<RawQuery>("KNS_Query", { filter: `KnessetNum eq ${KNESSET}` });

  const knownPeople = new Set((await prisma.person.findMany({ select: { personId: true } })).map((p) => p.personId));
  const knownMinistries = new Set((await prisma.govMinistry.findMany({ select: { govMinistryId: true } })).map((m) => m.govMinistryId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  let unknownPerson = 0;
  const n = await writeBatched(rows, (r) => {
    const planned = parseDate(r.ReplyDatePlanned);
    const replied = parseDate(r.ReplyMinisterDate);
    const daysLate =
      planned && replied ? Math.round((replied.getTime() - planned.getTime()) / 86_400_000) : null;
    if (r.PersonID != null && !knownPeople.has(r.PersonID)) unknownPerson++;

    const data = {
      questionId: r.Id, number: r.Number, knessetNum: r.KnessetNum, name: r.Name,
      typeId: r.TypeID, typeDesc: r.TypeDesc,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      personId: r.PersonID != null && knownPeople.has(r.PersonID) ? r.PersonID : null,
      govMinistryId: r.GovMinistryID != null && knownMinistries.has(r.GovMinistryID) ? r.GovMinistryID : null,
      submitDate: parseDate(r.SubmitDate),
      replyDatePlanned: planned,
      replyMinisterDate: replied,
      replyDaysLate: daysLate,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.question.upsert({ where: { questionId: r.Id }, create: data, update: data });
  });
  await record("KNS_Query", rows.length, n, true);
  done(`${n} questions${unknownPerson ? ` (${unknownPerson} from a person we do not hold)` : ""}`);
  return rows.map((r) => r.Id);
}

/**
 * Question documents are the one table v4 does not serve over OData.
 *
 * Its metadata and service document both advertise the set as
 * `KNS_DocumentQuerie` — and that URL 404s, with or without query options.
 * `KNS_DocumentQuery` answers instead, but outside OData: a bare JSON array
 * with camelCase keys and no `value` envelope or `@odata.count`. `$top`,
 * `$skip` and `$filter … in (…)` all work, and the ids match the ones in the
 * file names, so the data is v4's. Treat the casing here as a property of that
 * one endpoint, not a style choice.
 */
async function ingestQuestionDocuments(questionIds: number[]) {
  step("KNS_DocumentQuery — question texts and ministers' replies");
  const rows = await fetchByIds<RawQueryDocument>("KNS_DocumentQuery", "QueryID", questionIds, { label: "question documents" });
  const known = new Set(questionIds);
  const usable = rows.filter((r) => known.has(r.queryID));

  const n = await writeBatched(usable, (r) => {
    // This table always issued a distinct id per format, even under v2 when the
    // other document tables did not, so the id alone has always been safe here.
    const id = String(r.id);
    const data = {
      documentQueryId: id, questionId: r.queryID,
      groupTypeId: r.groupTypeID, groupTypeDesc: r.groupTypeDesc,
      applicationDesc: r.applicationDesc, filePath: normaliseFilePath(r.filePath),
      lastUpdatedDate: parseDate(r.lastUpdatedDate),
    };
    return prisma.questionDocument.upsert({ where: { documentQueryId: id }, create: data, update: data });
  });
  await pruneStaleDocuments(
    "question document rows",
    questionIds,
    usable.map((r) => ({ id: String(r.id), filePath: normaliseFilePath(r.filePath) })),
    (await prisma.questionDocument.findMany({ select: { documentQueryId: true, filePath: true, questionId: true } }))
      .map((d) => ({ id: d.documentQueryId, filePath: d.filePath, parentId: d.questionId })),
    (ids) => prisma.questionDocument.deleteMany({ where: { documentQueryId: { in: ids } } }),
  );
  await record("KNS_DocumentQuery", rows.length, n, true);
  done(`${n} documents`);
}

async function main() {
  const scope = BILL_LIMIT || SESSION_LIMIT || PLENUM_AGENDA_LIMIT
    ? `LIMITED: ${BILL_LIMIT ?? "all"} bills, ${SESSION_LIMIT ?? "all"} committee sessions, ${PLENUM_AGENDA_LIMIT ?? "all"} plenum agendas`
    : "the complete term";
  console.log(`Galui ETL → Knesset ${KNESSET} — ${scope}`);
  console.log(`Source: ${ODATA_BASE}`);

  await ingestStatuses();
  await ingestFactions();
  await ingestCommittees();
  await ingestPeople();
  await ingestPositions();
  await ingestJointCommittees();

  const billIds = await ingestBills();
  await ingestBillInitiators(billIds);

  // --- Committee side: sessions and their agendas -------------------------
  const { items: billItems, sessionIds: billSessionIds } = await findSessionsForBills(billIds);
  const sessionIds = await ingestSessions(billSessionIds);
  await ingestBroadcastUrls(sessionIds);
  const committeeItems = await collectSessionItems(billItems, sessionIds);

  const cmtBackfilled = await backfillReferencedBills(committeeItems);

  // --- Plenum side: sittings, reading histories and recent agendas --------
  const plenumSessionIds = await ingestPlenumSessions();

  step(`KNS_PlmSessionItem — agendas of ${PLENUM_AGENDA_LIMIT ? `the ${PLENUM_AGENDA_LIMIT} most recent sittings` : "every sitting"}`);
  const agendaItems = await fetchPlenumAgendas(plenumSessionIds);
  done(`${agendaItems.length} agenda items`);

  // Plenum agendas reference far more bills than committee agendas do; without
  // this the sittings would list bills we cannot link to or show a history for.
  const plmBackfilled = await backfillReferencedBills(agendaItems);

  const backfilled = [...cmtBackfilled, ...plmBackfilled];
  if (backfilled.length) await ingestBillInitiators(backfilled);

  // Everything downstream works off the full bill set read back from the
  // database, not off `backfilled`. On a re-run every bill is already present
  // so the backfill lists are empty, and anything keyed off them would silently
  // shrink to the initial sample — making a second run less complete than the
  // first. Reading from the database keeps runs idempotent.
  const everyBillId = (await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId);

  step("KNS_PlmSessionItem — reading histories of every ingested bill");
  const readings = await fetchPlenumReadings(everyBillId);
  const plenumItems = mergePlenumItems(agendaItems, readings);
  done(`${readings.length} readings, ${plenumItems.length} plenum items in total`);

  await ingestBillDocuments(everyBillId);

  // --- Write the junctions now that every referenced bill is present ------
  await writeSessionItems(committeeItems, sessionIds);
  await ingestSessionDocuments(sessionIds);
  await writePlenumItems(plenumItems, plenumSessionIds);

  // Transcripts follow the sittings that actually hold items in the database,
  // for the same idempotency reason.
  const sittingsWithItems = (
    await prisma.plenumSessionItem.findMany({ select: { plenumSessionId: true }, distinct: ["plenumSessionId"] })
  ).map((r) => r.plenumSessionId);
  await ingestPlenumDocuments(sittingsWithItems);

  // Needs every junction row written first.
  await deriveBillFirstStep();

  await ingestGovMinistries();
  const questionIds = await ingestQuestions();
  await ingestQuestionDocuments(questionIds);

  step("Summary");
  const counts = {
    people: await prisma.person.count(),
    members: await prisma.person.count({ where: { isMk: true } }),
    bills: await prisma.bill.count(),
    sponsorships: await prisma.billInitiator.count(),
    committees: await prisma.committee.count(),
    sessions: await prisma.committeeSession.count(),
    agendaItems: await prisma.sessionItem.count(),
    billDiscussions: await prisma.sessionItem.count({ where: { billId: { not: null } } }),
    protocols: await prisma.sessionDocument.count(),
    billDocuments: await prisma.billDocument.count(),
    plenumSittings: await prisma.plenumSession.count(),
    plenumItems: await prisma.plenumSessionItem.count(),
    billReadings: await prisma.plenumSessionItem.count({ where: { billId: { not: null } } }),
    transcripts: await prisma.plenumDocument.count(),
    jointLinks: await prisma.jointCommittee.count(),
    ministries: await prisma.govMinistry.count(),
    questions: await prisma.question.count(),
    questionDocs: await prisma.questionDocument.count(),
  };
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\nDone in ${stamp()}.`);
}

main()
  .catch(async (err) => {
    console.error("\nETL failed:", err);
    await record("__run__", 0, 0, false, String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
