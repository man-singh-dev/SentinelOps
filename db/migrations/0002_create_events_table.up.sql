-- Enum, not TEXT + CHECK: enums sort by declaration order, so range
-- queries like severity >= 'error' work without a CASE expression, and
-- the value set is closed and stable.
CREATE TYPE severity AS ENUM ('debug', 'info', 'warning', 'error', 'critical');

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services (id),
    event_id TEXT NOT NULL,
    -- event_type stays plain TEXT, not an enum: this set is open-ended
    -- and will grow as senders add new event types.
    event_type TEXT NOT NULL,
    severity severity NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Scoped to (service_id, event_id), not event_id alone: event_id is
    -- only unique within the sender's own namespace, so two different
    -- services are free to use the same event_id independently. This
    -- pair is what makes retried deliveries of the same event idempotent.
    UNIQUE (service_id, event_id)
);

CREATE INDEX IF NOT EXISTS events_service_id_received_at_idx ON events (service_id, received_at DESC);
