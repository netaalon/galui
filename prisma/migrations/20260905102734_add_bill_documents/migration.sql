-- CreateTable
CREATE TABLE "BillDocument" (
    "documentBillId" TEXT NOT NULL PRIMARY KEY,
    "billId" INTEGER NOT NULL,
    "groupTypeId" INTEGER,
    "groupTypeDesc" TEXT,
    "applicationDesc" TEXT,
    "filePath" TEXT,
    "lastUpdatedDate" DATETIME,
    CONSTRAINT "BillDocument_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("billId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BillDocument_billId_groupTypeId_idx" ON "BillDocument"("billId", "groupTypeId");
