// Set required env vars before any module in the test file is evaluated.
// vitest runs setupFiles before importing the test module.
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
process.env["REDIS_URL"] = "redis://localhost:6379";
process.env["JWT_SECRET"] = "test-jwt-secret-at-least-32-characters-long";
process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret-32-chars-here!!";
process.env["NODE_ENV"] = "test";
