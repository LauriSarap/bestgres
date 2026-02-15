-- Instance 2: analytics — Events, metrics, dashboards
CREATE DATABASE analytics;
\c analytics

CREATE TABLE event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  schema jsonb
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id uuid NOT NULL REFERENCES event_types(id) ON DELETE RESTRICT,
  user_id varchar(255),
  session_id varchar(255),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL UNIQUE,
  unit varchar(50),
  description text
);

CREATE TABLE metric_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id uuid NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
  value double precision NOT NULL,
  dimensions jsonb DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_type ON events(event_type_id);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_user ON events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_metric_values_metric ON metric_values(metric_id);
CREATE INDEX idx_metric_values_recorded ON metric_values(recorded_at DESC);
