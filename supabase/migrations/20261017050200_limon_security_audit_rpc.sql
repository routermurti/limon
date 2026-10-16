BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'limon_admins'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Required schema missing: public.limon_admins.user_id uuid';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.limon_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.limon_admins AS admins
    WHERE admins.user_id = (SELECT auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION public.limon_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limon_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.limon_security_audit()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.limon_is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'rls', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'table', c.relname,
            'enabled', c.relrowsecurity,
            'forced', c.relforcerowsecurity
          )
          ORDER BY c.relname
        ),
        '[]'::jsonb
      )
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND pg_catalog.substr(c.relname::text, 1, 6) = 'limon_'
    ),
    'policies', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'table', p.tablename,
            'name', p.policyname,
            'roles', p.roles,
            'command', p.cmd,
            'using', p.qual,
            'check', p.with_check
          )
          ORDER BY p.tablename, p.policyname
        ),
        '[]'::jsonb
      )
      FROM pg_catalog.pg_policies AS p
      WHERE p.schemaname = 'public'
        AND pg_catalog.substr(p.tablename, 1, 6) = 'limon_'
    ),
    'grants', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'table', t.table_name,
            'role', t.grantee,
            'privilege', t.privilege_type
          )
          ORDER BY t.table_name, t.grantee, t.privilege_type
        ),
        '[]'::jsonb
      )
      FROM information_schema.role_table_grants AS t
      WHERE t.table_schema = 'public'
        AND pg_catalog.substr(t.table_name, 1, 6) = 'limon_'
        AND t.grantee IN ('anon', 'authenticated')
    ),
    'indexes', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', i.indexname,
            'definition', i.indexdef
          )
          ORDER BY i.indexname
        ),
        '[]'::jsonb
      )
      FROM pg_catalog.pg_indexes AS i
      WHERE i.schemaname = 'public'
        AND i.tablename = 'limon_pre_registrations'
    ),
    'checked_at', pg_catalog.now()
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.limon_security_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limon_security_audit() TO authenticated;

COMMIT;
