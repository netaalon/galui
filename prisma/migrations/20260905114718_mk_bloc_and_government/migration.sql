-- AlterTable
ALTER TABLE "PersonPosition" ADD COLUMN "governmentNum" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Person" (
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
    "bloc" TEXT,
    "governmentRole" TEXT,
    "isMinister" BOOLEAN NOT NULL DEFAULT false,
    "mkStartDate" DATETIME,
    "mkEndDate" DATETIME,
    "mkSiteCode" TEXT,
    "imageUrl" TEXT,
    "lastUpdatedDate" DATETIME
);
INSERT INTO "new_Person" ("email", "factionId", "factionName", "firstName", "genderDesc", "imageUrl", "isCurrent", "isMk", "knessetNum", "lastName", "lastUpdatedDate", "mkEndDate", "mkSiteCode", "mkStartDate", "personId", "roleDesc") SELECT "email", "factionId", "factionName", "firstName", "genderDesc", "imageUrl", "isCurrent", "isMk", "knessetNum", "lastName", "lastUpdatedDate", "mkEndDate", "mkSiteCode", "mkStartDate", "personId", "roleDesc" FROM "Person";
DROP TABLE "Person";
ALTER TABLE "new_Person" RENAME TO "Person";
CREATE INDEX "Person_isMk_knessetNum_idx" ON "Person"("isMk", "knessetNum");
CREATE INDEX "Person_bloc_idx" ON "Person"("bloc");
CREATE INDEX "Person_lastName_idx" ON "Person"("lastName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
