-- Connect votes to their sitting and their member.
--
-- `personId` is derived from the name the feed denormalises onto each result
-- row, because `mkId` is a third person id space no entity relates to
-- `Person.personId`. SQLite cannot add a foreign key to an existing table, so
-- both tables are recreated.

-- PlenumVote: relate plenumSessionId to PlenumSession
CREATE TABLE "new_PlenumVote" (
    "voteId" INTEGER NOT NULL PRIMARY KEY,
    "voteDateTime" DATETIME,
    "plenumSessionId" INTEGER,
    "itemId" INTEGER,
    "ordinal" INTEGER,
    "methodDesc" TEXT,
    "statusDesc" TEXT,
    "title" TEXT,
    "subject" TEXT,
    "isNoConfidence" BOOLEAN NOT NULL DEFAULT false,
    "forCount" INTEGER NOT NULL DEFAULT 0,
    "againstCount" INTEGER NOT NULL DEFAULT 0,
    "abstainCount" INTEGER NOT NULL DEFAULT 0,
    "presentCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "PlenumVote_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlenumVote" SELECT
    "voteId","voteDateTime","plenumSessionId","itemId","ordinal","methodDesc","statusDesc",
    "title","subject","isNoConfidence","forCount","againstCount","abstainCount",
    "presentCount","totalCount","lastUpdatedDate" FROM "PlenumVote";

-- PlenumVoteResult: add the derived personId, keeping the FK to the new vote table
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
INSERT INTO "new_PlenumVoteResult" ("id","voteId","mkId","resultCode","resultDesc","firstName","lastName")
SELECT "id","voteId","mkId","resultCode","resultDesc","firstName","lastName" FROM "PlenumVoteResult";

DROP TABLE "PlenumVoteResult";
DROP TABLE "PlenumVote";
ALTER TABLE "new_PlenumVote" RENAME TO "PlenumVote";
ALTER TABLE "new_PlenumVoteResult" RENAME TO "PlenumVoteResult";

CREATE INDEX "PlenumVote_voteDateTime_idx" ON "PlenumVote"("voteDateTime");
CREATE INDEX "PlenumVote_plenumSessionId_idx" ON "PlenumVote"("plenumSessionId");
CREATE INDEX "PlenumVote_itemId_idx" ON "PlenumVote"("itemId");
CREATE INDEX "PlenumVoteResult_voteId_idx" ON "PlenumVoteResult"("voteId");
CREATE INDEX "PlenumVoteResult_mkId_idx" ON "PlenumVoteResult"("mkId");
CREATE INDEX "PlenumVoteResult_personId_idx" ON "PlenumVoteResult"("personId");
