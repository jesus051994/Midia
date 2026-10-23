-- EJECUTAR SOLO EN EL PROYECTO SUPABASE “midia” (NO en GastosCasaJD).
-- Esto convierte las tres tablas en una agenda compartida de acceso público.
-- Cualquier visitante podrá leer, añadir, editar y borrar datos de esta agenda.

begin;

-- Se elimina la relación con auth.users porque la agenda ya no usa cuentas.
alter table public.tareas drop constraint if exists tareas_usuario_id_fkey;
alter table public.entrenamientos drop constraint if exists entrenamientos_usuario_id_fkey;
alter table public.preferencias drop constraint if exists preferencias_usuario_id_fkey;

-- Reasignar los registros existentes al espacio compartido.
update public.tareas set usuario_id = '00000000-0000-4000-8000-000000000001';
update public.entrenamientos set usuario_id = '00000000-0000-4000-8000-000000000001';
update public.preferencias set usuario_id = '00000000-0000-4000-8000-000000000001';

-- Eliminar las políticas privadas anteriores.
drop policy if exists "Cada usuario gestiona sus tareas" on public.tareas;
drop policy if exists "Cada usuario gestiona sus entrenamientos" on public.entrenamientos;
drop policy if exists "Cada usuario gestiona sus preferencias" on public.preferencias;

-- Acceso compartido público para la agenda.
create policy "Agenda compartida publica tareas" on public.tareas
  for all to anon, authenticated
  using (usuario_id = '00000000-0000-4000-8000-000000000001')
  with check (usuario_id = '00000000-0000-4000-8000-000000000001');

create policy "Agenda compartida publica entrenamientos" on public.entrenamientos
  for all to anon, authenticated
  using (usuario_id = '00000000-0000-4000-8000-000000000001')
  with check (usuario_id = '00000000-0000-4000-8000-000000000001');

create policy "Agenda compartida publica preferencias" on public.preferencias
  for all to anon, authenticated
  using (usuario_id = '00000000-0000-4000-8000-000000000001')
  with check (usuario_id = '00000000-0000-4000-8000-000000000001');

commit;
