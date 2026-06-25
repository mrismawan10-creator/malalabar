-- Prisma cannot express partial unique indexes in the schema DSL.
-- This enforces the one-OPEN-session-per-table rule at the database level.
-- The service layer also uses a Redis lock as a fast guard (SDD §5.1).
CREATE UNIQUE INDEX one_open_session_per_table
  ON table_sessions ("tableId")
  WHERE status = 'OPEN';
