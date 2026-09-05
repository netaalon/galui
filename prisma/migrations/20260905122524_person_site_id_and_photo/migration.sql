-- AlterTable
ALTER TABLE "Person" ADD COLUMN "imageCredit" TEXT;
ALTER TABLE "Person" ADD COLUMN "imageLicense" TEXT;
ALTER TABLE "Person" ADD COLUMN "imageSourceUrl" TEXT;
ALTER TABLE "Person" ADD COLUMN "siteId" INTEGER;

-- CreateIndex
CREATE INDEX "Person_siteId_idx" ON "Person"("siteId");
