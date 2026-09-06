-- CreateTable
CREATE TABLE "PlenumVote" (
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
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "PlenumVoteResult" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "voteId" INTEGER NOT NULL,
    "mkId" INTEGER NOT NULL,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    CONSTRAINT "PlenumVoteResult_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "PlenumVote" ("voteId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlenumVote_voteDateTime_idx" ON "PlenumVote"("voteDateTime");
CREATE INDEX "PlenumVote_plenumSessionId_idx" ON "PlenumVote"("plenumSessionId");
CREATE INDEX "PlenumVote_itemId_idx" ON "PlenumVote"("itemId");
CREATE INDEX "PlenumVoteResult_voteId_idx" ON "PlenumVoteResult"("voteId");
CREATE INDEX "PlenumVoteResult_mkId_idx" ON "PlenumVoteResult"("mkId");
