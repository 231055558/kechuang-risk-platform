CREATE TABLE IF NOT EXISTS narrative_risk.method_versions (
  method_version TEXT PRIMARY KEY,
  method_name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  source_document_sha256 TEXT CHECK (
    source_document_sha256 IS NULL OR length(source_document_sha256) = 64
  ),
  innovation_lexicon_status TEXT NOT NULL,
  innovation_lexicon_size INTEGER NOT NULL CHECK (innovation_lexicon_size >= 0),
  innovation_lexicon_sha256 TEXT NOT NULL CHECK (length(innovation_lexicon_sha256) = 64),
  stopword_list_sha256 TEXT NOT NULL CHECK (length(stopword_list_sha256) = 64),
  sentiment_dictionary_name TEXT NOT NULL,
  sentiment_dictionary_sha256 TEXT NOT NULL CHECK (length(sentiment_dictionary_sha256) = 64),
  sentiment_dictionary_source TEXT NOT NULL,
  peer_benchmark_status TEXT NOT NULL,
  methodology JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS narrative_risk.annual_documents (
  document_id TEXT PRIMARY KEY,
  company_key TEXT NOT NULL REFERENCES narrative_risk.companies(company_key),
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  method_version TEXT NOT NULL REFERENCES narrative_risk.method_versions(method_version),
  title TEXT NOT NULL,
  official_url TEXT NOT NULL,
  publication_date DATE,
  archive_status TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  file_sha256 TEXT CHECK (file_sha256 IS NULL OR length(file_sha256) = 64),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  section_coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  browser_validation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_key, report_year, method_version)
);

CREATE TABLE IF NOT EXISTS narrative_risk.annual_metric_observations (
  observation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_key TEXT NOT NULL REFERENCES narrative_risk.companies(company_key),
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  metric_key TEXT NOT NULL,
  method_version TEXT NOT NULL REFERENCES narrative_risk.method_versions(method_version),
  numeric_value DOUBLE PRECISION,
  annual_change_rate DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('已计算', '缺失')),
  missing_reason TEXT,
  document_id TEXT REFERENCES narrative_risk.annual_documents(document_id),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_key, report_year, metric_key, method_version),
  CHECK (
    (status = '已计算' AND numeric_value IS NOT NULL)
    OR (status = '缺失' AND numeric_value IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS narrative_risk.peer_benchmarks (
  benchmark_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  industry_code TEXT NOT NULL,
  industry_level TEXT NOT NULL CHECK (industry_level IN ('申万一级', '申万二级')),
  method_version TEXT NOT NULL REFERENCES narrative_risk.method_versions(method_version),
  effective_sample_size INTEGER NOT NULL CHECK (effective_sample_size >= 0),
  talk_mean DOUBLE PRECISION,
  talk_standard_deviation DOUBLE PRECISION,
  action_mean DOUBLE PRECISION,
  action_standard_deviation DOUBLE PRECISION,
  divergence_minimum DOUBLE PRECISION,
  divergence_maximum DOUBLE PRECISION,
  fallback_reason TEXT,
  audit JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (report_year, industry_code, industry_level, method_version)
);

CREATE TABLE IF NOT EXISTS narrative_risk.tone_audits (
  tone_audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_key TEXT NOT NULL REFERENCES narrative_risk.companies(company_key),
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  method_version TEXT NOT NULL REFERENCES narrative_risk.method_versions(method_version),
  source_url TEXT,
  answer_count INTEGER NOT NULL DEFAULT 0 CHECK (answer_count >= 0),
  dictionary_review TEXT NOT NULL,
  model_review TEXT NOT NULL,
  model_review_reason TEXT,
  prompt_sha256 TEXT CHECK (prompt_sha256 IS NULL OR length(prompt_sha256) = 64),
  model_version TEXT,
  difference_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_key, report_year, method_version)
);

CREATE INDEX IF NOT EXISTS idx_narrative_annual_documents_company_year
  ON narrative_risk.annual_documents (company_key, report_year DESC);
CREATE INDEX IF NOT EXISTS idx_narrative_annual_metrics_metric_year
  ON narrative_risk.annual_metric_observations (metric_key, report_year, company_key);
CREATE INDEX IF NOT EXISTS idx_narrative_peer_benchmarks_year_industry
  ON narrative_risk.peer_benchmarks (report_year, industry_level, industry_code);

DO $$
BEGIN
  IF to_regrole('kechuang_api') IS NOT NULL THEN
    GRANT SELECT ON narrative_risk.method_versions,
      narrative_risk.annual_documents,
      narrative_risk.annual_metric_observations,
      narrative_risk.peer_benchmarks,
      narrative_risk.tone_audits TO kechuang_api;
  END IF;
  IF to_regrole('kechuang_ingest') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON narrative_risk.method_versions,
      narrative_risk.annual_documents,
      narrative_risk.annual_metric_observations,
      narrative_risk.peer_benchmarks,
      narrative_risk.tone_audits TO kechuang_ingest;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA narrative_risk TO kechuang_ingest;
  END IF;
END
$$;
