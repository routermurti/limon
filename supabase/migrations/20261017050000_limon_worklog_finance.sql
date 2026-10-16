-- Limon — admin worklog + project finance summaries
-- Prepared locally only. Do NOT apply to the live Supabase project without explicit approval.
-- Additive: creates private work/finance tables and aggregate summaries; no existing rows are deleted.
BEGIN;

-- Uses the same membership source as admin.html's verified-user gate.
-- The function reveals only whether the caller is an administrator; it cannot inspect another user's identity.
CREATE OR REPLACE FUNCTION public.limon_admin_can_manage_limon_records_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.limon_admins AS admins
    WHERE admins.user_id = (SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.limon_admin_can_manage_limon_records_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limon_admin_can_manage_limon_records_v1() TO authenticated;

CREATE TABLE IF NOT EXISTS public.limon_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  work_seconds integer NOT NULL CHECK (work_seconds >= 0 AND work_seconds <= 172800),
  break_seconds integer NOT NULL CHECK (break_seconds >= 0 AND break_seconds <= 86400),
  sleep_seconds integer NOT NULL DEFAULT 0 CHECK (sleep_seconds >= 0 AND sleep_seconds <= 86400),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT limon_work_session_time_order CHECK (ended_at >= started_at),
  CONSTRAINT limon_work_session_nonempty CHECK (work_seconds > 0 OR break_seconds > 0 OR sleep_seconds > 0)
);
ALTER TABLE public.limon_work_sessions ADD COLUMN IF NOT EXISTS sleep_seconds integer NOT NULL DEFAULT 0 CHECK (sleep_seconds >= 0 AND sleep_seconds <= 86400);
ALTER TABLE public.limon_work_sessions DROP CONSTRAINT IF EXISTS limon_work_sessions_work_seconds_check;
ALTER TABLE public.limon_work_sessions ADD CONSTRAINT limon_work_sessions_work_seconds_check CHECK (work_seconds >= 0 AND work_seconds <= 172800);
ALTER TABLE public.limon_work_sessions DROP CONSTRAINT IF EXISTS limon_work_session_nonempty;
ALTER TABLE public.limon_work_sessions ADD CONSTRAINT limon_work_session_nonempty CHECK (work_seconds > 0 OR break_seconds > 0 OR sleep_seconds > 0);
ALTER TABLE public.limon_work_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.limon_work_sessions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.limon_work_sessions TO authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_work_sessions'
      AND policyname='limon_admins_manage_work_sessions_v1'
  ) THEN
    EXECUTE 'CREATE POLICY limon_admins_manage_work_sessions_v1 ON public.limon_work_sessions FOR ALL TO authenticated USING (public.limon_admin_can_manage_limon_records_v1() AND created_by = (SELECT auth.uid())) WITH CHECK (public.limon_admin_can_manage_limon_records_v1() AND created_by = (SELECT auth.uid()))';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.limon_work_summary (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  total_work_seconds bigint NOT NULL DEFAULT 0 CHECK (total_work_seconds >= 0),
  total_break_seconds bigint NOT NULL DEFAULT 0 CHECK (total_break_seconds >= 0),
  session_count bigint NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.limon_work_summary (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.limon_work_summary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.limon_work_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.limon_work_summary TO anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_work_summary'
      AND policyname='public_read_work_totals_v1'
  ) THEN
    EXECUTE 'CREATE POLICY public_read_work_totals_v1 ON public.limon_work_summary FOR SELECT TO anon, authenticated USING (true)';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.limon_recalculate_work_summary_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.limon_work_summary (id, total_work_seconds, total_break_seconds, session_count, updated_at)
  SELECT true, COALESCE(sum(work_seconds),0), COALESCE(sum(break_seconds),0), count(*), now()
  FROM public.limon_work_sessions
  ON CONFLICT (id) DO UPDATE SET
    total_work_seconds=EXCLUDED.total_work_seconds,
    total_break_seconds=EXCLUDED.total_break_seconds,
    session_count=EXCLUDED.session_count,
    updated_at=EXCLUDED.updated_at;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.limon_recalculate_work_summary_v1() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS limon_work_summary_refresh_v1 ON public.limon_work_sessions;
CREATE TRIGGER limon_work_summary_refresh_v1
AFTER INSERT OR UPDATE OR DELETE ON public.limon_work_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.limon_recalculate_work_summary_v1();

CREATE TABLE IF NOT EXISTS public.limon_finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category varchar(80) NOT NULL CHECK (length(trim(category)) > 0),
  amount_kurus bigint NOT NULL CHECK (amount_kurus > 0 AND amount_kurus <= 1000000000000000),
  occurred_on date NOT NULL,
  note varchar(400),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.limon_finance_entries IS 'Private project-tracking entries; not a statutory accounting ledger.';
ALTER TABLE public.limon_finance_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.limon_finance_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.limon_finance_entries TO authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_finance_entries'
      AND policyname='limon_admins_manage_finance_entries_v1'
  ) THEN
    EXECUTE 'CREATE POLICY limon_admins_manage_finance_entries_v1 ON public.limon_finance_entries FOR ALL TO authenticated USING (public.limon_admin_can_manage_limon_records_v1() AND created_by = (SELECT auth.uid())) WITH CHECK (public.limon_admin_can_manage_limon_records_v1() AND created_by = (SELECT auth.uid()))';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.limon_finance_summary (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  income_total_kurus bigint NOT NULL DEFAULT 0 CHECK (income_total_kurus >= 0),
  expense_total_kurus bigint NOT NULL DEFAULT 0 CHECK (expense_total_kurus >= 0),
  entry_count bigint NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.limon_finance_summary (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.limon_finance_summary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.limon_finance_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.limon_finance_summary TO anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_finance_summary'
      AND policyname='public_read_finance_totals_v1'
  ) THEN
    EXECUTE 'CREATE POLICY public_read_finance_totals_v1 ON public.limon_finance_summary FOR SELECT TO anon, authenticated USING (true)';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.limon_recalculate_finance_summary_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.limon_finance_summary (id, income_total_kurus, expense_total_kurus, entry_count, updated_at)
  SELECT true,
    COALESCE(sum(amount_kurus) FILTER (WHERE kind='income'),0),
    COALESCE(sum(amount_kurus) FILTER (WHERE kind='expense'),0),
    count(*), now()
  FROM public.limon_finance_entries
  ON CONFLICT (id) DO UPDATE SET
    income_total_kurus=EXCLUDED.income_total_kurus,
    expense_total_kurus=EXCLUDED.expense_total_kurus,
    entry_count=EXCLUDED.entry_count,
    updated_at=EXCLUDED.updated_at;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.limon_recalculate_finance_summary_v1() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS limon_finance_summary_refresh_v1 ON public.limon_finance_entries;
CREATE TRIGGER limon_finance_summary_refresh_v1
AFTER INSERT OR UPDATE OR DELETE ON public.limon_finance_entries
FOR EACH STATEMENT EXECUTE FUNCTION public.limon_recalculate_finance_summary_v1();

COMMIT;
