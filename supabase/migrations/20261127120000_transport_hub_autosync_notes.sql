-- Driver notes and addresses kick the transport hub sync (27 Nov 2026).
--
-- The owner's transport note, the dog's driver note and the owner's address line all
-- travel to AE on every sync (they become the Master card's note and the driver's
-- line), but editing only one of them did not kick a sync: the owners trigger watched
-- the pin and name, the pets trigger the Voltlines link and name. A note changed on its
-- own waited for some other change of that client, or the nightly run. They now kick
-- like the rest. Idempotent.

drop trigger if exists zz_transport_hub_autosync_upd on public.owners;
create trigger zz_transport_hub_autosync_upd after update on public.owners
  for each row execute function public.transport_hub_autosync_row(
    'pin_lat', 'pin_lng', 'first_name', 'last_name', 'transport_notes', 'address'
  );

drop trigger if exists zz_transport_hub_autosync_upd on public.pets;
create trigger zz_transport_hub_autosync_upd after update on public.pets
  for each row execute function public.transport_hub_autosync_row(
    'voltlines_passenger_id', 'name', 'owner_id', 'driver_note'
  );
