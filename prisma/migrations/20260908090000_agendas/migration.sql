-- Motions for the agenda, and what each vote was actually deciding.
--
-- 6,762 of the term's 7,536 plenum votes decided a bill. Of the other 774, 375
-- decided a KNS_Agenda row — a motion for the agenda or a quick debate — which
-- until now was a numeric `itemId` pointing at a table we did not mirror.
--
-- `agendaId` is derived, not a foreign key on `itemId`, for the same reason
-- `billId` is: agenda ids and bill ids share one numeric space (bills run
-- 478,929-2,245,298, agendas 2,199,266-2,244,999, interleaved). No id is in
-- both sets today, but the link goes through the feed's own typing in
-- KNS_PlmSessionItem rather than trusting that.
--
-- `isNoConfidence` is dropped rather than kept. It mirrored
-- KNS_PlenumVote.IsNoConfidenceInGov, which is true on 4 of 36,181 votes
-- upstream and 0 of ours, while this term held 219 no-confidence motions. A
-- column that is false on every no-confidence vote in the mirror is worse than
-- no column; `kind` records them, derived from the title formula.
--
-- SQLite cannot add a foreign key in place, so PlenumVote is recreated. Its
-- children are recreated with it because their FK follows the table name.

CREATE TABLE "Agenda" (
    "agendaId" INTEGER NOT NULL PRIMARY KEY,
    "knessetNum" INTEGER,
    "number" INTEGER,
    "name" TEXT,
    "subTypeId" INTEGER,
    "subTypeDesc" TEXT,
    "classificationId" INTEGER,
    "classificationDesc" TEXT,
    "statusId" INTEGER,
    "initiatorPersonId" INTEGER,
    "committeeId" INTEGER,
    "postponementReasonDesc" TEXT,
    "presidentDecisionDate" DATETIME,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "Agenda_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("statusId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agenda_initiatorPersonId_fkey" FOREIGN KEY ("initiatorPersonId") REFERENCES "Person" ("personId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agenda_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee" ("committeeId") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Agenda_knessetNum_idx" ON "Agenda"("knessetNum");
CREATE INDEX "Agenda_initiatorPersonId_idx" ON "Agenda"("initiatorPersonId");
CREATE INDEX "Agenda_committeeId_idx" ON "Agenda"("committeeId");
CREATE INDEX "Agenda_subTypeDesc_idx" ON "Agenda"("subTypeDesc");

CREATE TABLE "new_PlenumVote" (
    "voteId" INTEGER NOT NULL PRIMARY KEY,
    "voteDateTime" DATETIME,
    "plenumSessionId" INTEGER,
    "itemId" INTEGER,
    "billId" INTEGER,
    "agendaId" INTEGER,
    "ordinal" INTEGER,
    "methodDesc" TEXT,
    "statusDesc" TEXT,
    "title" TEXT,
    "subject" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "forCount" INTEGER NOT NULL DEFAULT 0,
    "againstCount" INTEGER NOT NULL DEFAULT 0,
    "abstainCount" INTEGER NOT NULL DEFAULT 0,
    "presentCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PlenumVote_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlenumVote_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlenumVote_agendaId_fkey" FOREIGN KEY ("agendaId") REFERENCES "Agenda" ("agendaId") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Every existing vote keeps its kind as the default 'other' until
-- resolveVoteKinds() runs; the bill ones are set here because billId already
-- carries the answer and a half-classified table is a trap.
INSERT INTO "new_PlenumVote" ("voteId","voteDateTime","plenumSessionId","itemId","billId","ordinal","methodDesc","statusDesc","title","subject","kind","forCount","againstCount","abstainCount","presentCount","totalCount","lastUpdatedDate")
SELECT "voteId","voteDateTime","plenumSessionId","itemId","billId","ordinal","methodDesc","statusDesc","title","subject",
       CASE WHEN "billId" IS NOT NULL THEN 'bill' ELSE 'other' END,
       "forCount","againstCount","abstainCount","presentCount","totalCount","lastUpdatedDate"
  FROM "PlenumVote";

CREATE TABLE "new_PlenumVoteResult" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "voteId" INTEGER NOT NULL,
    "mkId" INTEGER NOT NULL,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "personId" INTEGER,
    CONSTRAINT "PlenumVoteResult_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "new_PlenumVote" ("voteId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlenumVoteResult_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlenumVoteResult" SELECT "id","voteId","mkId","resultCode","resultDesc","firstName","lastName","personId" FROM "PlenumVoteResult";

DROP TABLE "PlenumVoteResult";
DROP TABLE "PlenumVote";
ALTER TABLE "new_PlenumVote" RENAME TO "PlenumVote";
ALTER TABLE "new_PlenumVoteResult" RENAME TO "PlenumVoteResult";

CREATE INDEX "PlenumVote_voteDateTime_idx" ON "PlenumVote"("voteDateTime");
CREATE INDEX "PlenumVote_plenumSessionId_idx" ON "PlenumVote"("plenumSessionId");
CREATE INDEX "PlenumVote_itemId_idx" ON "PlenumVote"("itemId");
CREATE INDEX "PlenumVote_billId_idx" ON "PlenumVote"("billId");
CREATE INDEX "PlenumVote_agendaId_idx" ON "PlenumVote"("agendaId");
CREATE INDEX "PlenumVote_kind_idx" ON "PlenumVote"("kind");
CREATE INDEX "PlenumVoteResult_voteId_idx" ON "PlenumVoteResult"("voteId");
CREATE INDEX "PlenumVoteResult_mkId_idx" ON "PlenumVoteResult"("mkId");
CREATE INDEX "PlenumVoteResult_personId_idx" ON "PlenumVoteResult"("personId");
