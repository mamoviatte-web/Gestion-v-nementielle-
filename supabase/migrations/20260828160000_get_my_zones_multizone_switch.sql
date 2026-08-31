-- Multi-zone responsable : basculer entre ses zones sans se reconnecter
-- ============================================================================
-- Problème : un responsable gérant plusieurs zones (ex. 3 buvettes) devait, pour
-- passer de l'une à l'autre, quitter (leave_session → is_active=false) puis se
-- reconnecter (code + re-sélection de l'espace). Friction propice aux saisies
-- inabouties (cf. clôtures non validées du match Agen).
--
-- get_match_session réactive déjà un token au chargement (is_active=true) : il
-- suffisait donc de RETROUVER les autres zones du responsable. get_my_zones liste,
-- pour le (événement, nom) de la session courante, toutes ses zones avec leur token
-- et leur avancement (stock / débrief). Le header affiche un sélecteur « Mes zones »
-- qui navigue vers le token cible (réactivation automatique), en conservant la
-- sous-page courante (stocks / débrief). Aucune reconnexion.
create or replace function public.get_my_zones(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare v_event uuid; v_staff text;
begin
  select event_id, staff_name into v_event, v_staff
    from match_access_sessions where session_token = trim(p_token);
  if v_event is null then
    return json_build_object('success', false, 'error', 'Session expirée');
  end if;

  -- Toutes les zones de CE responsable sur CET événement (même nom), avec le token
  -- de chacune (réactivable au chargement) et l'avancement. Permet un sélecteur
  -- « Mes zones » : basculer sans se reconnecter.
  return json_build_object(
    'success', true,
    'staff_name', v_staff,
    'zones', (
      select coalesce(json_agg(json_build_object(
        'space_id', z.space_id,
        'space_name', s.space_name,
        'service_type', s.service_type,
        'session_token', z.session_token,
        'is_current', (z.session_token = trim(p_token)),
        'stock_started', exists(select 1 from event_stock_lines esl
          where esl.event_id=v_event and esl.space_id=z.space_id and (coalesce(esl.initial_qty,0)>0 or coalesce(esl.reassort_qty,0)>0)),
        'stock_done', exists(select 1 from event_stock_lines esl
          where esl.event_id=v_event and esl.space_id=z.space_id and esl.final_qty is not null),
        'debrief_done', exists(select 1 from debriefs d
          where d.event_id=v_event and d.space_id=z.space_id and d.submitted_at is not null)
      ) order by s.space_name), '[]'::json)
      from match_access_sessions z
      join spaces s on s.space_id = z.space_id
      where z.event_id = v_event and z.staff_name = v_staff
    )
  );
end $fn$;
grant execute on function public.get_my_zones(text) to anon, authenticated;
