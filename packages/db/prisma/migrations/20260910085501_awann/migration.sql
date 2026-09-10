/*
  Warnings:

  - You are about to drop the column `cancelled_reason` on the `orders` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "cancelled_reason",
ADD COLUMN     "cancelledReason" TEXT;
