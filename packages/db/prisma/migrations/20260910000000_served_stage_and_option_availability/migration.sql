-- Recorded after the fact: both changes reached the dev database through
-- `prisma db push` while the feature was being built, which leaves the
-- migration history behind the schema. A fresh database (production) only
-- ever replays migrations, so without this file it would come up missing
-- the SERVED stage and the per-option availability flag.

-- AlterEnum
-- Placed before CUSTOM to match the schema's ordering (State_Machine §1.1).
-- PostgreSQL 12+ permits ADD VALUE inside the migration transaction as long
-- as the new value is not used in that same transaction; nothing here uses it.
ALTER TYPE "StageSemantic" ADD VALUE 'SERVED' BEFORE 'CUSTOM';

-- AlterTable
-- Per-option sold-out toggle (PRD 4.5.4). Existing options stay orderable.
ALTER TABLE "customization_options" ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true;
