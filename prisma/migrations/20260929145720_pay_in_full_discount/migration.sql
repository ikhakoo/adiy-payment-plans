-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "payInFullDiscountId" TEXT,
ADD COLUMN     "payInFullType" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "payInFullValue" DECIMAL(12,2);

