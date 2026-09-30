-- AlterTable
ALTER TABLE "RewardSettings" ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "testerEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

