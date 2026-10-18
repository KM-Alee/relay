-- 202610181303_c_messaging.sql  (lane c) · T-141/T-142 · WhatsApp conversations, messages, media, templates
-- (docs/02-data-model.md §5; docs/04-integrations.md §3). [I1.3] [I1.4] [I1.5] [I1.8] [I1.9] [I1.10] [I1.11]
-- Like integrations_core: no FKs to contacts/users/leads (lanes A/B, may not exist yet); only `workspaces`.

CREATE TABLE conversations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id),
  contact_id           uuid,                          -- NULL until the intake hook / contact match resolves it
  channel              text NOT NULL DEFAULT 'whatsapp' CONSTRAINT conversations_channel_check CHECK (channel IN ('whatsapp')),
  connection_id        uuid,
  external_key         text NOT NULL,                 -- customer phone, E.164 ("+923001234567")
  display_name         text,                          -- WhatsApp profile name
  assigned_user_id     uuid,                          -- follows the lead owner
  last_inbound_at      timestamptz,                   -- 24 h window anchor (I1.10)
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         integer NOT NULL DEFAULT 0,
  opted_out            boolean NOT NULL DEFAULT false,   -- blocks outbound for humans AND AI (I1.9)
  opted_out_at         timestamptz,
  opt_out_suggested_at timestamptz,                   -- inbound STOP / "band karo": suggested, never auto-applied
  ai_state             text NOT NULL DEFAULT 'off' CONSTRAINT conversations_ai_state_check CHECK (ai_state IN ('off', 'active', 'handed_off')),
  language             text,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT conversations_ws_key_key UNIQUE (workspace_id, channel, external_key)
);
CREATE INDEX conversations_ws_recent_idx ON conversations (workspace_id, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_ws_contact_idx ON conversations (workspace_id, contact_id);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('conversations', 'SELECT, INSERT, UPDATE');

CREATE TABLE media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id),
  blob_key          text,                             -- Vercel Blob pathname ws/<wsId>/<uuid>; never sent to the client
  data              bytea,                            -- FALLBACK when BLOB_READ_WRITE_TOKEN is absent (size-capped in code)
  mime              text NOT NULL,
  filename          text,
  size_bytes        integer NOT NULL,
  sha256            text,
  provider_media_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT media_storage_check CHECK (blob_key IS NOT NULL OR data IS NOT NULL)
);
SELECT relay_enable_tenant_rls('media', 'SELECT, INSERT, UPDATE');

CREATE TABLE messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces (id),
  conversation_id     uuid NOT NULL,
  direction           text NOT NULL CONSTRAINT messages_direction_check CHECK (direction IN ('in', 'out')),
  author_type         text NOT NULL CONSTRAINT messages_author_type_check CHECK (author_type IN ('customer', 'user', 'ai', 'system')),
  author_user_id      uuid,
  kind                text NOT NULL DEFAULT 'text' CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'template', 'audio', 'image', 'document', 'event')),
  body                text,
  template_key        text,                           -- message_templates.key or the Meta template name
  template_name       text,                           -- Meta template name actually sent
  template_lang       text,
  template_params     jsonb,
  media_id            uuid,
  provider_message_id text,
  status              text NOT NULL DEFAULT 'queued' CONSTRAINT messages_status_check CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  status_reason       text,                           -- i18n key suffix (inbox.failure.<reason>)
  status_detail       text,                           -- redacted provider text
  status_at           timestamptz,
  retry_count         integer NOT NULL DEFAULT 0,
  transcript          text,
  transcript_status   text NOT NULL DEFAULT 'none' CONSTRAINT messages_transcript_status_check CHECK (transcript_status IN ('none', 'pending', 'done', 'failed')),
  summary             text,
  prompt_version      text,
  ai_meta             jsonb,
  client_key          text,                           -- idempotent composer submit
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  CONSTRAINT messages_conv_fk FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id),
  CONSTRAINT messages_media_fk FOREIGN KEY (workspace_id, media_id) REFERENCES media (workspace_id, id)
);
-- I1.8: a duplicate provider message can never create a second row.
CREATE UNIQUE INDEX messages_provider_id_key ON messages (workspace_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_client_key_key ON messages (conversation_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX messages_conv_created_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_failed_idx ON messages (workspace_id, created_at DESC) WHERE status = 'failed';
SELECT relay_enable_tenant_rls('messages', 'SELECT, INSERT, UPDATE');

CREATE TABLE message_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id),
  key              text NOT NULL,
  locale           text NOT NULL DEFAULT 'en' CONSTRAINT message_templates_locale_check CHECK (locale IN ('en', 'ur', 'ur-Latn')),
  body             text NOT NULL,                     -- with {{1}}, {{2}} placeholders (what the customer sees)
  wa_template_name text,
  wa_template_lang text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_key_key UNIQUE (workspace_id, key, locale)
);
CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('message_templates');

-- Forward-only message status (I1.4): sent < delivered < read. `failed` is handled separately in code.
CREATE FUNCTION wa_status_rank(s text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE s WHEN 'queued' THEN 0 WHEN 'sending' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE -1 END $$;

-- Platform-default WhatsApp number -> workspace. Webhooks on connection key `default` carry no tenant:
-- 1) a workspace connection whose public_config.phoneNumberId matches, 2) the workspace with slug
-- p_default_slug, 3) the oldest demo_mode workspace. Returns NULL when nothing matches (event is recorded, ignored).
CREATE FUNCTION messaging_resolve_workspace(p_phone_number_id text, p_default_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT c.workspace_id FROM public.integration_connections c
      WHERE c.provider = 'meta_whatsapp' AND c.user_id IS NULL AND c.status <> 'not_connected'
        AND c.public_config ->> 'phoneNumberId' = p_phone_number_id LIMIT 1),
    (SELECT w.id FROM public.workspaces w WHERE w.slug = p_default_slug),
    (SELECT w.id FROM public.workspaces w WHERE w.demo_mode ORDER BY w.created_at LIMIT 1))
$$;
REVOKE ALL ON FUNCTION messaging_resolve_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging_resolve_workspace(text, text) TO app_user;
