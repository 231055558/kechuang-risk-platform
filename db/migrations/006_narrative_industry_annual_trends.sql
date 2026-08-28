CREATE TABLE IF NOT EXISTS narrative_risk.industry_annual_runs (
  data_version TEXT PRIMARY KEY,
  as_of_date DATE NOT NULL,
  methodology JSONB NOT NULL,
  industry_groups JSONB NOT NULL,
  audit JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS narrative_risk.industry_annual_companies (
  data_version TEXT NOT NULL REFERENCES narrative_risk.industry_annual_runs(data_version),
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  peer_group_id TEXT NOT NULL,
  industry_group_id TEXT NOT NULL,
  included_years JSONB NOT NULL DEFAULT '[]'::JSONB,
  PRIMARY KEY (data_version, company_id)
);

CREATE TABLE IF NOT EXISTS narrative_risk.industry_annual_documents (
  data_version TEXT NOT NULL REFERENCES narrative_risk.industry_annual_runs(data_version),
  document_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  title TEXT NOT NULL,
  official_url TEXT,
  publication_date DATE,
  archive_status TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  file_sha256 TEXT CHECK (file_sha256 IS NULL OR length(file_sha256) = 64),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  section_coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (data_version, document_id)
);

CREATE TABLE IF NOT EXISTS narrative_risk.industry_annual_observations (
  data_version TEXT NOT NULL REFERENCES narrative_risk.industry_annual_runs(data_version),
  company_id TEXT NOT NULL,
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  metric_key TEXT NOT NULL,
  numeric_value DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('已计算', '缺失')),
  missing_reason TEXT,
  document_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (data_version, company_id, report_year, metric_key),
  CHECK (
    (status = '已计算' AND numeric_value IS NOT NULL)
    OR (status = '缺失' AND numeric_value IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS narrative_risk.industry_annual_statistics (
  data_version TEXT NOT NULL REFERENCES narrative_risk.industry_annual_runs(data_version),
  industry_group_id TEXT NOT NULL,
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2200),
  metric_key TEXT NOT NULL,
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  mean_value DOUBLE PRECISION,
  minimum_value DOUBLE PRECISION,
  maximum_value DOUBLE PRECISION,
  standard_deviation DOUBLE PRECISION,
  domain_minimum DOUBLE PRECISION,
  domain_maximum DOUBLE PRECISION,
  PRIMARY KEY (data_version, industry_group_id, report_year, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_narrative_industry_observations_company_year
  ON narrative_risk.industry_annual_observations (company_id, report_year, metric_key);

DO $$
BEGIN
  IF to_regrole('kechuang_api') IS NOT NULL THEN
    GRANT SELECT ON narrative_risk.industry_annual_runs,
      narrative_risk.industry_annual_companies,
      narrative_risk.industry_annual_documents,
      narrative_risk.industry_annual_observations,
      narrative_risk.industry_annual_statistics TO kechuang_api;
  END IF;
  IF to_regrole('kechuang_ingest') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON narrative_risk.industry_annual_runs,
      narrative_risk.industry_annual_companies,
      narrative_risk.industry_annual_documents,
      narrative_risk.industry_annual_observations,
      narrative_risk.industry_annual_statistics TO kechuang_ingest;
  END IF;
END
$$;
