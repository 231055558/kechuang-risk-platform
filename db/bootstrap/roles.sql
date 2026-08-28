DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kechuang_api') THEN
    CREATE ROLE kechuang_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kechuang_ingest') THEN
    CREATE ROLE kechuang_ingest NOLOGIN;
  END IF;
END
$$;

GRANT kechuang_api TO kechuang_ingest;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO kechuang_api, kechuang_ingest',
    current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA risk_data TO kechuang_api, kechuang_ingest;
GRANT SELECT ON ALL TABLES IN SCHEMA risk_data TO kechuang_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA risk_data
  TO kechuang_ingest;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA risk_data
  TO kechuang_ingest;

GRANT USAGE ON SCHEMA platform TO kechuang_api, kechuang_ingest;
GRANT SELECT ON
  platform.snapshot_import_runs,
  platform.data_update_runs
  TO kechuang_api;
GRANT SELECT, INSERT, UPDATE ON
  platform.snapshot_import_runs,
  platform.data_update_runs,
  platform.review_queue
  TO kechuang_ingest;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform
  TO kechuang_ingest;
