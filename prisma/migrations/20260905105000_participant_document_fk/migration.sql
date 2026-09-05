-- SessionDocument was re-keyed on a synthetic id, so CommitteeParticipant's
-- foreign key must follow: SQLite requires a foreign key to reference a primary
-- key or a unique column, and documentCommitteeSessionId is now only unique in
-- combination with applicationId. Left unchanged it raises
-- "foreign key mismatch" on any write touching the session graph.

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CommitteeParticipant" (
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
    CONSTRAINT "CommitteeParticipant_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SessionDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_CommitteeParticipant" ("id","committeeSessionId","personId","speakerName","role","timesSpoken","sourceDocumentId","matchConfidence","extractedAt","extractionModel")
SELECT "id","committeeSessionId","personId","speakerName","role","timesSpoken","sourceDocumentId","matchConfidence","extractedAt","extractionModel" FROM "CommitteeParticipant";

DROP TABLE "CommitteeParticipant";
ALTER TABLE "new_CommitteeParticipant" RENAME TO "CommitteeParticipant";

CREATE INDEX "CommitteeParticipant_personId_idx" ON "CommitteeParticipant"("personId");
CREATE INDEX "CommitteeParticipant_committeeSessionId_idx" ON "CommitteeParticipant"("committeeSessionId");
CREATE UNIQUE INDEX "CommitteeParticipant_committeeSessionId_speakerName_key" ON "CommitteeParticipant"("committeeSessionId", "speakerName");

PRAGMA foreign_keys=ON;
