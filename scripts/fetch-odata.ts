/**
 * Galui ETL — pulls the 25th Knesset from the official Knesset OData v3 service
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
import { chunk, count, fetchAll, orIn, parseBool, parseDate } from "./lib/odata.js";

// ---------------------------------------------------------------------------
// OData row shapes (only the fields we persist)
// ---------------------------------------------------------------------------

interface RawStatus { StatusID: number; Desc: string | null; TypeDesc: string | null; IsActive: boolean | null }
interface RawFaction { FactionID: number; Name: string | null; KnessetNum: number | null; StartDate: string | null; FinishDate: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawCommittee { CommitteeID: number; Name: string | null; CategoryDesc: string | null; KnessetNum: number | null; CommitteeTypeDesc: string | null; ParentCommitteeID: number | null; CommitteeParentName: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawPerson { PersonID: number; FirstName: string | null; LastName: string | null; GenderDesc: string | null; Email: string | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawMkSiteCode { MKSiteCode: string; KnsID: number; SiteId: number }
interface RawPersonToPosition { PersonToPositionID: number; PersonID: number; PositionID: number; KnessetNum: number | null; StartDate: string | null; FinishDate: string | null; FactionID: number | null; FactionName: string | null; DutyDesc: string | null; CommitteeID: number | null; CommitteeName: string | null; GovMinistryName: string | null; GovernmentNum: number | null; IsCurrent: boolean | null; LastUpdatedDate: string | null }
interface RawPosition { PositionID: number; Description: string | null }
interface RawBill { BillID: number; KnessetNum: number | null; Name: string | null; SubTypeID: number | null; SubTypeDesc: string | null; PrivateNumber: number | null; Number: number | null; CommitteeID: number | null; StatusID: number | null; PostponementReasonDesc: string | null; PublicationDate: string | null; SummaryLaw: string | null; PublicationSeriesDesc: string | null; IsContinuationBill: boolean | null; LastUpdatedDate: string | null }
interface RawBillInitiator { BillInitiatorID: number; BillID: number; PersonID: number; IsInitiator: boolean | null; Ordinal: number | null; LastUpdatedDate: string | null }
interface RawCommitteeSession { CommitteeSessionID: number; Number: number | null; KnessetNum: number | null; TypeDesc: string | null; CommitteeID: number | null; StatusDesc: string | null; Location: string | null; SessionUrl: string | null; BroadcastUrl: string | null; StartDate: string | null; FinishDate: string | null; Note: string | null; LastUpdatedDate: string | null }
interface RawCmtSessionItem { CmtSessionItemID: number; ItemID: number | null; ItemTypeID: number | null; CommitteeSessionID: number; Ordinal: number | null; StatusID: number | null; Name: string | null; LastUpdatedDate: string | null }
interface RawSessionDocument { DocumentCommitteeSessionID: string | number; CommitteeSessionID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }
interface RawItemType { ItemTypeID: number; Desc: string | null }
interface RawBillDocument { DocumentBillID: string | number; BillID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }
interface RawPlenumSession { PlenumSessionID: number; Number: number | null; KnessetNum: number | null; Name: string | null; StartDate: string | null; FinishDate: string | null; IsSpecialMeeting: boolean | null; LastUpdatedDate: string | null }
interface RawPlmSessionItem { plmPlenumSessionID: number; ItemID: number | null; PlenumSessionID: number; ItemTypeID: number | null; ItemTypeDesc: string | null; Ordinal: number | string | null; Name: string | null; StatusID: number | null; IsDiscussion: number | null; LastUpdatedDate: string | null }
interface RawPlenumDocument { DocumentPlenumSessionID: string | number; PlenumSessionID: number; GroupTypeID: number | null; GroupTypeDesc: string | null; ApplicationID: number | null; ApplicationDesc: string | null; FilePath: string | null; LastUpdatedDate: string | null }

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const KNESSET = arg("knesset", 25);
const BILL_LIMIT = arg("bills", 100);
const SESSION_LIMIT = arg("sessions", 100);
// Full agendas are pulled for this many recent plenum sittings; the sittings
// themselves are all ingested, since Knesset 25 has only ~418 of them.
const PLENUM_AGENDA_LIMIT = arg("plenum", 100);

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
 * Document ids are not unique upstream: the same document appears once per
 * published format, so the row key is the id paired with ApplicationID.
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
    const data = { statusId: r.StatusID, desc: r.Desc, typeDesc: r.TypeDesc, isActive: parseBool(r.IsActive) };
    return prisma.status.upsert({ where: { statusId: r.StatusID }, create: data, update: data });
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
      factionId: r.FactionID, name: r.Name, knessetNum: r.KnessetNum,
      startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      isCurrent: parseBool(r.IsCurrent), lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.faction.upsert({ where: { factionId: r.FactionID }, create: data, update: data });
  });
  await record("KNS_Faction", rows.length, n, true);
  done(`${n} factions`);
}

async function ingestCommittees() {
  step("KNS_Committee");
  const rows = await fetchAll<RawCommittee>("KNS_Committee");
  const n = await writeBatched(rows, (r) => {
    const data = {
      committeeId: r.CommitteeID, name: r.Name, categoryDesc: r.CategoryDesc, knessetNum: r.KnessetNum,
      committeeTypeDesc: r.CommitteeTypeDesc, parentCommitteeId: r.ParentCommitteeID,
      parentName: r.CommitteeParentName, isCurrent: parseBool(r.IsCurrent),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.committee.upsert({ where: { committeeId: r.CommitteeID }, create: data, update: data });
  });
  await record("KNS_Committee", rows.length, n, true);
  done(`${n} committees`);
}

async function ingestPeople() {
  step("KNS_Person + KNS_MkSiteCode");
  // ~1.2k people in total — small enough to mirror wholesale, which keeps every
  // bill-initiator foreign key resolvable regardless of which term they served.
  const [people, siteCodes] = await Promise.all([
    fetchAll<RawPerson>("KNS_Person"),
    fetchAll<RawMkSiteCode>("KNS_MkSiteCode"),
  ]);
  const codeByPerson = new Map(siteCodes.map((s) => [s.KnsID, s.MKSiteCode]));

  const n = await writeBatched(people, (r) => {
    const data = {
      personId: r.PersonID, firstName: r.FirstName, lastName: r.LastName,
      genderDesc: r.GenderDesc, email: r.Email, isCurrent: parseBool(r.IsCurrent),
      mkSiteCode: codeByPerson.get(r.PersonID) ?? null,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.person.upsert({ where: { personId: r.PersonID }, create: data, update: data });
  });
  await record("KNS_Person", people.length, n, true);
  done(`${n} people (${codeByPerson.size} with a site code)`);
}

async function ingestPositions() {
  step(`KNS_PersonToPosition — Knesset ${KNESSET}`);
  const [rows, positionTypes] = await Promise.all([
    fetchAll<RawPersonToPosition>("KNS_PersonToPosition", { filter: `KnessetNum eq ${KNESSET}` }),
    fetchAll<RawPosition>("KNS_Position"),
  ]);
  const descById = new Map(positionTypes.map((p) => [p.PositionID, p.Description]));

  // Only keep rows whose person we actually mirrored, so the FK holds.
  const known = new Set((await prisma.person.findMany({ select: { personId: true } })).map((p) => p.personId));
  const usable = rows.filter((r) => known.has(r.PersonID));

  const n = await writeBatched(usable, (r) => {
    const data = {
      personToPositionId: r.PersonToPositionID, personId: r.PersonID, positionId: r.PositionID,
      positionDesc: descById.get(r.PositionID) ?? null, knessetNum: r.KnessetNum,
      startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      factionId: r.FactionID, factionName: r.FactionName, dutyDesc: r.DutyDesc,
      committeeId: r.CommitteeID, committeeName: r.CommitteeName,
      govMinistryName: r.GovMinistryName, governmentNum: r.GovernmentNum,
      isCurrent: parseBool(r.IsCurrent),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.personPosition.upsert({ where: { personToPositionId: r.PersonToPositionID }, create: data, update: data });
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
        roleDesc: notable ? (notable.DutyDesc ?? descById.get(notable.PositionID) ?? null) : null,
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
  step(`KNS_Bill — ${BILL_LIMIT} most recently updated in Knesset ${KNESSET}`);
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
      billId: r.BillID, knessetNum: r.KnessetNum, name: r.Name,
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
    return prisma.bill.upsert({ where: { billId: r.BillID }, create: data, update: data });
  });
  await record("KNS_Bill", rows.length, n, true, `${total} available upstream`);
  done(`${n} bills (of ${total} in Knesset ${KNESSET})`);
  return rows.map((r) => r.BillID);
}

async function ingestBillInitiators(billIds: number[]) {
  step("KNS_BillInitiator — sponsors of the ingested bills");
  const rows: RawBillInitiator[] = [];
  // OData filters have a practical URL length limit, so ask in id batches.
  for (const ids of chunk(billIds, 20)) {
    rows.push(...(await fetchAll<RawBillInitiator>("KNS_BillInitiator", { filter: orIn("BillID", ids) })));
  }
  const knownPeople = new Set((await prisma.person.findMany({ select: { personId: true } })).map((p) => p.personId));
  const usable = rows.filter((r) => knownPeople.has(r.PersonID));

  const n = await writeBatched(usable, (r) => {
    const data = {
      billInitiatorId: r.BillInitiatorID, billId: r.BillID, personId: r.PersonID,
      isInitiator: parseBool(r.IsInitiator), ordinal: r.Ordinal,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.billInitiator.upsert({ where: { billInitiatorId: r.BillInitiatorID }, create: data, update: data });
  });
  await record("KNS_BillInitiator", rows.length, n, true);
  done(`${n} sponsorships${rows.length - usable.length ? ` (${rows.length - usable.length} skipped: unknown person)` : ""}`);
}

/** Session items for the ingested bills — these drive the bill timeline. */
async function findSessionsForBills(billIds: number[]): Promise<{ items: RawCmtSessionItem[]; sessionIds: number[] }> {
  step("KNS_CmtSessionItem — committee discussions of the ingested bills");
  const items: RawCmtSessionItem[] = [];
  for (const ids of chunk(billIds, 20)) {
    items.push(...(await fetchAll<RawCmtSessionItem>("KNS_CmtSessionItem", {
      filter: `ItemTypeID eq ${ITEM_TYPE_BILL} and (${orIn("ItemID", ids)})`,
    })));
  }
  const sessionIds = [...new Set(items.map((i) => i.CommitteeSessionID))];
  done(`${items.length} discussions across ${sessionIds.length} sessions`);
  return { items, sessionIds };
}

