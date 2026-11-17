-- Ayllu Canchas · migración 002: tipo de deporte, foto por cancha y "agregados" (extras) pedibles en la reserva.
-- Ejecutar DESPUÉS de 001_canchas.sql (SQL Editor → New query → Run).

-- ---------- Canchas: deporte y foto ----------
alter table public.canchas
  add column deporte  text not null default 'futbol' check (deporte in ('futbol','loza','basquet','voley')),
  add column foto_url text check (foto_url is null or foto_url ~ '^https://');   -- opcional; si es null se muestra una imagen genérica

-- ---------- Agregados que ofrece el complejo ----------
-- tipo 'servicio' = parte del servicio, sin costo (chalecos, proyector…): el jugador solo lo pide.
-- tipo 'producto' = de la tienda, con precio (bebidas, comida): suma al total y se cobra en la cancha.
create table public.extras (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references public.negocios(id) on delete cascade,
  nombre      text not null check (char_length(btrim(nombre)) between 2 and 60),
  precio      numeric(8,2) not null default 0 check (precio >= 0),
  tipo        text not null default 'producto' check (tipo in ('servicio','producto')),
  created_at  timestamptz not null default now(),
  check (tipo = 'producto' or precio = 0)
);
create index extras_negocio_idx on public.extras (negocio_id);
alter table public.extras enable row level security;
revoke all on public.extras from anon;
create policy extras_dueno on public.extras for all to authenticated
  using (negocio_id = public.mi_negocio_id()) with check (negocio_id = public.mi_negocio_id());

-- ---------- Reservas: foto fija de lo pedido (nombre, precio y cantidad al momento de reservar) ----------
alter table public.reservas
  add column extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array');

-- ---------- Funciones públicas actualizadas ----------
create or replace function public.public_negocio(p_slug text) returns json
language plpgsql security definer set search_path = public as $$
declare n public.negocios;
begin
  select * into n from public.negocios where slug = lower(p_slug);
  if not found then return null; end if;
  return json_build_object(
    'nombre', n.nombre, 'yape', n.yape, 'whatsapp', n.whatsapp, 'sena', n.sena,
    'minutosSena', n.minutos_sena, 'horaInicio', n.hora_inicio, 'horaFin', n.hora_fin,
    'canchas', coalesce((select json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'precioHora', c.precio_hora,
                            'deporte', c.deporte, 'fotoUrl', c.foto_url) order by c.created_at, c.nombre)
                         from public.canchas c where c.negocio_id = n.id), '[]'::json),
    'extras', coalesce((select json_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'precio', e.precio, 'tipo', e.tipo) order by e.tipo desc, e.created_at, e.nombre)
                        from public.extras e where e.negocio_id = n.id), '[]'::json));
end $$;

drop function if exists public.public_reservar(text, uuid, date, int, int, text, text);
create or replace function public.public_reservar(
  p_slug text, p_cancha uuid, p_fecha date, p_hora int, p_dur int, p_nombre text, p_telefono text,
  p_extras jsonb default '[]'::jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare n public.negocios; r public.reservas; ahora_lima timestamp; lista jsonb;
begin
  perform public.expirar_pendientes();
  select * into n from public.negocios where slug = lower(p_slug);
  if not found then raise exception 'negocio_no_existe'; end if;
  if not exists (select 1 from public.canchas where id = p_cancha and negocio_id = n.id) then
    raise exception 'datos_invalidos'; end if;
  if p_nombre is null or char_length(btrim(p_nombre)) < 2 or char_length(p_nombre) > 80
     or p_telefono is null or p_telefono !~ '^9[0-9]{8}$' or p_dur not between 1 and 2 then
    raise exception 'datos_invalidos'; end if;
  -- Agregados: [{"id": uuid, "cant": 1..10}]. El precio y el nombre salen de la base, no del jugador.
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' or jsonb_array_length(p_extras) > 10 then
    raise exception 'datos_invalidos'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('nombre', e.nombre, 'precio', e.precio, 'tipo', e.tipo, 'cant', x.cant)), '[]'::jsonb) into lista
    from (select (v->>'id')::uuid as id, (v->>'cant')::int as cant from jsonb_array_elements(p_extras) v) x
    join public.extras e on e.id = x.id and e.negocio_id = n.id
    where x.cant between 1 and 10;
    if jsonb_array_length(lista) <> jsonb_array_length(p_extras) then raise exception 'datos_invalidos'; end if;
  exception when invalid_text_representation or null_value_not_allowed then
    raise exception 'datos_invalidos';
  end;
  if p_hora < n.hora_inicio or p_hora + p_dur > n.hora_fin then raise exception 'horario_invalido'; end if;
  ahora_lima := now() at time zone 'America/Lima';
  if p_fecha::timestamp + p_hora * interval '1 hour' <= ahora_lima then raise exception 'pasado'; end if;
  if p_fecha > (ahora_lima::date + 31) then raise exception 'horario_invalido'; end if;
  if (select count(*) from public.reservas where negocio_id = n.id and telefono = p_telefono and estado = 'pendiente') >= 2 then
    raise exception 'limite_pendientes'; end if;
  begin
    insert into public.reservas (negocio_id, cancha_id, fecha, hora, dur, nombre, telefono, sena, estado, origen, vence_en, extras)
    values (n.id, p_cancha, p_fecha, p_hora, p_dur, btrim(p_nombre), p_telefono, n.sena, 'pendiente', 'enlace',
            now() + n.minutos_sena * interval '1 minute', lista)
    returning * into r;
  exception when exclusion_violation then
    raise exception 'ocupado';
  end;
  return json_build_object('id', r.id, 'codigo', upper(right(r.id::text, 4)), 'venceEn', r.vence_en);
end $$;

create or replace function public.public_estado_reserva(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r public.reservas;
begin
  perform public.expirar_pendientes();
  select * into r from public.reservas where id = p_id;
  if not found then return null; end if;
  return json_build_object('id', r.id, 'estado', r.estado, 'venceEn', r.vence_en, 'canchaId', r.cancha_id,
    'fecha', r.fecha, 'hora', r.hora, 'dur', r.dur, 'sena', r.sena, 'nombre', r.nombre, 'extras', r.extras,
    'codigo', upper(right(r.id::text, 4)));
end $$;

revoke execute on function public.public_reservar(text, uuid, date, int, int, text, text, jsonb) from public;
grant  execute on function public.public_reservar(text, uuid, date, int, int, text, text, jsonb) to anon, authenticated;
