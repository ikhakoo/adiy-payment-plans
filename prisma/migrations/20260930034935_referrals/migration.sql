-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('ISSUED', 'ORDERED', 'QUALIFIED', 'FLAGGED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "RewardSettings" ADD COLUMN     "referralCodeDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "referralFriendAmount" DECIMAL(12,2) NOT NULL DEFAULT 300,
ADD COLUMN     "referralMinOrder" DECIMAL(12,2) NOT NULL DEFAULT 2000,
ADD COLUMN     "referralReward" DECIMAL(12,2) NOT NULL DEFAULT 300,
ADD COLUMN     "referralWaitDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "ReferrerCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferrerCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "referrerCodeId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "friendEmail" TEXT NOT NULL,
    "friendCustomerId" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'ISSUED',
    "orderId" TEXT,
    "orderName" TEXT,
    "orderedAt" TIMESTAMP(3),
    "qualifiesAt" TIMESTAMP(3),
    "creditId" TEXT,
    "flagReason" TEXT,
    "rejectReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferrerCode_code_key" ON "ReferrerCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferrerCode_shop_customerId_key" ON "ReferrerCode"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_discountCode_key" ON "Referral"("discountCode");

-- CreateIndex
CREATE INDEX "Referral_shop_status_idx" ON "Referral"("shop", "status");

-- CreateIndex
CREATE INDEX "Referral_shop_referrerCustomerId_idx" ON "Referral"("shop", "referrerCustomerId");

-- CreateIndex
CREATE INDEX "Referral_shop_friendEmail_idx" ON "Referral"("shop", "friendEmail");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerCodeId_fkey" FOREIGN KEY ("referrerCodeId") REFERENCES "ReferrerCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