async function ingestSessions(extraSessionIds: number[]): Promise<number[]> {
  step(`KNS_CommitteeSession — ${SESSION_LIMIT} most recent in Knesset ${KNESSET} + sessions referenced by ingested bills`);
  const rows = await fetchAll<RawCommitteeSession>("KNS_CommitteeSession", {
    filter: `KnessetNum eq ${KNESSET}`,
    orderby: "StartDate desc",
    limit: SESSION_LIMIT,
  });

  const have = new Set(rows.map((r) => r.CommitteeSessionID));
  const missing = extraSessionIds.filter((id) => !have.has(id));
  for (const ids of chunk(missing, 20)) {
    rows.push(...(await fetchAll<RawCommitteeSession>("KNS_CommitteeSession", { filter: orIn("CommitteeSessionID", ids) })));
  }

  const knownCommittees = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const n = await writeBatched(rows, (r) => {
    const data = {
      committeeSessionId: r.CommitteeSessionID, number: r.Number, knessetNum: r.KnessetNum,
      typeDesc: r.TypeDesc,
      committeeId: r.CommitteeID != null && knownCommittees.has(r.CommitteeID) ? r.CommitteeID : null,
      statusDesc: r.StatusDesc, location: r.Location, sessionUrl: r.SessionUrl,
      broadcastUrl: r.BroadcastUrl, startDate: parseDate(r.StartDate),
      finishDate: parseDate(r.FinishDate), note: r.Note,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.committeeSession.upsert({ where: { committeeSessionId: r.CommitteeSessionID }, create: data, update: data });
  });
  await record("KNS_CommitteeSession", rows.length, n, true);
  done(`${n} sessions (${missing.length} pulled in for bill timelines)`);
  return rows.map((r) => r.CommitteeSessionID);
}

/** Fetch every agenda item for the ingested sessions (bill items already in hand). */
async function collectSessionItems(billItems: RawCmtSessionItem[], sessionIds: number[]): Promise<RawCmtSessionItem[]> {
  step("KNS_CmtSessionItem — full agendas of the ingested sessions");
  const items = [...billItems];
  const seen = new Set(items.map((i) => i.CmtSessionItemID));
  for (const ids of chunk(sessionIds, 20)) {
    for (const row of await fetchAll<RawCmtSessionItem>("KNS_CmtSessionItem", { filter: orIn("CommitteeSessionID", ids) })) {
      if (!seen.has(row.CmtSessionItemID)) { seen.add(row.CmtSessionItemID); items.push(row); }
    }
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

  const rows: RawBill[] = [];
  for (const ids of chunk(wanted, 20)) {
    rows.push(...(await fetchAll<RawBill>("KNS_Bill", { filter: orIn("BillID", ids) })));
  }

  const knownCommittees = new Set((await prisma.committee.findMany({ select: { committeeId: true } })).map((c) => c.committeeId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const n = await writeBatched(rows, (r) => {
    const data = {
      billId: r.BillID, knessetNum: r.KnessetNum, name: r.Name,
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
    return prisma.bill.upsert({ where: { billId: r.BillID }, create: data, update: data });
  });
  await record("KNS_Bill:backfill", rows.length, n, true);
  done(`${n} additional bills`);
  return rows.map((r) => r.BillID);
}

async function writeSessionItems(items: RawCmtSessionItem[], sessionIds: number[]) {
  step("Writing agenda items and linking them to bills");
  const itemTypes = await fetchAll<RawItemType>("KNS_ItemType");
  const typeDesc = new Map(itemTypes.map((t) => [t.ItemTypeID, t.Desc]));
  const knownSessions = new Set(sessionIds);
  const knownBills = new Set((await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const usable = items.filter((i) => knownSessions.has(i.CommitteeSessionID));
  const n = await writeBatched(usable, (r) => {
    // ItemID points at a bill only when the item type says so; link it locally
    // only if we actually hold that bill, otherwise the FK would dangle.
    const isBill = r.ItemTypeID === ITEM_TYPE_BILL && r.ItemID != null && knownBills.has(r.ItemID);
    const data = {
      cmtSessionItemId: r.CmtSessionItemID, itemId: r.ItemID, itemTypeId: r.ItemTypeID,
      itemTypeDesc: r.ItemTypeID != null ? (typeDesc.get(r.ItemTypeID) ?? null) : null,
      committeeSessionId: r.CommitteeSessionID, billId: isBill ? r.ItemID : null,
      ordinal: r.Ordinal,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      name: r.Name,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.sessionItem.upsert({ where: { cmtSessionItemId: r.CmtSessionItemID }, create: data, update: data });
  });
  await record("KNS_CmtSessionItem", items.length, n, true);
  done(`${n} agenda items written`);
}

async function ingestSessionDocuments(sessionIds: number[]) {
  step("KNS_DocumentCommitteeSession — protocol files");
  const rows: RawSessionDocument[] = [];
  for (const ids of chunk(sessionIds, 20)) {
    rows.push(...(await fetchAll<RawSessionDocument>("KNS_DocumentCommitteeSession", { filter: orIn("CommitteeSessionID", ids) })));
  }
  const knownSessions = new Set(sessionIds);
  const usable = rows.filter((r) => knownSessions.has(r.CommitteeSessionID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.DocumentCommitteeSessionID, r.ApplicationID);
    const data = {
      id, documentCommitteeSessionId: String(r.DocumentCommitteeSessionID), applicationId,
      committeeSessionId: r.CommitteeSessionID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: r.FilePath,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.sessionDocument.upsert({ where: { id }, create: data, update: data });
  });
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
  const rows: RawBillDocument[] = [];
  for (const ids of chunk(billIds, 20)) {
    rows.push(...(await fetchAll<RawBillDocument>("KNS_DocumentBill", { filter: orIn("BillID", ids) })));
  }
  const known = new Set(billIds);
  const usable = rows.filter((r) => known.has(r.BillID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.DocumentBillID, r.ApplicationID);
    const data = {
      id, documentBillId: String(r.DocumentBillID), applicationId, billId: r.BillID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: r.FilePath,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.billDocument.upsert({ where: { id }, create: data, update: data });
  });
  await record("KNS_DocumentBill", rows.length, n, true);
  const withDocs = new Set(usable.map((r) => r.BillID)).size;
  done(`${n} documents across ${withDocs} bills`);
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
      plenumSessionId: r.PlenumSessionID, number: r.Number, knessetNum: r.KnessetNum,
      name: r.Name, startDate: parseDate(r.StartDate), finishDate: parseDate(r.FinishDate),
      isSpecialMeeting: parseBool(r.IsSpecialMeeting),
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.plenumSession.upsert({ where: { plenumSessionId: r.PlenumSessionID }, create: data, update: data });
  });
  await record("KNS_PlenumSession", rows.length, n, true);
  done(`${n} plenum sittings`);
  return rows.map((r) => r.PlenumSessionID);
}

/** Every appearance of the given bills on a plenum agenda — the reading history. */
async function fetchPlenumReadings(billIds: number[]): Promise<RawPlmSessionItem[]> {
  const out: RawPlmSessionItem[] = [];
  for (const ids of chunk(billIds, 20)) {
    out.push(...(await fetchAll<RawPlmSessionItem>("KNS_PlmSessionItem", {
      filter: `ItemTypeID eq ${ITEM_TYPE_BILL} and (${orIn("ItemID", ids)})`,
    })));
  }
  return out;
}

/** Full agendas of the most recent sittings, so the plenum views have content. */
async function fetchPlenumAgendas(sessionIds: number[]): Promise<RawPlmSessionItem[]> {
  const out: RawPlmSessionItem[] = [];
  for (const ids of chunk(sessionIds.slice(0, PLENUM_AGENDA_LIMIT), 20)) {
    out.push(...(await fetchAll<RawPlmSessionItem>("KNS_PlmSessionItem", { filter: orIn("PlenumSessionID", ids) })));
  }
  return out;
}

/** Merge item batches, keeping one row per upstream primary key. */
function mergePlenumItems(...batches: RawPlmSessionItem[][]): RawPlmSessionItem[] {
  const byId = new Map<number, RawPlmSessionItem>();
  for (const batch of batches) for (const r of batch) byId.set(r.plmPlenumSessionID, r);
  return [...byId.values()];
}

async function writePlenumItems(items: RawPlmSessionItem[], sessionIds: number[]) {
  step("Writing plenum agenda items and linking them to bills");
  const knownSessions = new Set(sessionIds);
  const knownBills = new Set((await prisma.bill.findMany({ select: { billId: true } })).map((b) => b.billId));
  const knownStatuses = new Set((await prisma.status.findMany({ select: { statusId: true } })).map((s) => s.statusId));

  const usable = items.filter((i) => knownSessions.has(i.PlenumSessionID));
  const n = await writeBatched(usable, (r) => {
    const isBill = r.ItemTypeID === ITEM_TYPE_BILL && r.ItemID != null && knownBills.has(r.ItemID);
    // Ordinal is an Int64 upstream and arrives as a string.
    const ordinal = r.Ordinal == null ? null : Number(r.Ordinal);
    const data = {
      plmSessionItemId: r.plmPlenumSessionID, itemId: r.ItemID, itemTypeId: r.ItemTypeID,
      itemTypeDesc: r.ItemTypeDesc, plenumSessionId: r.PlenumSessionID,
      billId: isBill ? r.ItemID : null,
      ordinal: Number.isFinite(ordinal) ? ordinal : null,
      statusId: r.StatusID != null && knownStatuses.has(r.StatusID) ? r.StatusID : null,
      name: r.Name,
      isDiscussion: r.IsDiscussion === 1,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.plenumSessionItem.upsert({ where: { plmSessionItemId: r.plmPlenumSessionID }, create: data, update: data });
  });
  await record("KNS_PlmSessionItem", items.length, n, true);
  const skipped = items.length - usable.length;
  // Continuation bills can be read in sittings of an earlier term, which we do
  // not mirror; those items are skipped rather than left dangling.
  done(`${n} plenum items${skipped ? ` (${skipped} skipped: sitting outside Knesset ${KNESSET})` : ""}`);
}

/** Transcripts ("דברי הכנסת") for the sittings that carry ingested items. */
async function ingestPlenumDocuments(sessionIds: number[]) {
  step("KNS_DocumentPlenumSession — plenum transcripts");
  const rows: RawPlenumDocument[] = [];
  for (const ids of chunk(sessionIds, 20)) {
    rows.push(...(await fetchAll<RawPlenumDocument>("KNS_DocumentPlenumSession", { filter: orIn("PlenumSessionID", ids) })));
  }
  const known = new Set(sessionIds);
  const usable = rows.filter((r) => known.has(r.PlenumSessionID));

  const n = await writeBatched(usable, (r) => {
    const { id, applicationId } = docKey(r.DocumentPlenumSessionID, r.ApplicationID);
    const data = {
      id, documentPlenumSessionId: String(r.DocumentPlenumSessionID), applicationId,
      plenumSessionId: r.PlenumSessionID,
      groupTypeId: r.GroupTypeID, groupTypeDesc: r.GroupTypeDesc,
      applicationDesc: r.ApplicationDesc, filePath: r.FilePath,
      lastUpdatedDate: parseDate(r.LastUpdatedDate),
    };
    return prisma.plenumDocument.upsert({ where: { id }, create: data, update: data });
  });
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

async function main() {
  console.log(`Galui ETL → Knesset ${KNESSET} (${BILL_LIMIT} bills, ${SESSION_LIMIT} sessions)`);
  console.log(`Source: https://knesset.gov.il/Odata/ParliamentInfo.svc`);

  await ingestStatuses();
  await ingestFactions();
  await ingestCommittees();
  await ingestPeople();
  await ingestPositions();

  const billIds = await ingestBills();
  await ingestBillInitiators(billIds);

  // --- Committee side: sessions and their agendas -------------------------
  const { items: billItems, sessionIds: billSessionIds } = await findSessionsForBills(billIds);
  const sessionIds = await ingestSessions(billSessionIds);
  const committeeItems = await collectSessionItems(billItems, sessionIds);

  const cmtBackfilled = await backfillReferencedBills(committeeItems);

  // --- Plenum side: sittings, reading histories and recent agendas --------
  const plenumSessionIds = await ingestPlenumSessions();

  step(`KNS_PlmSessionItem — agendas of the ${PLENUM_AGENDA_LIMIT} most recent sittings`);
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
