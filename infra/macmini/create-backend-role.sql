DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'kechuang_backend'
  ) THEN
    CREATE ROLE kechuang_backend
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      CONNECTION LIMIT 12
      IN ROLE kechuang_api;
  END IF;
END
$$;

GRANT kechuang_api TO kechuang_backend;
GRANT CONNECT ON DATABASE kechuang_risk TO kechuang_backend;
GRANT SELECT ON platform.data_update_runs TO kechuang_api;
