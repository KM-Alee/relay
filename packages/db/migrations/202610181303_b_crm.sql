-- 202610181303_b_crm.sql  (lane b) · T-110…T-118 · companies, contacts, pipelines, stages, custom fields,
-- opportunities, tags, saved lists, activities (docs/02-data-model.md §3). [F2.1] [F2.2] [F2.3] [F2.4] [F2.5]
-- [F2.6] [F2.7] [F1.4] [F1.6] [Q4]. Runs once, in filename order, in ONE transaction, as the owner role.

-- ── companies ───────────────────────────────────────────────────────────
CREATE TABLE companies (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  name          text NOT NULL,
  owner_user_id uuid,
  deleted_at    timestamptz,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT companies_owner_fk FOREIGN KEY (workspace_id, owner_user_id) REFERENCES users (workspace_id, id)
);
CREATE INDEX companies_ws_idx ON companies (workspace_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('companies', 'SELECT, INSERT, UPDATE');

-- ── contacts ────────────────────────────────────────────────────────────
-- `leads.contact_id` (Lane A) references (workspace_id, id) of this table.
CREATE TABLE contacts (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces (id),
  company_id       uuid,
  name             text NOT NULL,
  phone_e164       text,
  email            citext,
  owner_user_id    uuid,
  language         text,
  language_source  text NOT NULL DEFAULT 'manual',
  opted_out        boolean NOT NULL DEFAULT false,
  opted_out_at     timestamptz,
  ai_profile       jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at timestamptz,
  deleted_at       timestamptz,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT contacts_company_fk FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id),
  CONSTRAINT contacts_owner_fk FOREIGN KEY (workspace_id, owner_user_id) REFERENCES users (workspace_id, id),
  CONSTRAINT contacts_language_check CHECK (language IS NULL OR language IN ('en', 'ur', 'ur-Latn')),
  CONSTRAINT contacts_language_source_check CHECK (language_source IN ('detected', 'manual')),
  CONSTRAINT contacts_phone_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);
