/*
  Warnings:

  - You are about to drop the column `defaultAfterFails` on the `Settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "defaultAfterFails",
ADD COLUMN     "planCounts" JSONB;
