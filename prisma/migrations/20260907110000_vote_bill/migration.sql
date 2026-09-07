-- Relate a vote to the bill it decided.
--
-- `itemId` is whatever the vote was about and is NOT always a bill: this term
-- has 774 votes on motions, statutory actions and plenum items. `billId` is set
-- only where the feed's own typing (KNS_PlmSessionItem.ItemTypeID = 2) says the
-- id is a bill, which is why it is a separate derived column rather than a
-- foreign key on itemId. SQLite cannot add a foreign key in place.

CREATE TABLE "new_PlenumVote" (
    "voteId" INTEGER NOT NULL PRIMARY KEY,
    "voteDateTime" DATETIME,
    "plenumSessionId" INTEGER,
    "itemId" INTEGER,
    "billId" INTEGER,
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
    CONSTRAINT "PlenumVote_plenumSessionId_fkey" FOREIGN KEY ("plenumSessionId") REFERENCES "PlenumSession" ("plenumSessionId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlenumVote_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlenumVote" ("voteId","voteDateTime","plenumSessionId","itemId","ordinal","methodDesc","statusDesc","title","subject","isNoConfidence","forCount","againstCount","abstainCount","presentCount","totalCount","lastUpdatedDate")
SELECT "voteId","voteDateTime","plenumSessionId","itemId","ordinal","methodDesc","statusDesc","title","subject","isNoConfidence","forCount","againstCount","abstainCount","presentCount","totalCount","lastUpdatedDate" FROM "PlenumVote";

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
CREATE INDEX "PlenumVoteResult_voteId_idx" ON "PlenumVoteResult"("voteId");
CREATE INDEX "PlenumVoteResult_mkId_idx" ON "PlenumVoteResult"("mkId");
CREATE INDEX "PlenumVoteResult_personId_idx" ON "PlenumVoteResult"("personId");
