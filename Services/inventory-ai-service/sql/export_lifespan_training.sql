-- Export labelled lifespan training rows from inventory PostgreSQL.
--
-- Output columns match src.train_asset_lifespan.FEATURES + TARGET:
--   type, brand, model, ram_gb, storage_gb, working_hours, operational_state, lifespan_years
--
-- Notes:
-- - Uses explicit labels first (lifespanYears / actualLifespanYears in specifications JSON)
-- - Falls back to observed lifecycle duration for retired assets
-- - Keeps only rows with non-null lifespan_years

WITH parsed AS (
  SELECT
    a."customId" AS asset_id,
    lower(a."type"::text) AS type,
    COALESCE(
      NULLIF(a.specifications->>'brand', ''),
      NULLIF(a.specifications->>'Brand', ''),
      'unknown'
    ) AS brand,
    COALESCE(
      NULLIF(a.specifications->>'version', ''),
      NULLIF(a.specifications->>'Version', ''),
      NULLIF(a.specifications->>'model', ''),
      NULLIF(a.specifications->>'Model', ''),
      'unknown'
    ) AS model,
    NULLIF(
      regexp_replace(
        COALESCE(
          a.specifications->>'RAM',
          a.specifications->>'ram',
          a.specifications->>'Memory',
          a.specifications->>'memory',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS ram_raw,
    COALESCE(
      a.specifications->>'Storage',
      a.specifications->>'storage',
      a.specifications->>'Disk',
      a.specifications->>'disk',
      a.specifications->>'SSD',
      a.specifications->>'ssd',
      ''
    ) AS storage_text,
    NULLIF(
      regexp_replace(
        COALESCE(
          a.specifications->>'Storage',
          a.specifications->>'storage',
          a.specifications->>'Disk',
          a.specifications->>'disk',
          a.specifications->>'SSD',
          a.specifications->>'ssd',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS storage_raw,
    COALESCE(
      NULLIF(
        regexp_replace(
          COALESCE(
            a.specifications->>'workingHours',
            a.specifications->>'Working Hours',
            '0'
          ),
          '[^0-9.]',
          '',
          'g'
        ),
        ''
      )::double precision,
      0
    ) AS working_hours,
    COALESCE(
      NULLIF(lower(a.specifications->>'operationalState'), ''),
      'offline'
    ) AS operational_state,
    NULLIF(
      regexp_replace(
        COALESCE(
          o."actualLifespanYears"::text,
          a.specifications->>'lifespanYears',
          a.specifications->>'actualLifespanYears',
          a.specifications#>>'{lifecycle,actualLifespanYears}',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS explicit_lifespan_years,
    o."purchaseDate" AS outcome_purchase_date,
    o."commissionedAt" AS outcome_commissioned_at,
    o."failureDate" AS outcome_failure_date,
    o."replacementDate" AS outcome_replacement_date,
    o."retiredAt" AS outcome_retired_at,
    COALESCE(NULLIF(lower(o."finalOutcome"), ''), NULLIF(lower(a.specifications#>>'{lifecycle,finalOutcome}'), '')) AS outcome_final,
    lower(a.status::text) AS status,
    a."createdAt" AS created_at,
    a."updatedAt" AS updated_at
  FROM assets a
  LEFT JOIN asset_lifecycle_outcomes o ON o."assetId" = a."customId"
),
scored AS (
  SELECT
    type,
    brand,
    model,
    GREATEST(COALESCE(ram_raw, 0), 0) AS ram_gb,
    GREATEST(
      CASE
        WHEN storage_text ~* 'tb' THEN COALESCE(storage_raw, 0) * 1024
        ELSE COALESCE(storage_raw, 0)
      END,
      0
    ) AS storage_gb,
    GREATEST(COALESCE(working_hours, 0), 0) AS working_hours,
    CASE
      WHEN operational_state IN ('online_in_use', 'online_idle', 'offline') THEN operational_state
      ELSE 'offline'
    END AS operational_state,
    CASE
      WHEN explicit_lifespan_years IS NOT NULL AND explicit_lifespan_years > 0 THEN explicit_lifespan_years
      WHEN COALESCE(outcome_final, '') IN ('retired', 'replaced', 'failed')
        THEN EXTRACT(
            EPOCH FROM (
                COALESCE(outcome_replacement_date, outcome_retired_at, outcome_failure_date, updated_at, now())
                - COALESCE(outcome_commissioned_at, outcome_purchase_date, created_at)
            )
        ) / 31557600.0
      WHEN status = 'retired' THEN EXTRACT(EPOCH FROM (COALESCE(updated_at, now()) - COALESCE(outcome_commissioned_at, outcome_purchase_date, created_at))) / 31557600.0
      ELSE NULL
    END AS lifespan_years
  FROM parsed
)
SELECT
  type,
  brand,
  model,
  ram_gb,
  storage_gb,
  working_hours,
  operational_state,
  lifespan_years
FROM scored
WHERE lifespan_years IS NOT NULL
  AND lifespan_years > 0;
