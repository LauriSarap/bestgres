\c analytics

-- Event types
INSERT INTO event_types (name, schema) VALUES
  ('page_view', '{"path": "string", "referrer": "string"}'),
  ('click', '{"element": "string", "text": "string"}'),
  ('purchase', '{"amount": "number", "currency": "string"}'),
  ('signup', '{"source": "string"}'),
  ('error', '{"message": "string", "stack": "string"}');

-- Events (500 random)
INSERT INTO events (event_type_id, user_id, session_id, payload, created_at)
SELECT
  (SELECT id FROM event_types ORDER BY random() LIMIT 1),
  CASE WHEN random() > 0.2 THEN 'user_' || (random() * 1000)::int ELSE NULL END,
  'sess_' || substr(md5(random()::text), 1, 12),
  jsonb_build_object(
    'path', '/page/' || (random() * 50)::int,
    'ts', extract(epoch from now() - (random() * interval '7 days'))::bigint
  ),
  now() - (random() * interval '7 days')
FROM generate_series(1, 500) n;

-- Metric definitions
INSERT INTO metric_definitions (name, unit, description) VALUES
  ('active_users', 'count', 'Unique users in the last 24h'),
  ('revenue', 'usd', 'Total revenue'),
  ('latency_p99', 'ms', '99th percentile response time'),
  ('error_rate', 'percent', 'Error rate');

-- Metric values (200 samples)
INSERT INTO metric_values (metric_id, value, dimensions, recorded_at)
SELECT
  (SELECT id FROM metric_definitions ORDER BY random() LIMIT 1),
  (random() * 1000)::double precision,
  jsonb_build_object('region', (array['us', 'eu', 'asia'])[1 + (n % 3)]),
  now() - (n * interval '1 hour')
FROM generate_series(1, 200) n;

-- Dashboards
INSERT INTO dashboards (name, config) VALUES
  ('Overview', '{"widgets": ["active_users", "revenue"]}'),
  ('Performance', '{"widgets": ["latency_p99", "error_rate"]}'),
  ('Custom', '{"widgets": []}');