CREATE UNIQUE INDEX contacts_ws_phone_key ON contacts (workspace_id, phone_e164) WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX contacts_ws_email_key ON contacts (workspace_id, email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX contacts_ws_owner_idx ON contacts (workspace_id, owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX contacts_ws_created_idx ON contacts (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('contacts', 'SELECT, INSERT, UPDATE');

-- ── pipelines + stages ──────────────────────────────────────────────────
CREATE TABLE pipelines (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name         text NOT NULL,
  team_id      uuid,                                   -- Lane A teams (no FK: owned by another lane's migration)
  position     integer NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipelines_ws_id_key UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX pipelines_ws_name_key ON pipelines (workspace_id, lower(name));
CREATE UNIQUE INDEX pipelines_one_default ON pipelines (workspace_id) WHERE is_default;
CREATE TRIGGER pipelines_updated_at BEFORE UPDATE ON pipelines FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('pipelines');

CREATE TABLE stages (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  pipeline_id  uuid NOT NULL,
  name         text NOT NULL,
  position     integer NOT NULL,
  kind         text NOT NULL DEFAULT 'open' CONSTRAINT stages_kind_check CHECK (kind IN ('open', 'won', 'lost')),
  rot_seconds  integer CONSTRAINT stages_rot_check CHECK (rot_seconds IS NULL OR rot_seconds > 0),
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stages_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT stages_pipeline_fk FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id),
  CONSTRAINT stages_position_key UNIQUE (pipeline_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER stages_updated_at BEFORE UPDATE ON stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('stages');

-- ── custom fields ───────────────────────────────────────────────────────
CREATE TABLE custom_fields (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity       text NOT NULL CONSTRAINT custom_fields_entity_check CHECK (entity IN ('contact', 'company', 'opportunity')),
  pipeline_id  uuid,                                   -- NULL = shared; set = pipeline-specific (F2.3)
  key          text NOT NULL CONSTRAINT custom_fields_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        jsonb NOT NULL,                         -- {en, ur}
  type         text NOT NULL CONSTRAINT custom_fields_type_check CHECK (type IN ('text', 'number', 'date', 'dropdown', 'checkbox', 'ai')),
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- dropdown options [{value,label{en,ur}}]
  ai_config    jsonb,
  position     integer NOT NULL DEFAULT 0,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_fields_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT custom_fields_pipeline_fk FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id),
  CONSTRAINT custom_fields_pipeline_entity_check CHECK (pipeline_id IS NULL OR entity = 'opportunity')
);
CREATE UNIQUE INDEX custom_fields_ws_entity_key ON custom_fields (workspace_id, entity, key);
CREATE TRIGGER custom_fields_updated_at BEFORE UPDATE ON custom_fields FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('custom_fields');

CREATE TABLE stage_required_fields (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  stage_id     uuid NOT NULL,
  field_id     uuid NOT NULL,
  PRIMARY KEY (stage_id, field_id),
  FOREIGN KEY (workspace_id, stage_id) REFERENCES stages (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, field_id) REFERENCES custom_fields (workspace_id, id) ON DELETE CASCADE
);
SELECT relay_enable_tenant_rls('stage_required_fields');

-- ── opportunities ───────────────────────────────────────────────────────
CREATE TABLE opportunities (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces (id),
  contact_id       uuid NOT NULL,
  pipeline_id      uuid NOT NULL,
  stage_id         uuid NOT NULL,
  title            text NOT NULL,
  value_minor      bigint CONSTRAINT opportunities_value_check CHECK (value_minor IS NULL OR value_minor >= 0),
  currency         char(3) NOT NULL DEFAULT 'PKR',
  owner_user_id    uuid,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz,
  closed_at        timestamptz,
  deleted_at       timestamptz,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT opportunities_contact_fk FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  CONSTRAINT opportunities_pipeline_fk FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id),
  CONSTRAINT opportunities_stage_fk FOREIGN KEY (workspace_id, stage_id) REFERENCES stages (workspace_id, id),
  CONSTRAINT opportunities_owner_fk FOREIGN KEY (workspace_id, owner_user_id) REFERENCES users (workspace_id, id)
);
CREATE INDEX opportunities_ws_stage_idx ON opportunities (workspace_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX opportunities_ws_contact_idx ON opportunities (workspace_id, contact_id);
CREATE INDEX opportunities_ws_created_idx ON opportunities (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER opportunities_updated_at BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('opportunities', 'SELECT, INSERT, UPDATE');

-- ── field values ────────────────────────────────────────────────────────
CREATE TABLE field_values (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  field_id       uuid NOT NULL,
  contact_id     uuid,
  company_id     uuid,
  opportunity_id uuid,
  value          jsonb NOT NULL,
  source         text NOT NULL DEFAULT 'human' CONSTRAINT field_values_source_check CHECK (source IN ('human', 'ai', 'import')),
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_values_one_entity CHECK (num_nonnulls(contact_id, company_id, opportunity_id) = 1),
  FOREIGN KEY (workspace_id, field_id) REFERENCES custom_fields (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id),
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id),
  FOREIGN KEY (workspace_id, updated_by) REFERENCES users (workspace_id, id)
);
CREATE UNIQUE INDEX field_values_contact_key ON field_values (field_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX field_values_company_key ON field_values (field_id, company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX field_values_opp_key ON field_values (field_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
SELECT relay_enable_tenant_rls('field_values');

-- ── tags ────────────────────────────────────────────────────────────────
CREATE TABLE tags (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_ws_id_key UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX tags_ws_name_key ON tags (workspace_id, lower(name));
CREATE TRIGGER tags_updated_at BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('tags');

CREATE TABLE contact_tags (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  tag_id       uuid NOT NULL,
  contact_id   uuid NOT NULL,
  PRIMARY KEY (tag_id, contact_id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id)
);
CREATE INDEX contact_tags_contact_idx ON contact_tags (contact_id);
SELECT relay_enable_tenant_rls('contact_tags');

CREATE TABLE opportunity_tags (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  tag_id         uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  PRIMARY KEY (tag_id, opportunity_id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id)
);
CREATE INDEX opportunity_tags_opp_idx ON opportunity_tags (opportunity_id);
SELECT relay_enable_tenant_rls('opportunity_tags');

-- ── saved lists ─────────────────────────────────────────────────────────
CREATE TABLE saved_lists (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  owner_user_id uuid NOT NULL,
  name          text NOT NULL,
  entity        text NOT NULL CONSTRAINT saved_lists_entity_check CHECK (entity IN ('contact', 'company', 'opportunity')),
  criteria      jsonb NOT NULL,
  is_shared     boolean NOT NULL DEFAULT false,
  needs_review  boolean NOT NULL DEFAULT false,        -- a referenced field/tag was deleted (02 §3)
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_lists_ws_id_key UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, owner_user_id) REFERENCES users (workspace_id, id)
);
CREATE TRIGGER saved_lists_updated_at BEFORE UPDATE ON saved_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('saved_lists');

-- ── activities (timeline, F2.7) ─────────────────────────────────────────
-- Append-only for app_user (no UPDATE/DELETE). lead_id has no FK: the leads table is Lane A's.
CREATE TABLE activities (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  contact_id     uuid,
  opportunity_id uuid,
  lead_id        uuid,
  type           text NOT NULL CONSTRAINT activities_type_check CHECK (type IN
    ('note', 'call', 'stage_change', 'assignment', 'field_edit', 'message_in', 'message_out', 'ai_message', 'payment', 'appointment', 'import', 'system')),
  actor_type     text NOT NULL CONSTRAINT activities_actor_type_check CHECK (actor_type IN ('user', 'system', 'ai')),
  actor_user_id  uuid,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  FOREIGN KEY (workspace_id, opportunity_id) REFERENCES opportunities (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_user_id) REFERENCES users (workspace_id, id),
  CONSTRAINT activities_user_actor CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)
);
CREATE INDEX activities_contact_idx ON activities (workspace_id, contact_id, occurred_at DESC, id DESC);
CREATE INDEX activities_opp_idx ON activities (workspace_id, opportunity_id, occurred_at DESC);
SELECT relay_enable_tenant_rls('activities', 'SELECT, INSERT');

-- ── visibility helper (06 §2) ───────────────────────────────────────────
-- "Does the user own an OPEN lead for this contact?" Late-bound (plpgsql): the `leads` table belongs to
-- Lane A's migration; until it exists the answer is false. Runs as the caller, so leads' RLS applies.
CREATE FUNCTION crm_contact_has_open_lead(p_ws uuid, p_contact uuid, p_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM leads l WHERE l.workspace_id = p_ws AND l.contact_id = p_contact
                 AND l.status = 'open' AND l.owner_user_id = p_user);
EXCEPTION WHEN undefined_table THEN
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION crm_contact_has_open_lead(uuid, uuid, uuid) TO app_user;
