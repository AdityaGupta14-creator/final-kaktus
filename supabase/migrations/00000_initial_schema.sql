-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PROFILES
-- We use Firebase UID as the primary key. Since Firebase UIDs are random strings, we use TEXT.
CREATE TABLE profiles (
  uid TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECTS
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  board_type TEXT,
  status TEXT DEFAULT 'active',
  workspace_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CHAT SESSIONS
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CHAT MESSAGES
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECT COMPONENTS
CREATE TABLE project_components (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL,
  configuration JSONB,
  placement JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECT CONNECTIONS
CREATE TABLE project_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_component_id TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  source_pin TEXT NOT NULL,
  target_component_id TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  target_pin TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECT FILES
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT,
  content TEXT, -- For code files
  storage_path TEXT, -- For binary files in Supabase Storage
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ACTIVITY LOGS
CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SUBSCRIPTIONS
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_uid)
);

-- INDEXES
CREATE INDEX idx_projects_owner ON projects(owner_uid);
CREATE INDEX idx_chat_sessions_owner ON chat_sessions(owner_uid);
CREATE INDEX idx_chat_sessions_project ON chat_sessions(project_id);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_project_components_project ON project_components(project_id);
CREATE INDEX idx_project_connections_project ON project_connections(project_id);
CREATE INDEX idx_project_files_project ON project_files(project_id);

-- ROW LEVEL SECURITY (RLS)
-- We will enforce security via the Next.js API using Service Role Keys, 
-- but we enable RLS to ensure direct client queries are blocked by default.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Note: We are using Next.js API routes with Firebase verification to enforce security. 
-- Direct client access via anon keys will be rejected because no permissive RLS policies are created.

-- Create storage buckets for binary files and attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('project_files', 'project_files', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('chat_attachments', 'chat_attachments', false) ON CONFLICT (id) DO NOTHING;
