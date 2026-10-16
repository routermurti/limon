-- Limon package activation: a separate, strict RLS-gated migration.
-- Prepared locally only; do NOT apply to live Supabase without explicit approval.
-- It deliberately aborts if the package table is missing, RLS is off, or any pre-existing
-- UPDATE/ALL policy needs review. It never drops an existing policy or enables payments.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.limon_packages') IS NULL THEN
    RAISE EXCEPTION 'Expected public.limon_packages was not found; inspect the live schema.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='limon_packages' AND column_name='is_active'
  ) THEN
    RAISE EXCEPTION 'Expected limon_packages.is_active was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='limon_packages' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on limon_packages; no activation policy will be added.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='limon_admins' AND column_name='user_id'
  ) THEN
    RAISE EXCEPTION 'Expected limon_admins.user_id membership source was not found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_packages'
      AND cmd IN ('ALL','UPDATE')
      AND policyname <> 'limon_admins_manage_package_status_v1'
      AND (roles @> ARRAY['anon'::name] OR roles @> ARRAY['public'::name]
           OR roles @> ARRAY['authenticated'::name])
  ) THEN
    RAISE EXCEPTION 'Existing package UPDATE/ALL policy found. Audit roles and predicates manually before enabling the admin toggle.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_packages'
      AND policyname='limon_admins_manage_package_status_v1'
      AND (cmd <> 'UPDATE'
        OR NOT (roles @> ARRAY['authenticated'::name])
        OR position('limon_admin_can_manage_limon_records_v1' in coalesce(qual,'')) = 0
        OR position('limon_admin_can_manage_limon_records_v1' in coalesce(with_check,'')) = 0)
  ) THEN
    RAISE EXCEPTION 'Existing package activation policy has unexpected roles or predicates; inspect it manually.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.limon_admin_can_manage_limon_records_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.limon_admins AS admins
    WHERE admins.user_id = (SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.limon_admin_can_manage_limon_records_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limon_admin_can_manage_limon_records_v1() TO authenticated;
GRANT UPDATE (is_active) ON TABLE public.limon_packages TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='limon_packages'
      AND policyname='limon_admins_manage_package_status_v1'
  ) THEN
    EXECUTE 'CREATE POLICY limon_admins_manage_package_status_v1 ON public.limon_packages FOR UPDATE TO authenticated USING (public.limon_admin_can_manage_limon_records_v1()) WITH CHECK (public.limon_admin_can_manage_limon_records_v1())';
  END IF;
END;
$$;

COMMIT;
