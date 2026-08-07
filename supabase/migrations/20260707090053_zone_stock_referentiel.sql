-- 20260707090053 — Saisie responsable scopée au référentiel CDC de l'espace.
-- Fin du mélange buvette/VIP. Correctifs vs prompt : nom d'espace via spaces (v_s),
-- pas le 3e OUT de _zone_resolve (=staff) ; agrégats non imbriqués ; fallback profil
-- pour les espaces sans référentiel (Terrasses, Grandes Tablées).

-- ============================================================================
-- Saisie responsable : chaque espace n'affiche que SES produits (référentiel CDC).
-- Fin du mélange buvette / VIP. get_zone_buvette_stock déjà OK (inchangée).
-- ============================================================================

-- BLOC 2 — Aligner libellés espace ↔ référentiel
update area_product_reference set area_name='Loge Est'        where area_name='Loges Est';
update area_product_reference set area_name='Loge Ouest Nord' where area_name='Loges Ouest Nord';
update area_product_reference set area_name='Loge Ouest Sud'  where area_name='Loges Ouest Sud';

-- Club 70 Sud sans référentiel : cloner Club 70 Nord (mêmes produits)
insert into area_product_reference (area_name, area_group, product_family, product_name,
       association_level, legacy_area_name, product_id)
select 'Club 70 Sud', area_group, product_family, product_name,
       association_level, legacy_area_name, product_id
from area_product_reference where area_name='Club 70 Nord'
on conflict (area_name, product_name) do nothing;


-- BLOC 3 — get_zone_stock pilotée par le référentiel (agrégats non imbriqués)
create or replace function get_zone_stock(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_e uuid; v_s uuid; v_staff text; v_name text; v_prof text; v_has_ref boolean;
begin
  select * into v_e, v_s, v_staff from _zone_resolve(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session expirée'); end if;
  select space_name, space_profile(space_name) into v_name, v_prof from spaces where space_id = v_s;
  select exists(
    select 1 from area_product_reference apr
    where upper(btrim(apr.area_name)) = upper(btrim(v_name)) and apr.product_id is not null
  ) into v_has_ref;

  return json_build_object(
    'success', true,
    'space_profile', v_prof,
    'lines', (
      with cand as (
        select apr.product_id, apr.product_family, apr.association_level
        from area_product_reference apr
        where upper(btrim(apr.area_name)) = upper(btrim(v_name)) and apr.product_id is not null
        union
        select p.product_id, null::text, null::text
        from products p
        where (not v_has_ref) and p.active and v_prof = any(p.space_types)
        union
        select esl.product_id, null::text, null::text from event_stock_lines esl
          where esl.event_id = v_e and esl.space_id = v_s
        union
        select rd.product_id, null::text, null::text from runner_dotations rd
          where rd.event_id = v_e and rd.space_id = v_s
      ),
      rows as (
        select p.product_id, p.product_name, p.category, p.unit,
          max(cand.product_family)     as family,
          max(cand.association_level)  as association_level,
          coalesce(max(rd.planned_qty), 0)  as planned_qty,
          coalesce(max(esl.initial_qty), 0) as initial_qty,
          coalesce(max(esl.reassort_qty), 0) as reassort_qty,
          max(esl.final_qty)     as final_qty,
          max(esl.product_state) as product_state
        from cand
        join products p on p.product_id = cand.product_id and p.active = true and p.category <> 'Matériel'
        left join runner_dotations rd on rd.event_id = v_e and rd.space_id = v_s and rd.product_id = p.product_id
        left join event_stock_lines esl on esl.event_id = v_e and esl.space_id = v_s and esl.product_id = p.product_id
        group by p.product_id, p.product_name, p.category, p.unit
      )
      select coalesce(json_agg(json_build_object(
        'product_id', product_id, 'product_name', product_name,
        'category', category, 'unit', unit,
        'family', family, 'association_level', association_level,
        'planned_qty', planned_qty, 'initial_qty', initial_qty,
        'reassort_qty', reassort_qty, 'final_qty', final_qty, 'product_state', product_state
      ) order by category, product_name), '[]'::json)
      from rows
    )
  );
end $function$;

-- BLOC 4 — get_zone_roadmap : dotations sans fuite space_types (rd.space_id suffit)
create or replace function get_zone_roadmap(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $function$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_prof TEXT;
        v_ev events%ROWTYPE; v_sp spaces%ROWTYPE; v_rm zone_roadmaps%ROWTYPE; v_pub BOOLEAN;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_prof := space_profile(v_n);
  SELECT * INTO v_ev FROM events WHERE event_id = v_e;
  SELECT * INTO v_sp FROM spaces WHERE space_id = v_s;

  SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  IF NOT FOUND THEN
    INSERT INTO zone_roadmaps (event_id, space_id, is_published) VALUES (v_e, v_s, false)
    ON CONFLICT (event_id, space_id) DO NOTHING;
    SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  END IF;
  v_pub := COALESCE(v_rm.is_published, false);

  RETURN json_build_object(
    'success', true,
    'event_name', v_ev.event_name, 'event_date', v_ev.event_date, 'start_time', v_ev.start_time,
    'pax_count', v_ev.expected_attendees,
    'space_name', v_sp.space_name, 'service_type', v_sp.service_type,
    'is_published', v_pub,
    'brief_client',   CASE WHEN v_pub THEN v_rm.brief_client   END,
    'brief_consigne', CASE WHEN v_pub THEN v_rm.brief_consigne END,
    'brief_dress',    CASE WHEN v_pub THEN v_rm.brief_dress    END,
    'brief_horaires', CASE WHEN v_pub THEN v_rm.brief_horaires END,
    'nb_pax_espace',  CASE WHEN v_pub THEN v_rm.nb_pax_espace  END,
    'brief_dotations', CASE WHEN v_pub THEN COALESCE(v_rm.dotations, '[]'::jsonb) ELSE '[]'::jsonb END,
    'info_contact',  CASE WHEN v_pub THEN v_rm.info_contact  END,
    'info_acces',    CASE WHEN v_pub THEN v_rm.info_acces    END,
    'info_materiel', CASE WHEN v_pub THEN v_rm.info_materiel END,
    'published_by',  CASE WHEN v_pub THEN v_rm.published_by  END,
    'published_at',  CASE WHEN v_pub THEN v_rm.published_at  END,
    'dotations', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
        'planned_qty', rd.planned_qty, 'runner_status', rd.runner_status
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM runner_dotations rd JOIN products p ON p.product_id = rd.product_id
      WHERE rd.event_id = v_e AND rd.space_id = v_s),   -- plus de filtre space_types
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s)
  );
END; $function$;
