-- =====================================================================
-- PETIT MATÉRIEL — TRANSMISSION AUTOMATIQUE AU PROCHAIN MATCH
-- ---------------------------------------------------------------------
-- Boucle « validation responsable → clôture → prochain match » :
--   1. Les responsables VALIDENT leurs besoins petit matériel (save_zone_petit_materiel).
--   2. Le match se clôture ; les besoins persistent dans petit_materiel_requests.
--   3. À la CRÉATION du match suivant (rattaché via previous_event_id), ce trigger
--      recopie AUTOMATIQUEMENT les besoins validés du match précédent → ils
--      apparaissent aussitôt sur les fiches runner du nouveau match (qui lisent
--      petit_materiel_requests). Les équipes reçoivent le besoin sans ressaisie.
--
-- Praticité / sécurité :
--   • Matchs uniquement (le précédent doit aussi être un match).
--   • ON CONFLICT DO NOTHING : ne JAMAIS écraser une saisie déjà faite sur le
--     nouveau match (une validation fraîche prime sur la reprise automatique).
--   • Se déclenche à l'INSERT (match créé avec son rattachement) ET quand le
--     rattachement previous_event_id est posé plus tard (UPDATE).
--   • SECURITY DEFINER : écrit malgré la RLS ; ne touche à aucune autre table.
-- =====================================================================

create or replace function public.trg_pm_carry_forward()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_from uuid;
begin
  -- Seulement pour un match rattaché à un événement précédent.
  if NEW.event_type is distinct from 'match' or NEW.previous_event_id is null then
    return NEW;
  end if;

  -- Le précédent doit être un match (transmission entre matchs uniquement).
  select e.event_id into v_from
    from public.events e
   where e.event_id = NEW.previous_event_id and e.event_type = 'match';
  if v_from is null then
    return NEW;
  end if;

  -- Reprise des besoins validés (qty > 0) du match précédent vers le nouveau.
  -- DO NOTHING : on n'écrase pas une éventuelle saisie déjà présente sur le
  -- nouveau match (praticité : la validation locale reste prioritaire).
  insert into public.petit_materiel_requests (event_id, space_id, item_id, qty)
  select NEW.event_id, r.space_id, r.item_id, r.qty
    from public.petit_materiel_requests r
   where r.event_id = v_from and r.qty > 0
  on conflict (event_id, space_id, item_id) do nothing;

  return NEW;
end $fn$;

-- À la création d'un match.
drop trigger if exists trg_pm_carry_forward_ins on public.events;
create trigger trg_pm_carry_forward_ins
  after insert on public.events
  for each row execute function public.trg_pm_carry_forward();

-- Quand le rattachement au match précédent est posé / modifié après coup.
drop trigger if exists trg_pm_carry_forward_upd on public.events;
create trigger trg_pm_carry_forward_upd
  after update of previous_event_id on public.events
  for each row
  when (NEW.previous_event_id is not null
        and NEW.previous_event_id is distinct from OLD.previous_event_id)
  execute function public.trg_pm_carry_forward();
