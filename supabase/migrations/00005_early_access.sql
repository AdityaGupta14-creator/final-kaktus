-- 00005_early_access.sql

-- Table: early_access_members
-- Tracks which users are granted Early Access.
CREATE TABLE IF NOT EXISTS public.early_access_members (
    user_uid text PRIMARY KEY,
    granted_at timestamptz DEFAULT now() NOT NULL,
    granted_by text
);

-- Table: early_access_features
-- Tracks available early access features.
CREATE TABLE IF NOT EXISTS public.early_access_features (
    slug text PRIMARY KEY,
    title text NOT NULL,
    description text,
    category text,
    release_version text,
    status text NOT NULL DEFAULT 'coming_soon', -- 'available', 'testing', 'coming_soon'
    release_notes text,
    testing_instructions text,
    known_issues text,
    published_at timestamptz,
    access_mode text NOT NULL DEFAULT 'disabled', -- 'all_members', 'selected', 'disabled'
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Table: early_access_feature_testers
-- For access_mode = 'selected'
CREATE TABLE IF NOT EXISTS public.early_access_feature_testers (
    feature_slug text REFERENCES public.early_access_features(slug) ON DELETE CASCADE,
    user_uid text NOT NULL,
    granted_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (feature_slug, user_uid)
);

-- Table: early_access_feedback
CREATE TABLE IF NOT EXISTS public.early_access_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uid text NOT NULL,
    feature_slug text REFERENCES public.early_access_features(slug) ON DELETE SET NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    reproduction_steps text,
    severity text,
    status text NOT NULL DEFAULT 'new', -- 'new', 'reviewing', 'planned', 'fixed', 'closed'
    internal_notes text,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- RLS
ALTER TABLE public.early_access_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_access_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_access_feature_testers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_access_feedback ENABLE ROW LEVEL SECURITY;

-- Kaktus backend uses service_role key to bypass RLS, but if any direct client access is needed, we would add policies here.
