-- CreateTable
CREATE TABLE "JointCommittee" (
    "committeeId" INTEGER NOT NULL,
    "participantCommitteeId" INTEGER NOT NULL,
    "jointCommitteeId" TEXT,
    "lastUpdatedDate" DATETIME,

    PRIMARY KEY ("committeeId", "participantCommitteeId"),
    CONSTRAINT "JointCommittee_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee" ("committeeId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JointCommittee_participantCommitteeId_fkey" FOREIGN KEY ("participantCommitteeId") REFERENCES "Committee" ("committeeId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Committee" (
    "committeeId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "categoryDesc" TEXT,
    "knessetNum" INTEGER,
    "committeeTypeDesc" TEXT,
    "parentCommitteeId" INTEGER,
    "parentName" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "Committee_parentCommitteeId_fkey" FOREIGN KEY ("parentCommitteeId") REFERENCES "Committee" ("committeeId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Committee" ("categoryDesc", "committeeId", "committeeTypeDesc", "isCurrent", "knessetNum", "lastUpdatedDate", "name", "parentCommitteeId", "parentName") SELECT "categoryDesc", "committeeId", "committeeTypeDesc", "isCurrent", "knessetNum", "lastUpdatedDate", "name", "parentCommitteeId", "parentName" FROM "Committee";
DROP TABLE "Committee";
ALTER TABLE "new_Committee" RENAME TO "Committee";
CREATE INDEX "Committee_knessetNum_idx" ON "Committee"("knessetNum");
CREATE INDEX "Committee_parentCommitteeId_idx" ON "Committee"("parentCommitteeId");
CREATE INDEX "Committee_committeeTypeDesc_idx" ON "Committee"("committeeTypeDesc");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "JointCommittee_participantCommitteeId_idx" ON "JointCommittee"("participantCommitteeId");
