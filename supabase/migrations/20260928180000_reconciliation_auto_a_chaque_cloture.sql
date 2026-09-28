-- =====================================================================
-- RÉCONCILIATION AUTOMATIQUE À CHAQUE CLÔTURE D'ÉVÉNEMENT (match)
-- ---------------------------------------------------------------------
-- EXIGENCE MÉTIER (utilisateur) : « Implique constamment cette maîtrise
--   après chaque événement du stade clôturé — le travail automatique de
--   l'agent IA qui à la fin maîtrisera. »
--
-- Brique 1 (déterministe, garantie) : dès qu'un MATCH passe clôturé, la
--   réconciliation complète des stocks se lance automatiquement, sans
--   attendre personne :
--     A) dérive les finals manquants/aberrants dans les espaces ;
--     B) remet à 0 le live des espaces NON conservés (fûts puis non-fûts) ;
--     C) réaligne keg_inventory sur area_stocks (autorité) ;
--     D) filet de récence : répare tout live clobberé par une dérivation
--        antérieure (reanchor au dernier match).
--   → C'est exactement le protocole reconcile_event_closure(dry_run:=false),
--     le même qu'on lance à la main. Les fûts restent dans les espaces
--     attitrés (drapeau retain_kegs_in_espace = retains_stock, migration
--     20260928170000), les non conservés repartent en central.
--
-- Brique « mémoire » (mastery trail) : chaque exécution est journalisée dans
--   event_closure_reconciliation_log (résultat complet + nb d'anomalies).
--   C'est le substrat que l'agent régie-stock relit pour auditer, détecter
--   les dérives (réserves négatives, ancrages fûts périmés, audit bloquant)
--   et affiner le protocole — la partie « il s'entraîne et finit par maîtriser ».
--
-- NON BLOQUANT : la réconciliation est enveloppée dans un bloc EXCEPTION.
--   Si elle échoue, la CLÔTURE de l'utilisateur RÉUSSIT quand même ; l'échec
--   est journalisé (mode='error') et sera rattrapé par l'audit de l'agent.
--
-- ORDRE : trigger nommé trg_zz_* → s'exécute APRÈS trg_event_stock_lifecycle
--   (ordre alphabétique), donc après que le lifecycle de clôture a posé les
--   finals/mouvements de base.
--
-- GARDE-FOUS : RG-002 (chaque écriture stock = mouvement, via les RPC
--   appelées), RG-006 (clôture = ROLE_STADE ; reconcile_event_closure
--   re-vérifie is_stade()), RG-011 (aucune suppression). Aucun stock inventé :
--   les ancrages fûts périmés restent signalés pour comptage physique.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Table journal (mastery trail) — relue par l'agent, jamais bloquante.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.event_closure_reconciliation_log (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(event_id) on delete cascade,
  ran_at          timestamptz not null default now(),
  triggered_by    text not null default 'trigger auto clôture',
  mode            text not null,            -- 'applied' | 'error'
  success         boolean not null default false,
  anomalies_count int  not null default 0,  -- ancrages périmés + échec audit
  result          jsonb,                    -- json complet de reconcile_event_closure
  error_text      text
);
create index if not exists idx_closure_recon_log_event
  on public.event_closure_reconciliation_log (event_id, ran_at desc);

comment on table public.event_closure_reconciliation_log is
  'Journal des réconciliations de clôture (trigger auto). Substrat d''audit pour l''agent régie-stock : résultat complet + anomalies à traiter.';


-- ─────────────────────────────────────────────────────────────────────
-- Fonction trigger : réconcilie à la transition vers clôturé (match only).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.trg_reconcile_on_close()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_closed_set text[] := array['clôturé','cloture','archivé','archive'];
  v_res    jsonb;
  v_anom   int := 0;
  v_ok     boolean := false;
begin
  -- Ne se déclenche qu'à l'ENTRÉE dans l'état clôturé/archivé, pour un match.
  if lower(coalesce(NEW.status,'')) = any(v_closed_set)
     and lower(coalesce(OLD.status,'')) <> all(v_closed_set)
     and coalesce(NEW.event_type,'') = 'match'
  then
    begin
      v_res := public.reconcile_event_closure(NEW.event_id, 'Clôture auto (trigger)', false)::jsonb;
      v_ok  := coalesce((v_res->>'success')::boolean, false);
      -- Anomalies = ancrages dépôts périmés (comptage physique requis).
      v_anom := coalesce(jsonb_array_length(v_res->'depots_ancrages_perimes'), 0);

      insert into public.event_closure_reconciliation_log
        (event_id, triggered_by, mode, success, anomalies_count, result)
      values
        (NEW.event_id, 'trigger auto clôture', 'applied', v_ok, v_anom, v_res);

    exception when others then
      -- NON BLOQUANT : la clôture réussit ; l'échec est journalisé.
      insert into public.event_closure_reconciliation_log
        (event_id, triggered_by, mode, success, anomalies_count, error_text)
      values
        (NEW.event_id, 'trigger auto clôture', 'error', false, 0, sqlerrm);
      raise warning 'trg_reconcile_on_close: réconciliation non bloquante échouée pour % : %', NEW.event_id, sqlerrm;
    end;
  end if;

  return NEW;
end $$;


drop trigger if exists trg_zz_reconcile_on_close on public.events;
create trigger trg_zz_reconcile_on_close
  after update of status on public.events
  for each row
  execute function public.trg_reconcile_on_close();


-- ─────────────────────────────────────────────────────────────────────
-- VÉRIFICATION (lecture)
-- ─────────────────────────────────────────────────────────────────────
-- select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
--  where c.relname='events' and tgname='trg_zz_reconcile_on_close';   -- présent
-- select * from public.event_closure_reconciliation_log order by ran_at desc limit 5;
-- =====================================================================
