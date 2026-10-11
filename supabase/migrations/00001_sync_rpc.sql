-- Atomic RPC for Workspaces
CREATE OR REPLACE FUNCTION sync_workspace_atomic(
  p_owner_uid text,
  p_project_id text,
  p_project_name text,
  p_workspace_state jsonb,
  p_components jsonb,
  p_connections jsonb,
  p_files jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_existing_owner text;
BEGIN
  -- Verify ownership
  SELECT owner_uid INTO v_existing_owner FROM projects WHERE id = p_project_id;
  IF v_existing_owner IS NOT NULL AND v_existing_owner != p_owner_uid THEN
    RAISE EXCEPTION 'Unauthorized: Project belongs to another user';
  END IF;

  -- Upsert project
  INSERT INTO projects (id, owner_uid, name, workspace_state, updated_at)
  VALUES (p_project_id, p_owner_uid, p_project_name, p_workspace_state, NOW())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    workspace_state = EXCLUDED.workspace_state,
    updated_at = EXCLUDED.updated_at;

  -- Delete existing relations
  DELETE FROM project_components WHERE project_id = p_project_id;
  DELETE FROM project_connections WHERE project_id = p_project_id;
  DELETE FROM project_files WHERE project_id = p_project_id;

  -- Insert components
  IF jsonb_array_length(p_components) > 0 THEN
    INSERT INTO project_components (id, project_id, component_type, configuration, placement)
    SELECT
      (item->>'id')::text,
      p_project_id,
      (item->>'component_type')::text,
      (item->>'configuration')::jsonb,
      (item->>'placement')::jsonb
    FROM jsonb_array_elements(p_components) AS item;
  END IF;

  -- Insert connections
  IF jsonb_array_length(p_connections) > 0 THEN
    INSERT INTO project_connections (id, project_id, source_component_id, source_pin, target_component_id, target_pin, metadata)
    SELECT
      (item->>'id')::text,
      p_project_id,
      (item->>'source_component_id')::text,
      (item->>'source_pin')::text,
      (item->>'target_component_id')::text,
      (item->>'target_pin')::text,
      (item->>'metadata')::jsonb
    FROM jsonb_array_elements(p_connections) AS item;
  END IF;

  -- Insert files
  IF jsonb_array_length(p_files) > 0 THEN
    INSERT INTO project_files (id, project_id, filename, file_type, content)
    SELECT
      (item->>'id')::text,
      p_project_id,
      (item->>'filename')::text,
      (item->>'file_type')::text,
      (item->>'content')::text
    FROM jsonb_array_elements(p_files) AS item;
  END IF;
END;
$$;

-- Atomic RPC for Chats
CREATE OR REPLACE FUNCTION sync_chat_atomic(
  p_owner_uid text,
  p_session_id text,
  p_title text,
  p_messages jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_existing_owner text;
BEGIN
  -- Verify ownership
  SELECT owner_uid INTO v_existing_owner FROM chat_sessions WHERE id = p_session_id;
  IF v_existing_owner IS NOT NULL AND v_existing_owner != p_owner_uid THEN
    RAISE EXCEPTION 'Unauthorized: Chat belongs to another user';
  END IF;

  -- Upsert chat
  INSERT INTO chat_sessions (id, owner_uid, title, updated_at)
  VALUES (p_session_id, p_owner_uid, p_title, NOW())
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    updated_at = EXCLUDED.updated_at;

  -- Delete existing messages
  DELETE FROM chat_messages WHERE session_id = p_session_id;

  -- Insert messages
  IF jsonb_array_length(p_messages) > 0 THEN
    INSERT INTO chat_messages (id, session_id, message_role, content, metadata)
    SELECT
      (item->>'id')::text,
      p_session_id,
      (item->>'message_role')::text,
      (item->>'content')::text,
      (item->>'metadata')::jsonb
    FROM jsonb_array_elements(p_messages) AS item;
  END IF;
END;
$$;
