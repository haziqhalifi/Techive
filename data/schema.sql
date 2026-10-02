-- =============================================================
-- VERDANT — durable Postgres + pgvector schema.
-- ALL DATA IS SYNTHETIC.
--
-- This is a faithful projection of the TypeScript domain model in
-- `backend/src/modules/*/*.types.ts`. It is NOT read or written by the API — the in-memory
-- store is the primary data layer (see docs/DECISIONS.md ADR-001). It exists so the
-- production path is a real, correct artifact rather than a sketch.
--
-- Product rules encoded at the storage layer:
--   FR-02  claims.kind <> 'unknown'  =>  a source excerpt must be cited
--   FR-03  a version's reviewer may not be its author
--   FR-07  action tiers are a closed set
--   FR-11  audit_logs is append-only (trigger)
--
-- Applied by docker-compose on first run of an EMPTY volume, before data/seed.sql.
-- Recreate after edits:
--   docker compose --profile postgres down -v && docker compose --profile postgres up -d db
--
-- CONVENTION: one column or constraint per line. A test parses this file to cross-check it
-- against the generated seed, so keep that shape.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: find transcript excerpts by meaning

-- -------------------------------------------------------------
-- Enums  (only where the TypeScript type is a closed union)
-- -------------------------------------------------------------
CREATE TYPE role_name       AS ENUM ('aom', 'chief_engineer', 'pill_reviewer', 'site_operator', 'governance_admin');
CREATE TYPE asset_type      AS ENUM ('chiller_plant', 'ahu', 'cooling_tower', 'vav_box', 'tenant_zone');
CREATE TYPE claim_kind      AS ENUM ('measured', 'derived', 'assumed', 'unknown');
CREATE TYPE pill_status     AS ENUM ('draft', 'in_review', 'approved', 'rejected', 'retired', 'superseded');
CREATE TYPE case_status     AS ENUM ('open', 'gated', 'blocked', 'escalated', 'decided', 'closed');
CREATE TYPE action_tier     AS ENUM ('recommend', 'execute_with_approval', 'escalate');
CREATE TYPE outcome_verdict AS ENUM ('improved', 'no_change', 'worse', 'pending');

-- -------------------------------------------------------------
-- Physical & commercial entities
-- -------------------------------------------------------------
CREATE TABLE sites (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  city               text NOT NULL,
  tariff_sgd_per_kwh numeric(6,4) NOT NULL,
  gfa_sqm            integer NOT NULL
);

CREATE TABLE users (
  id      text PRIMARY KEY,
  name    text NOT NULL,
  email   text NOT NULL UNIQUE,
  role    role_name NOT NULL,
  site_id text REFERENCES sites(id)
);

CREATE TABLE assets (
  id            text PRIMARY KEY,
  site_id       text NOT NULL REFERENCES sites(id),
  name          text NOT NULL,
  asset_type    asset_type NOT NULL,
  chiller_plant text,
  floor         integer,
  zone          text,
  rated_kw      numeric(10,2)
);

CREATE TABLE tenants (
  id                  text PRIMARY KEY,
  site_id             text NOT NULL REFERENCES sites(id),
  name                text NOT NULL,
  floor               integer NOT NULL,
  lease_comfort_min_c numeric(4,1) NOT NULL,
  lease_comfort_max_c numeric(4,1) NOT NULL,
  lease_hours         text NOT NULL
);

-- Raw 15-minute chiller telemetry. The decision card is derived from this, never typed in.
-- The model carries no site/asset linkage, so none is invented here.
CREATE TABLE chiller_readings (
  ts        timestamptz PRIMARY KEY,
  load_rt   numeric(8,2) NOT NULL,
  kw_per_rt numeric(6,4) NOT NULL
);

-- -------------------------------------------------------------
-- Intelligence Pills
-- -------------------------------------------------------------
CREATE TABLE pills (
  id                 text PRIMARY KEY,
  slug               text NOT NULL UNIQUE,
  title              text NOT NULL,
  domain             text NOT NULL,
  owner_id           text NOT NULL REFERENCES users(id),
  origin_site_id     text NOT NULL REFERENCES sites(id),
  current_version_id text,
  created_at         timestamptz NOT NULL
);

-- Immutable content per version; a change is always a new version.
CREATE TABLE pill_versions (
  id                    text PRIMARY KEY,
  pill_id               text NOT NULL REFERENCES pills(id) ON DELETE CASCADE,
  version               integer NOT NULL,
  status                pill_status NOT NULL,
  summary               text NOT NULL,
  triggers              text[] NOT NULL,
  action_tier           action_tier NOT NULL,
  steps                 jsonb NOT NULL,
  context_requirements  jsonb NOT NULL,
  author_id             text NOT NULL REFERENCES users(id),
  reviewer_id           text REFERENCES users(id),
  review_note           text,
  approved_at           timestamptz,
  supersedes_version_id text REFERENCES pill_versions(id),
  created_at            timestamptz NOT NULL,
  UNIQUE (pill_id, version),
  CONSTRAINT pill_versions_reviewer_not_author
    CHECK (reviewer_id IS NULL OR reviewer_id <> author_id)
);

