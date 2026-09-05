-- CreateTable
CREATE TABLE "GovMinistry" (
    "govMinistryId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedDate" DATETIME
);

-- CreateTable
CREATE TABLE "Question" (
    "questionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" INTEGER,
    "knessetNum" INTEGER,
    "name" TEXT,
    "typeId" INTEGER,
    "typeDesc" TEXT,
    "statusId" INTEGER,
    "personId" INTEGER,
    "govMinistryId" INTEGER,
    "submitDate" DATETIME,
    "replyDatePlanned" DATETIME,
    "replyMinisterDate" DATETIME,
    "replyDaysLate" INTEGER,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "Question_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("personId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_govMinistryId_fkey" FOREIGN KEY ("govMinistryId") REFERENCES "GovMinistry" ("govMinistryId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("statusId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionDocument" (
    "documentQueryId" TEXT NOT NULL PRIMARY KEY,
    "questionId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "QuestionDocument_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("questionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GovMinistry_name_idx" ON "GovMinistry"("name");

-- CreateIndex
CREATE INDEX "Question_personId_idx" ON "Question"("personId");

-- CreateIndex
CREATE INDEX "Question_govMinistryId_idx" ON "Question"("govMinistryId");

-- CreateIndex
CREATE INDEX "Question_submitDate_idx" ON "Question"("submitDate");

-- CreateIndex
CREATE INDEX "Question_replyDaysLate_idx" ON "Question"("replyDaysLate");

-- CreateIndex
CREATE INDEX "QuestionDocument_questionId_idx" ON "QuestionDocument"("questionId");
