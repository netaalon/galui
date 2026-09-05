-- CreateTable
CREATE TABLE "PlenumSession" (
    "plenumSessionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" INTEGER,
    "knessetNum" INTEGER,
    "name" TEXT,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "isSpecialMeeting" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "PlenumSessionItem" (
    "plmSessionItemId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER,
    "itemTypeId" INTEGER,
    "itemTypeDesc" TEXT,
    "plenumSessionId" INTEGER NOT NULL,
    "billId" INTEGER,
    "ordinal" INTEGER,
    "statusId" INTEGER,
    "name" TEXT,
    "isDiscussion" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PlenumSessionItem_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlenumSessionItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlenumSessionItem_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("statusId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlenumDocument" (
    "documentPlenumSessionId" TEXT NOT NULL PRIMARY KEY,
    "plenumSessionId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PlenumDocument_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionItem" (
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
    CONSTRAINT "SessionItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionItem_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("statusId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionItem" ("billId", "cmtSessionItemId", "committeeSessionId", "itemId", "itemTypeDesc", "itemTypeId", "lastUpdatedDate", "name", "ordinal", "statusId") SELECT "billId", "cmtSessionItemId", "committeeSessionId", "itemId", "itemTypeDesc", "itemTypeId", "lastUpdatedDate", "name", "ordinal", "statusId" FROM "SessionItem";
DROP TABLE "SessionItem";
ALTER TABLE "new_SessionItem" RENAME TO "SessionItem";
CREATE INDEX "SessionItem_committeeSessionId_idx" ON "SessionItem"("committeeSessionId");
CREATE INDEX "SessionItem_billId_idx" ON "SessionItem"("billId");
CREATE INDEX "SessionItem_itemTypeId_itemId_idx" ON "SessionItem"("itemTypeId", "itemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlenumSession_knessetNum_startDate_idx" ON "PlenumSession"("knessetNum", "startDate");

-- CreateIndex
CREATE INDEX "PlenumSessionItem_plenumSessionId_idx" ON "PlenumSessionItem"("plenumSessionId");

-- CreateIndex
CREATE INDEX "PlenumSessionItem_billId_idx" ON "PlenumSessionItem"("billId");

-- CreateIndex
CREATE INDEX "PlenumSessionItem_itemTypeId_itemId_idx" ON "PlenumSessionItem"("itemTypeId", "itemId");

-- CreateIndex
CREATE INDEX "PlenumDocument_plenumSessionId_idx" ON "PlenumDocument"("plenumSessionId");
