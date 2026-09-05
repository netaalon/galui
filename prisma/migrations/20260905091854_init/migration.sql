-- CreateTable
CREATE TABLE "Person" (
    "personId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "firstName" TEXT,
    "lastName" TEXT,
    "genderDesc" TEXT,
    "email" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "isMk" BOOLEAN NOT NULL DEFAULT false,
    "knessetNum" INTEGER,
    "factionId" INTEGER,
    "factionName" TEXT,
    "roleDesc" TEXT,
    "mkStartDate" DATETIME,
    "mkEndDate" DATETIME,
    "mkSiteCode" TEXT,
    "imageUrl" TEXT,
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "PersonPosition" (
    "personToPositionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "personId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "positionDesc" TEXT,
    "knessetNum" INTEGER,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "factionId" INTEGER,
    "factionName" TEXT,
    "dutyDesc" TEXT,
    "committeeId" INTEGER,
    "committeeName" TEXT,
    "govMinistryName" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PersonPosition_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Faction" (
    "factionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "knessetNum" INTEGER,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "Committee" (
    "committeeId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "categoryDesc" TEXT,
    "knessetNum" INTEGER,
    "committeeTypeDesc" TEXT,
    "parentCommitteeId" INTEGER,
    "parentName" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "Status" (
    "statusId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "desc" TEXT,
    "typeDesc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Bill" (
    "billId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "knessetNum" INTEGER,
    "name" TEXT,
    "subTypeId" INTEGER,
    "subTypeDesc" TEXT,
    "privateNumber" INTEGER,
    "number" INTEGER,
    "committeeId" INTEGER,
    "statusId" INTEGER,
    "postponementReasonDesc" TEXT,
    "publicationDate" DATETIME,
    "summaryLaw" TEXT,
    "publicationSeriesDesc" TEXT,
    "isContinuationBill" BOOLEAN,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "Bill_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee" ("committeeId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bill_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("statusId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillInitiator" (
    "billInitiatorId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "billId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "isInitiator" BOOLEAN NOT NULL DEFAULT false,
    "ordinal" INTEGER,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "BillInitiator_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillInitiator_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommitteeSession" (
    "committeeSessionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" INTEGER,
    "knessetNum" INTEGER,
    "typeDesc" TEXT,
    "committeeId" INTEGER,
    "statusDesc" TEXT,
    "location" TEXT,
    "sessionUrl" TEXT,
    "broadcastUrl" TEXT,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "note" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "CommitteeSession_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee" ("committeeId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionItem" (
    "cmtSessionItemId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER,
    "itemTypeId" INTEGER,
    "itemTypeDesc" TEXT,
    "committeeSessionId" INTEGER NOT NULL,
    "billId" INTEGER,
    "ordinal" INTEGER,
    "statusId" INTEGER,
    "name" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "SessionItem_committeeSessionId_fkey" FOREIGN KEY ("committeeSessionId") REFERENCES "CommitteeSession" ("committeeSessionId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionDocument" (
    "documentCommitteeSessionId" TEXT NOT NULL PRIMARY KEY,
    "committeeSessionId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "SessionDocument_committeeSessionId_fkey" FOREIGN KEY ("committeeSessionId") REFERENCES "CommitteeSession" ("committeeSessionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommitteeParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "committeeSessionId" INTEGER NOT NULL,
    "personId" INTEGER,
    "speakerName" TEXT,
    "role" TEXT,
    "timesSpoken" INTEGER NOT NULL DEFAULT 0,
    "sourceDocumentId" TEXT,
    "matchConfidence" REAL,
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractionModel" TEXT,
    CONSTRAINT "CommitteeParticipant_committeeSessionId_fkey" FOREIGN KEY ("committeeSessionId") REFERENCES "CommitteeSession" ("committeeSessionId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommitteeParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommitteeParticipant_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SessionDocument" ("documentCommitteeSessionId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "rowsFetched" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT
);

-- CreateIndex
CREATE INDEX "Person_isMk_knessetNum_idx" ON "Person"("isMk", "knessetNum");

-- CreateIndex
CREATE INDEX "Person_lastName_idx" ON "Person"("lastName");

-- CreateIndex
CREATE INDEX "PersonPosition_personId_idx" ON "PersonPosition"("personId");

-- CreateIndex
CREATE INDEX "PersonPosition_positionId_knessetNum_idx" ON "PersonPosition"("positionId", "knessetNum");

-- CreateIndex
CREATE INDEX "Faction_knessetNum_idx" ON "Faction"("knessetNum");

-- CreateIndex
CREATE INDEX "Committee_knessetNum_idx" ON "Committee"("knessetNum");

-- CreateIndex
CREATE INDEX "Bill_knessetNum_lastUpdatedDate_idx" ON "Bill"("knessetNum", "lastUpdatedDate");

-- CreateIndex
CREATE INDEX "Bill_publicationDate_idx" ON "Bill"("publicationDate");

-- CreateIndex
CREATE INDEX "Bill_committeeId_idx" ON "Bill"("committeeId");

-- CreateIndex
CREATE INDEX "BillInitiator_billId_idx" ON "BillInitiator"("billId");

-- CreateIndex
CREATE INDEX "BillInitiator_personId_idx" ON "BillInitiator"("personId");

-- CreateIndex
CREATE INDEX "CommitteeSession_knessetNum_startDate_idx" ON "CommitteeSession"("knessetNum", "startDate");

-- CreateIndex
CREATE INDEX "CommitteeSession_committeeId_idx" ON "CommitteeSession"("committeeId");

-- CreateIndex
CREATE INDEX "SessionItem_committeeSessionId_idx" ON "SessionItem"("committeeSessionId");

-- CreateIndex
CREATE INDEX "SessionItem_billId_idx" ON "SessionItem"("billId");

-- CreateIndex
CREATE INDEX "SessionItem_itemTypeId_itemId_idx" ON "SessionItem"("itemTypeId", "itemId");

-- CreateIndex
CREATE INDEX "SessionDocument_committeeSessionId_idx" ON "SessionDocument"("committeeSessionId");

-- CreateIndex
CREATE INDEX "CommitteeParticipant_personId_idx" ON "CommitteeParticipant"("personId");

-- CreateIndex
CREATE INDEX "CommitteeParticipant_committeeSessionId_idx" ON "CommitteeParticipant"("committeeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeParticipant_committeeSessionId_speakerName_key" ON "CommitteeParticipant"("committeeSessionId", "speakerName");

-- CreateIndex
CREATE INDEX "IngestRun_entity_startedAt_idx" ON "IngestRun"("entity", "startedAt");
