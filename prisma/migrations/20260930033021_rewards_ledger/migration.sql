-- CreateEnum
CREATE TYPE "CreditSource" AS ENUM ('SUBMISSION', 'REFERRAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashoutStatus" AS ENUM ('REQUESTED', 'SENT', 'CANCELLED');

-- AlterTable
ALTER TABLE "RewardSettings" ADD COLUMN     "minCashout" DECIMAL(12,2) NOT NULL DEFAULT 25;

-- CreateTable
CREATE TABLE "RewardCredit" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "source" "CreditSource" NOT NULL,
    "submissionId" TEXT,
    "orderId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cashout" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT,
    "email" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CashoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "amazonOrderRef" TEXT,
    "cancelReason" TEXT,
    "handledBy" TEXT,

    CONSTRAINT "Cashout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardCredit_submissionId_key" ON "RewardCredit"("submissionId");

-- CreateIndex
CREATE INDEX "RewardCredit_shop_customerId_idx" ON "RewardCredit"("shop", "customerId");

-- CreateIndex
CREATE INDEX "RewardCredit_shop_orderId_idx" ON "RewardCredit"("shop", "orderId");

-- CreateIndex
CREATE INDEX "Cashout_shop_status_requestedAt_idx" ON "Cashout"("shop", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "Cashout_shop_customerId_idx" ON "Cashout"("shop", "customerId");

