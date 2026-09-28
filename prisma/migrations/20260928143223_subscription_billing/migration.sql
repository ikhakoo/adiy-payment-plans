-- AlterTable
ALTER TABLE "Installment" DROP COLUMN "paymentReferenceId",
ADD COLUMN     "billingAttemptId" TEXT,
ADD COLUMN     "chargeOrderId" TEXT,
ADD COLUMN     "chargeOrderName" TEXT;

-- AlterTable
ALTER TABLE "PaymentPlan" DROP COLUMN "mandateId",
ADD COLUMN     "contractId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "installmentProductId" TEXT,
ADD COLUMN     "installmentVariantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlan_contractId_key" ON "PaymentPlan"("contractId");

