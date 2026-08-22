CREATE TABLE public_request_rate_limits (
  bucket VARCHAR(80) NOT NULL,
  subject_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (bucket, subject_hash),
  CONSTRAINT public_request_rate_limits_hash CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT public_request_rate_limits_window CHECK (expires_at > window_started_at)
);

CREATE INDEX public_request_rate_limits_expiration_index
  ON public_request_rate_limits (expires_at);
