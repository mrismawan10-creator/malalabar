-- Kitchen device token revocation (CLAUDE.md hard rule 6).
-- The KDS JWT now carries `ver`; rotating a device token bumps this column so
-- every session minted from the previous token stops verifying immediately.
ALTER TABLE "kitchen_devices" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;
