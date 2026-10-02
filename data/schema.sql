-- =============================================================
-- HARVEST — Tower K Energy & Comfort Pill
-- Schema. Auto-applied by docker-compose on first run of an empty volume.
-- ALL DATA IS SYNTHETIC.
--
-- Recreate after edits:  docker compose down -v && docker compose up -d db
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: find pills by meaning
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- -------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------
CREATE TYPE role_name   AS ENUM ('aom', 'chief_engineer', 'pill_reviewer', 'site_operator', 'governance_admin');
CREATE TYPE claim_kind  AS ENUM ('fact', 'interpretation', 'action', 'unknown');
CREATE TYPE action_tier AS ENUM ('recommend', 'execute_with_approval', 'escalate');
CREATE TYPE pill_status AS ENUM ('draft', 'in_review', 'approved', 'superseded', 'rolled_back', 'blocked');
CREATE TYPE pill_domain AS ENUM ('energy', 'comfort', 'technical_services');
CREATE TYPE case_status AS ENUM ('open', 'escalated', 'blocked', 'resolved');
CREATE TYPE audit_action AS ENUM (
  'capture', 'view', 'apply', 'approve', 'reject',
  'rollback', 'export', 'gate_escalate', 'context_block'
);

-- -------------------------------------------------------------
-- Identity & access  (deny by default; no RLS locally — see docs/DECISIONS.md)
-- -------------------------------------------------------------
CREATE TABLE app_users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role    role_name NOT NULL,
  site_id text,                                  -- NULL = all sites
  PRIMARY KEY (user_id, role)
);

-- -------------------------------------------------------------
-- Tenants  (read-only renewal-risk signal only — not an agent)
-- -------------------------------------------------------------
CREATE TABLE tenants (
  id                  text PRIMARY KEY,
  level               int NOT NULL,
  name                text NOT NULL,
  lease_comfort_min_c numeric(4,1) NOT NULL DEFAULT 23.0,
  lease_comfort_max_c numeric(4,1) NOT NULL DEFAULT 25.0,
  renewal_due         date,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- Capture: transcript excerpts  (every pill claim traces back to one)
-- -------------------------------------------------------------
CREATE TABLE transcript_excerpts (
  id           text PRIMARY KEY,                 -- e.g. 'ex-4'
  interview_id text NOT NULL,
  speaker      text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  text         text NOT NULL,
  embedding    vector(1536),                     -- OpenAI text-embedding-3-small (NULL in seed)
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- Intelligence Pills
-- -------------------------------------------------------------
CREATE TABLE pills (
  id              text PRIMARY KEY,              -- e.g. 'pill-energy-chiller-drift'
  domain          pill_domain NOT NULL,
  layer           text NOT NULL,                 -- portfolio | asset_type | site
  title           text NOT NULL,
  owner_id        uuid REFERENCES app_users(id),
  reviewer_id     uuid REFERENCES app_users(id),
  status          pill_status NOT NULL DEFAULT 'draft',
  current_version int NOT NULL DEFAULT 0,
  access_class    text NOT NULL DEFAULT 'internal',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Immutable once written; a change is always a new version.
CREATE TABLE pill_versions (
  pill_id            text NOT NULL REFERENCES pills(id) ON DELETE CASCADE,
  version            int  NOT NULL,
  status             pill_status NOT NULL DEFAULT 'draft',
  context            jsonb NOT NULL,             -- hard filter keys: asset_type, chiller_plant, tariff
  triggers           jsonb NOT NULL,
  critical_cues      jsonb NOT NULL,
  discounted_signals jsonb NOT NULL,
  decision_logic     jsonb NOT NULL,             -- params for analytics.py (never prose numbers)
  never_do           jsonb NOT NULL,
  trade_offs         jsonb NOT NULL,
  escalation         jsonb NOT NULL,
  governance         jsonb NOT NULL,
  eval_status        text NOT NULL DEFAULT 'pending'
                     CHECK (eval_status IN ('pending', 'passed', 'failed')),
  eval_score         numeric(5,4),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES app_users(id),
  PRIMARY KEY (pill_id, version)
);

-- FR-02: a non-unknown claim MUST carry a real source excerpt. Enforced in the DB.
CREATE TABLE claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pill_id           text NOT NULL,
  version           int  NOT NULL,
  kind              claim_kind NOT NULL,
  text              text NOT NULL,
  source_excerpt_id text REFERENCES transcript_excerpts(id),
  confidence        numeric(4,3),
  CHECK (kind = 'unknown' OR source_excerpt_id IS NOT NULL),
  FOREIGN KEY (pill_id, version) REFERENCES pill_versions(pill_id, version) ON DELETE CASCADE
);

CREATE TABLE pill_options (
  id                 text NOT NULL,
  pill_id            text NOT NULL,
  version            int  NOT NULL,
  label              text NOT NULL,
  tier               action_tier NOT NULL,
  detail             text NOT NULL,
  expected_kwh_delta numeric(10,2),
  comfort_impact     text,
  source_excerpt_id  text REFERENCES transcript_excerpts(id),  -- FR-06 provenance
  PRIMARY KEY (pill_id, version, id),
  FOREIGN KEY (pill_id, version) REFERENCES pill_versions(pill_id, version) ON DELETE CASCADE
);

-- -------------------------------------------------------------
-- Decision runtime
-- -------------------------------------------------------------
CREATE TABLE cases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        text NOT NULL,
  asset_type     text NOT NULL,
  chiller_plant  text NOT NULL,
  tariff         text NOT NULL,
  tenant_id      text REFERENCES tenants(id),
  level          int,
  reported_at    timestamptz NOT NULL,
  complaint_text text NOT NULL,
  signals        jsonb,
  status         case_status NOT NULL DEFAULT 'open',
  gate           jsonb,
  context_check  jsonb,
  metrics        jsonb,
  created_by     uuid REFERENCES app_users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decision_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pill_id           text NOT NULL,
  pill_version      int  NOT NULL,
  option_id         text NOT NULL,
  label             text NOT NULL,
  detail            text,
  tier              action_tier NOT NULL,
  kwh_delta         numeric(10,2),
  sgd_delta         numeric(10,2),
  comfort_impact    text,
  renewal_flag      boolean NOT NULL DEFAULT false,
  conflict          text,
  source_excerpt_id text REFERENCES transcript_excerpts(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outcomes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  decision_option_id     uuid REFERENCES decision_options(id),
  applied_at             timestamptz,
  applied_by             uuid REFERENCES app_users(id),
  result                 text,
  kwh_saved              numeric(12,2),
  creates_proposed_version int,                 -- FR-10: feedback -> proposed version
  rollback_of            int,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- FR-11: append-only, hash-chained audit trail
-- hash = sha256(prev_hash + canonical_json(action, entity, payload, occurred_at))
-- -------------------------------------------------------------
CREATE TABLE audit_logs (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_role  role_name,
  action      audit_action NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);

CREATE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

-- -------------------------------------------------------------
-- Indexes
-- -------------------------------------------------------------
CREATE INDEX idx_pills_domain_status  ON pills(domain, status);
CREATE INDEX idx_claims_pill          ON claims(pill_id, version);
CREATE INDEX idx_cases_status         ON cases(status);
CREATE INDEX idx_decision_options_case ON decision_options(case_id);
CREATE INDEX idx_audit_entity         ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_occurred       ON audit_logs(occurred_at DESC);
CREATE INDEX idx_excerpts_embedding   ON transcript_excerpts
  USING hnsw (embedding vector_cosine_ops);
