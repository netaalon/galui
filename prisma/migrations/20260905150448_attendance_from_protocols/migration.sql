/*
  Warnings:

  - You are about to drop the column `extractionModel` on the `CommitteeParticipant` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CommitteeParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "committeeSessionId" INTEGER NOT NULL,
    "personId" INTEGER,
    "speakerName" TEXT,
    "role" TEXT,
    "roleDetail" TEXT,
    "affiliation" TEXT,
    "timesSpoken" INTEGER NOT NULL DEFAULT 0,
    "sourceDocumentId" TEXT,
    "extractedBy" TEXT,
    "matchConfidence" REAL,
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommitteeParticipant_committeeSessionId_fkey" FOREIGN KEY ("committeeSessionId") REFERENCES "CommitteeSession" ("committeeSessionId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommitteeParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommitteeParticipant_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SessionDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CommitteeParticipant" ("committeeSessionId", "extractedAt", "id", "matchConfidence", "personId", "role", "sourceDocumentId", "speakerName", "timesSpoken") SELECT "committeeSessionId", "extractedAt", "id", "matchConfidence", "personId", "role", "sourceDocumentId", "speakerName", "timesSpoken" FROM "CommitteeParticipant";
DROP TABLE "CommitteeParticipant";
ALTER TABLE "new_CommitteeParticipant" RENAME TO "CommitteeParticipant";
CREATE INDEX "CommitteeParticipant_personId_idx" ON "CommitteeParticipant"("personId");
CREATE INDEX "CommitteeParticipant_committeeSessionId_idx" ON "CommitteeParticipant"("committeeSessionId");
CREATE INDEX "CommitteeParticipant_role_idx" ON "CommitteeParticipant"("role");
CREATE UNIQUE INDEX "CommitteeParticipant_committeeSessionId_speakerName_key" ON "CommitteeParticipant"("committeeSessionId", "speakerName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
