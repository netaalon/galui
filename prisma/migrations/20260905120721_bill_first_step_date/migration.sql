-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "firstStepDate" DATETIME;
ALTER TABLE "Bill" ADD COLUMN "firstStepSource" TEXT;

-- CreateIndex
CREATE INDEX "Bill_firstStepDate_idx" ON "Bill"("firstStepDate");
