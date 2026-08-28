ALTER TABLE narrative_risk.annual_metric_observations
  ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS risk_score_change DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'annual_metric_observations_risk_score_range'
      AND conrelid = 'narrative_risk.annual_metric_observations'::regclass
  ) THEN
    ALTER TABLE narrative_risk.annual_metric_observations
      ADD CONSTRAINT annual_metric_observations_risk_score_range
      CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100);
  END IF;
END
$$;
