-- AlterTable
ALTER TABLE "newsletter_subscribers" ADD COLUMN     "verifyExpires" TIMESTAMP(3);
ALTER TABLE "newsletter_subscribers" ADD COLUMN     "verifyToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_verifyToken_key" ON "newsletter_subscribers"("verifyToken");