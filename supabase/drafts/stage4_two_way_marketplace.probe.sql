-- STAGE 4 PROBE: read-only. Run after applying stage 4; every column must be true.
select
  (select relrowsecurity from pg_class where oid = 'public.trips'::regclass) as trips_rls,
  (select relrowsecurity from pg_class where oid = 'public.marketplace_events'::regclass) as events_rls,
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('trips', 'marketplace_events') and grantee = 'anon') as anon_no_grants,
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'marketplace_events' and grantee = 'authenticated'
                and privilege_type <> 'SELECT') as history_read_only,
  not exists (select 1 from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'requests' and grantee = 'authenticated'
                and privilege_type in ('INSERT', 'UPDATE') and column_name in ('eligibility_status', 'status', 'shopper_id')) as eligibility_server_only,
  not exists (select 1 from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'trips' and grantee = 'authenticated'
                and privilege_type in ('INSERT', 'UPDATE') and column_name in ('verification_status', 'traveller_id')) as trip_owner_and_verification_server_only,
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('trip_matches_request', 'matching_requests', 'matching_trips', 'trip_can_offer', 'accept_offer',
                                'decline_offer', 'withdraw_offer', 'cancel_request', 'complete_request', 'log_offer_submitted', 'publish_request')
              and has_function_privilege('anon', p.oid, 'execute')) as anon_cannot_call,
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')) as definer_search_path_fixed,
  -- Audit I3: nobody but the owner selects a request directly, and history never shows who acted.
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'SELECT'
              and qual <> '(shopper_id = ( SELECT auth.uid() AS uid))') as requests_owner_only_read,
  not has_column_privilege('authenticated', 'public.marketplace_events', 'actor_id', 'select') as event_actor_hidden,
  not has_function_privilege('authenticated', 'public.trip_matches_request(public.trips, public.requests)', 'execute') as match_rule_internal,
  (select prosrc like '%source_country%' and prosrc like '%request_published%' from pg_proc where oid = 'public.publish_request(uuid)'::regprocedure) as publish_needs_route,
  (select count(*) = 0 from public.trips) as no_trips_yet;
