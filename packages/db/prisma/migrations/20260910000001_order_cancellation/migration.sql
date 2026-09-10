-- AlterTable
-- Superadmin override cancel (PRD 4.7.4, State_Machine §1.2). CANCELLED is a
-- terminal flag alongside `rejected`, not a stage: the kitchen flow stays
-- stage-driven, and cancel/reject keep their own columns.
ALTER TABLE "orders" ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "cancelled_reason" TEXT;
