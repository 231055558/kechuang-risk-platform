CREATE TABLE IF NOT EXISTS platform.snapshot_import_runs (
  import_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  target_schema TEXT NOT NULL,
  previous_schema TEXT,
  sqlite_version TEXT,
  table_counts JSONB NOT NULL DEFAULT '{}'::JSONB,
  view_count INTEGER,
  foreign_key_count INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_import_runs_started_at
  ON platform.snapshot_import_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS platform.data_update_runs (
  update_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'succeeded', 'failed', 'needs-review')
  ),
  watermark_from TIMESTAMPTZ,
  watermark_to TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_update_runs_job_started_at
  ON platform.data_update_runs (job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS platform.review_queue (
  review_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  update_run_id BIGINT REFERENCES platform.data_update_runs(update_run_id),
  item_type TEXT NOT NULL,
  company_key TEXT,
  source_url TEXT,
  payload JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'superseded')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status_created_at
  ON platform.review_queue (status, created_at);

