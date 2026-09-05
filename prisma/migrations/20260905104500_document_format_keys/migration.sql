-- Document ids are not unique upstream: the Knesset service publishes the same
-- document once per format (DOC, PDF) as separate rows sharing one id, so the
-- real key is (documentId, applicationId). Keying on the id alone dropped every
-- alternate format. Re-key on a synthetic "<documentId>:<applicationId>".
--
-- These three tables are a mirror of the OData service and are fully rebuilt by
-- `npm run ingest`; they are recreated empty rather than backfilled, because the
-- rows lost to the old key have to be re-fetched anyway.

PRAGMA foreign_keys=OFF;

-- CommitteeParticipant.sourceDocumentId now references SessionDocument.id.
DROP TABLE "SessionDocument";
CREATE TABLE "SessionDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentCommitteeSessionId" TEXT NOT NULL,
    "applicationId" INTEGER NOT NULL DEFAULT 0,
    "committeeSessionId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "SessionDocument_committeeSessionId_fkey" FOREIGN KEY ("committeeSessionId") REFERENCES "CommitteeSession" ("committeeSessionId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionDocument_documentCommitteeSessionId_applicationId_key" ON "SessionDocument"("documentCommitteeSessionId", "applicationId");
CREATE INDEX "SessionDocument_committeeSessionId_idx" ON "SessionDocument"("committeeSessionId");

DROP TABLE "PlenumDocument";
CREATE TABLE "PlenumDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentPlenumSessionId" TEXT NOT NULL,
    "applicationId" INTEGER NOT NULL DEFAULT 0,
    "plenumSessionId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PlenumDocument_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlenumDocument_documentPlenumSessionId_applicationId_key" ON "PlenumDocument"("documentPlenumSessionId", "applicationId");
CREATE INDEX "PlenumDocument_plenumSessionId_idx" ON "PlenumDocument"("plenumSessionId");

DROP TABLE "BillDocument";
CREATE TABLE "BillDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentBillId" TEXT NOT NULL,
    "applicationId" INTEGER NOT NULL DEFAULT 0,
    "billId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "BillDocument_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillDocument_documentBillId_applicationId_key" ON "BillDocument"("documentBillId", "applicationId");
CREATE INDEX "BillDocument_billId_groupTypeId_idx" ON "BillDocument"("billId", "groupTypeId");

-- Participant rows reference documents that no longer exist under the old key.
UPDATE "CommitteeParticipant" SET "sourceDocumentId" = NULL;

PRAGMA foreign_keys=ON;
