-- Runs once, on first container start (empty volume). LOCAL DEV ONLY.
-- app_user: runtime role (NOBYPASSRLS, not an owner). Password matches .env.example (APP_DB_PASSWORD).
-- The roles migration (packages/db/migrations/*_w0_roles.sql) is idempotent and re-asserts attributes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END$$;
CREATE DATABASE relay_test;
