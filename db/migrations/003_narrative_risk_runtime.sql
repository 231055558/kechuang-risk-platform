ALTER TABLE narrative_risk.sources
  ADD COLUMN IF NOT EXISTS web_url_required BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE narrative_risk.metrics
  ADD COLUMN IF NOT EXISTS metric_class TEXT NOT NULL DEFAULT 'proxy'
    CHECK (metric_class IN ('formal', 'proxy', 'invalid', 'missing'));

ALTER TABLE narrative_risk.metrics
  ADD COLUMN IF NOT EXISTS score_exclusion_reason TEXT;

CREATE TABLE IF NOT EXISTS narrative_risk.source_artifacts (
  artifact_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES narrative_risk.sources(source_key),
  update_run_id BIGINT REFERENCES platform.data_update_runs(update_run_id),
  status TEXT NOT NULL CHECK (
    status IN ('archived', 'unavailable', 'not-required', 'pending-review')
  ),
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN ('pdf', 'html', 'local-source', 'metadata-only')
  ),
  canonical_url TEXT,
  final_url TEXT,
  http_status INTEGER,
  content_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  content_sha256 TEXT CHECK (
    content_sha256 IS NULL OR length(content_sha256) = 64
  ),
  storage_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'metadata-only')),
  public_excerpt TEXT,
  fetched_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_key)
);

CREATE INDEX IF NOT EXISTS idx_narrative_source_artifacts_status
  ON narrative_risk.source_artifacts (status, updated_at DESC);

UPDATE narrative_risk.sources
SET web_url_required = FALSE
WHERE channel IN ('用户文档', '本地审计数据', '统一客观数据集派生来源');

UPDATE narrative_risk.metrics
SET
  metric_class = CASE
    WHEN validation_status LIKE 'missing%' OR raw_numeric_value IS NULL
      THEN 'missing'
    WHEN validation_status LIKE 'invalidated%'
      OR validation_status LIKE 'superseded%'
      THEN 'invalid'
    WHEN is_score_eligible THEN 'formal'
    ELSE 'proxy'
  END,
  score_exclusion_reason = CASE
    WHEN is_score_eligible THEN NULL
    WHEN validation_status LIKE 'missing%' OR raw_numeric_value IS NULL
      THEN COALESCE(limitation, '缺少可验证数值')
    WHEN validation_status LIKE 'invalidated%'
      OR validation_status LIKE 'superseded%'
      THEN validation_status
    ELSE '代理口径仅供观察，不进入总分'
  END;

DO $$
BEGIN
  IF to_regrole('kechuang_api') IS NOT NULL THEN
    GRANT SELECT ON narrative_risk.source_artifacts TO kechuang_api;
  END IF;
  IF to_regrole('kechuang_ingest') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON narrative_risk.source_artifacts
      TO kechuang_ingest;
  END IF;
END
$$;