-- Declared here, not inline, because pills and pill_versions reference each other.
ALTER TABLE pills
  ADD CONSTRAINT pills_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES pill_versions(id);

-- Every non-unknown claim traces back to a verbatim quote from the capture interview.
CREATE TABLE transcript_excerpts (
  id          text PRIMARY KEY,
  pill_id     text NOT NULL REFERENCES pills(id) ON DELETE CASCADE,
  speaker     text NOT NULL,
  text        text NOT NULL,
  captured_at timestamptz NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  embedding   vector(1536)
);

-- FR-02: a non-unknown claim MUST cite a real source excerpt. Enforced in the DB.
CREATE TABLE claims (
  id                text PRIMARY KEY,
  pill_version_id   text NOT NULL REFERENCES pill_versions(id) ON DELETE CASCADE,
  kind              claim_kind NOT NULL,
  text              text NOT NULL,
  source_excerpt_id text REFERENCES transcript_excerpts(id),
  confidence        numeric(4,3) NOT NULL,
  CONSTRAINT claims_source_required
    CHECK (kind = 'unknown' OR source_excerpt_id IS NOT NULL)
);

CREATE TABLE pill_options (
  id                text PRIMARY KEY,
  pill_version_id   text NOT NULL REFERENCES pill_versions(id) ON DELETE CASCADE,
  label             text NOT NULL,
  detail            text NOT NULL,
  action_tier       action_tier NOT NULL,
  sgd_delta         numeric(12,2) NOT NULL,
  policy_rank       integer NOT NULL,
  source_excerpt_id text REFERENCES transcript_excerpts(id)
);

-- -------------------------------------------------------------
-- Decision runtime
-- -------------------------------------------------------------
-- NOTE: there is deliberately no `metrics` column. Metrics are computed per decision card
-- and are not a property of the case row.
CREATE TABLE cases (
  id                    text PRIMARY KEY,
  site_id               text NOT NULL REFERENCES sites(id),
  asset_id              text REFERENCES assets(id),
  tenant_id             text REFERENCES tenants(id),
  floor                 integer,
  zone                  text,
  reported_at           timestamptz NOT NULL,
  symptom               text NOT NULL,
  description           text NOT NULL,
  reported_by           text NOT NULL,
  status                case_status NOT NULL,
  transfer_from_pill_id text REFERENCES pills(id),
  parsed                jsonb,
  gate                  jsonb,
  context_check         jsonb,
  created_at            timestamptz NOT NULL
);

CREATE TABLE decision_options (
  id              text PRIMARY KEY,
  case_id         text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pill_version_id text NOT NULL REFERENCES pill_versions(id),
  label           text NOT NULL,
  detail          text NOT NULL,
  action_tier     action_tier NOT NULL,
  sgd_delta       numeric(12,2) NOT NULL,
  policy_rank     integer NOT NULL,
  selected        boolean NOT NULL DEFAULT false
);

CREATE TABLE outcomes (
  id               text PRIMARY KEY,
  case_id          text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  option_id        text REFERENCES decision_options(id),
  decided_by       text NOT NULL,
  decided_at       timestamptz NOT NULL,
  verdict          outcome_verdict NOT NULL,
  comfort_delta_c  numeric(5,2),
  energy_delta_kwh numeric(12,2),
  note             text NOT NULL
);

-- -------------------------------------------------------------
-- FR-11: append-only, hash-chained audit trail
-- hash = sha256(prev_hash + canonical_json({action, entity_type, entity_id, payload, occurred_at}))
--
-- payload is `json`, not `jsonb`: json preserves the input text byte-for-byte, so the stored
-- literal is exactly what the TypeScript chain hashed. jsonb would reorder keys.
-- actor_id and action are `text` because the model allows synthetic actors and free-form
-- actions (`case.created`, `test.action`).
-- -------------------------------------------------------------
CREATE TABLE audit_logs (
  seq         bigint PRIMARY KEY,
  id          text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor_id    text NOT NULL,
  actor_name  text NOT NULL,
  actor_role  role_name NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  payload     json NOT NULL,
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
CREATE INDEX idx_assets_site        ON assets(site_id);
CREATE INDEX idx_assets_type        ON assets(asset_type);
CREATE INDEX idx_tenants_site       ON tenants(site_id);
CREATE INDEX idx_pills_owner        ON pills(owner_id);
CREATE INDEX idx_pills_domain       ON pills(domain);
CREATE INDEX idx_versions_pill      ON pill_versions(pill_id);
CREATE INDEX idx_versions_status    ON pill_versions(status);
CREATE INDEX idx_excerpts_pill      ON transcript_excerpts(pill_id);
CREATE INDEX idx_claims_version     ON claims(pill_version_id);
CREATE INDEX idx_options_version    ON pill_options(pill_version_id);
CREATE INDEX idx_cases_site         ON cases(site_id);
CREATE INDEX idx_cases_status       ON cases(status);
CREATE INDEX idx_decisions_case     ON decision_options(case_id);
CREATE INDEX idx_outcomes_case      ON outcomes(case_id);
CREATE INDEX idx_audit_entity       ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_occurred     ON audit_logs(occurred_at DESC);
CREATE INDEX idx_excerpts_embedding ON transcript_excerpts
  USING hnsw (embedding vector_cosine_ops);
