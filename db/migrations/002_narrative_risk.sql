CREATE SCHEMA IF NOT EXISTS narrative_risk;

CREATE TABLE IF NOT EXISTS narrative_risk.import_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  source_files JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  ego_validation_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS narrative_risk.scopes (
  scope_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES narrative_risk.import_runs(run_id),
  label TEXT NOT NULL,
  methodology TEXT NOT NULL,
  as_of_date DATE,
  company_count INTEGER NOT NULL CHECK (company_count >= 0),
  notes JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS narrative_risk.companies (
  company_key TEXT PRIMARY KEY,
  short_name TEXT NOT NULL,
  full_name TEXT,
  stock_code TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::JSONB,
  master_company_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS narrative_risk.scope_companies (
  scope_id TEXT NOT NULL REFERENCES narrative_risk.scopes(scope_id),
  company_key TEXT NOT NULL REFERENCES narrative_risk.companies(company_key),
  sample_role TEXT,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  data_cutoff DATE,
  concept_label TEXT,
  sample_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (scope_id, company_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.assessments (
  scope_id TEXT NOT NULL,
  company_key TEXT NOT NULL,
  objective_risk_score DOUBLE PRECISION,
  weighted_coverage DOUBLE PRECISION,
  pdqi_value DOUBLE PRECISION,
  pdqi_variant TEXT,
  pdqi_risk_pct DOUBLE PRECISION,
  itag_value DOUBLE PRECISION,
  itag_variant TEXT,
  tone_value DOUBLE PRECISION,
  tone_variant TEXT,
  finance_dimension_score DOUBLE PRECISION,
  joint_risk_level TEXT,
  conclusion TEXT,
  validation_status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (scope_id, company_key),
  FOREIGN KEY (scope_id, company_key)
    REFERENCES narrative_risk.scope_companies(scope_id, company_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.sources (
  source_key TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES narrative_risk.scopes(scope_id),
  source_id TEXT NOT NULL,
  company_key TEXT REFERENCES narrative_risk.companies(company_key),
  channel TEXT,
  title TEXT,
  institution TEXT,
  normalized_media TEXT,
  author TEXT,
  publication_date DATE,
  url TEXT,
  validated_url TEXT,
  local_path TEXT,
  sha256 TEXT,
  effective_word_count BIGINT,
  cutoff_class TEXT,
  evidence_role TEXT,
  formal_eligible BOOLEAN,
  exclusion_reason TEXT,
  raw_occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (raw_occurrence_count > 0),
  raw_row_numbers JSONB NOT NULL DEFAULT '[]'::JSONB,
  local_file_status TEXT,
  validation_status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (scope_id, source_id)
);

CREATE TABLE IF NOT EXISTS narrative_risk.metrics (
  metric_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  company_key TEXT NOT NULL,
  indicator_id TEXT,
  metric_name TEXT NOT NULL,
  metric_variant TEXT NOT NULL,
  raw_numeric_value DOUBLE PRECISION,
  validated_numeric_value DOUBLE PRECISION,
  text_value JSONB,
  unit TEXT,
  status TEXT,
  validation_status TEXT NOT NULL,
  confidence_score DOUBLE PRECISION,
  confidence_level TEXT,
  formula TEXT,
  as_of_date DATE,
  limitation TEXT,
  is_score_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  FOREIGN KEY (scope_id, company_key)
    REFERENCES narrative_risk.scope_companies(scope_id, company_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.metric_source_links (
  metric_id TEXT NOT NULL REFERENCES narrative_risk.metrics(metric_id),
  source_key TEXT NOT NULL REFERENCES narrative_risk.sources(source_key),
  raw_occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (raw_occurrence_count > 0),
  PRIMARY KEY (metric_id, source_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.coverage (
  scope_id TEXT NOT NULL,
  company_key TEXT NOT NULL,
  indicator_id TEXT NOT NULL,
  coverage_status TEXT NOT NULL,
  original_definition_usable BOOLEAN,
  document_method_usable BOOLEAN,
  confidence_score DOUBLE PRECISION,
  confidence_level TEXT,
  observation_count INTEGER,
  numeric_observation_count INTEGER,
  limitation TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (scope_id, company_key, indicator_id),
  FOREIGN KEY (scope_id, company_key)
    REFERENCES narrative_risk.scope_companies(scope_id, company_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.events (
  event_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  company_key TEXT NOT NULL,
  event_date TEXT,
  event_title TEXT NOT NULL,
  event_type TEXT,
  first_public_time TEXT,
  feature_role TEXT,
  label_role TEXT,
  severity TEXT,
  source_id TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  FOREIGN KEY (scope_id, company_key)
    REFERENCES narrative_risk.scope_companies(scope_id, company_key)
);

CREATE TABLE IF NOT EXISTS narrative_risk.audit_findings (
  finding_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES narrative_risk.import_runs(run_id),
  scope_id TEXT REFERENCES narrative_risk.scopes(scope_id),
  company_key TEXT REFERENCES narrative_risk.companies(company_key),
  source_id TEXT,
  metric_id TEXT REFERENCES narrative_risk.metrics(metric_id),
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS narrative_risk.browser_validations (
  validation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES narrative_risk.import_runs(run_id),
  source_id TEXT,
  metric_id TEXT REFERENCES narrative_risk.metrics(metric_id),
  url TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_narrative_sources_company_date
  ON narrative_risk.sources (company_key, publication_date);
CREATE INDEX IF NOT EXISTS idx_narrative_metrics_company_indicator
  ON narrative_risk.metrics (company_key, indicator_id, metric_variant);
CREATE INDEX IF NOT EXISTS idx_narrative_findings_status
  ON narrative_risk.audit_findings (status, severity);

CREATE OR REPLACE VIEW narrative_risk.v_company_assessment_snapshot AS
SELECT
  scope_record.scope_id,
  scope_record.label AS scope_label,
  company_record.company_key,
  company_record.short_name,
  company_record.stock_code,
  assessment.objective_risk_score,
  assessment.weighted_coverage,
  assessment.pdqi_value,
  assessment.pdqi_variant,
  assessment.itag_value,
  assessment.itag_variant,
  assessment.tone_value,
  assessment.tone_variant,
  assessment.joint_risk_level,
  assessment.validation_status,
  assessment.conclusion
FROM narrative_risk.assessments AS assessment
JOIN narrative_risk.scopes AS scope_record
  ON scope_record.scope_id = assessment.scope_id
JOIN narrative_risk.companies AS company_record
  ON company_record.company_key = assessment.company_key;

DO $$
BEGIN
  IF to_regrole('kechuang_api') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA narrative_risk TO kechuang_api;
    GRANT SELECT ON ALL TABLES IN SCHEMA narrative_risk TO kechuang_api;
  END IF;
  IF to_regrole('kechuang_ingest') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA narrative_risk TO kechuang_ingest;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA narrative_risk TO kechuang_ingest;
  END IF;
END
$$;
