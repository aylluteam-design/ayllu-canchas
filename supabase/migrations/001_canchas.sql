-- =====================================================================
-- AYLLU CANCHAS · Migración 001 (Supabase / Postgres)
-- Pega TODO este archivo en Supabase > SQL Editor > New query > Run.
-- Es seguro correrlo una sola vez. Para empezar de cero, ver el README.
--
-- Modelo:
--   negocios  → un complejo (lo administra un usuario de Supabase Auth)
--   canchas   → las canchas del complejo
--   reservas  → reservas; el choque de horarios lo impide la base de datos
--
-- Seguridad:
--   * El dueño (usuario autenticado) solo ve y toca lo de SU negocio (RLS).
--   * El público (jugador sin login) NO accede a las tablas. Solo usa 4 funciones:
--       public_negocio, public_ocupados, public_reservar, public_estado_reserva
--     y ninguna devuelve nombres ni teléfonos de otras personas.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------- Tablas ----------
create table public.negocios (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references auth.users(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  nombre        text not null check (char_length(nombre) between 2 and 80),
  yape          text not null default '',
  whatsapp      text not null default '',
  sena          numeric(8,2) not null default 20 check (sena >= 0),
  minutos_sena  int not null default 30 check (minutos_sena between 5 and 240),
  hora_inicio   smallint not null default 16 check (hora_inicio between 0 and 23),
  hora_fin      smallint not null default 24 check (hora_fin between 1 and 24),
  created_at    timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

create table public.canchas (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  nombre       text not null check (char_length(nombre) between 1 and 60),
  precio_hora  numeric(8,2) not null default 70 check (precio_hora >= 0),
  created_at   timestamptz not null default now(),
  unique (id, negocio_id)
);

create table public.reservas (
  id                    uuid primary key default gen_random_uuid(),
  negocio_id            uuid not null,
  cancha_id             uuid not null,
  fecha                 date not null,
  hora                  smallint not null check (hora between 0 and 23),
  dur                   smallint not null default 1 check (dur between 1 and 3),
  nombre                text not null check (char_length(btrim(nombre)) between 2 and 80),
  telefono              text not null default '' check (telefono = '' or telefono ~ '^9[0-9]{8}$'),
  sena                  numeric(8,2) not null default 0 check (sena >= 0),
  sena_pagada           boolean not null default false,
  estado                text not null default 'activa' check (estado in ('pendiente','activa','vencida','cancelada')),
  origen                text not null default 'dueno' check (origen in ('enlace','dueno')),
  vence_en              timestamptz,
  recordatorio_enviado  boolean not null default false,
  created_at            timestamptz not null default now(),
  -- hora local de Lima, sin zona horaria: lo que el dueño ve en su agenda
  inicio                timestamp generated always as (fecha::timestamp + hora * interval '1 hour') stored,
  fin                   timestamp generated always as (fecha::timestamp + (hora + dur) * interval '1 hour') stored,
  check (hora + dur <= 24),
  check (estado <> 'pendiente' or vence_en is not null),
  foreign key (cancha_id, negocio_id) references public.canchas(id, negocio_id) on delete restrict,
  -- ANTI-DOBLE-BOOKING: dos reservas vivas (pendiente o activa) no pueden pisarse en la misma cancha
  constraint reservas_sin_choque
    exclude using gist (cancha_id with =, tsrange(inicio, fin) with &&)
    where (estado in ('pendiente','activa'))
);
create index reservas_negocio_fecha_idx on public.reservas (negocio_id, fecha);
create index reservas_pendientes_idx on public.reservas (vence_en) where estado = 'pendiente';

-- ---------- Seguridad por fila (RLS) ----------
alter table public.negocios enable row level security;
alter table public.canchas  enable row level security;
alter table public.reservas enable row level security;

revoke all on public.negocios, public.canchas, public.reservas from anon;
-- Permisos explícitos para el dueño con sesión (no depender de la opción "Grant API access to new tables automatically").
-- La seguridad real la ponen las políticas RLS de abajo.
grant select, insert, update, delete on public.negocios, public.canchas, public.reservas to authenticated;

create or replace function public.mi_negocio_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from public.negocios where owner_id = auth.uid() $$;

create policy negocios_dueno on public.negocios for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy canchas_dueno on public.canchas for all to authenticated
  using (negocio_id = public.mi_negocio_id()) with check (negocio_id = public.mi_negocio_id());
create policy reservas_dueno on public.reservas for all to authenticated
  using (negocio_id = public.mi_negocio_id()) with check (negocio_id = public.mi_negocio_id());

-- ---------- Vencimiento de reservas pendientes ----------
-- Se llama al inicio de cada función pública y cuando el dueño carga su panel.
-- (Opcional más adelante: programarla con pg_cron cada minuto.)
create or replace function public.expirar_pendientes() returns int
language sql security definer set search_path = public as
$$ with u as (
     update public.reservas set estado = 'vencida'
     where estado = 'pendiente' and vence_en <= now() returning 1)
   select count(*)::int from u $$;

-- ---------- Funciones públicas (el jugador, sin login) ----------
create or replace function public.public_negocio(p_slug text) returns json
language plpgsql security definer set search_path = public as $$
declare n public.negocios;
begin
  select * into n from public.negocios where slug = lower(p_slug);
  if not found then return null; end if;
  return json_build_object(
    'nombre', n.nombre, 'yape', n.yape, 'whatsapp', n.whatsapp, 'sena', n.sena,
    'minutosSena', n.minutos_sena, 'horaInicio', n.hora_inicio, 'horaFin', n.hora_fin,
    'canchas', coalesce((select json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'precioHora', c.precio_hora) order by c.created_at, c.nombre)
                         from public.canchas c where c.negocio_id = n.id), '[]'::json));
end $$;

-- Solo horarios ocupados (sin nombres ni teléfonos).
create or replace function public.public_ocupados(p_slug text, p_desde date, p_dias int default 7)
returns table (cancha_id uuid, fecha date, hora smallint, dur smallint)
language plpgsql security definer set search_path = public as $$
begin
  perform public.expirar_pendientes();
  return query
    select r.cancha_id, r.fecha, r.hora, r.dur
    from public.reservas r join public.negocios n on n.id = r.negocio_id
    where n.slug = lower(p_slug) and r.estado in ('pendiente','activa')
      and r.fecha >= p_desde and r.fecha < p_desde + least(greatest(p_dias, 1), 31);
end $$;

-- El jugador aparta un horario. Queda "pendiente" hasta que el dueño confirme la seña.
create or replace function public.public_reservar(
  p_slug text, p_cancha uuid, p_fecha date, p_hora int, p_dur int, p_nombre text, p_telefono text)
returns json language plpgsql security definer set search_path = public as $$
declare n public.negocios; r public.reservas; ahora_lima timestamp;
begin
  perform public.expirar_pendientes();
  select * into n from public.negocios where slug = lower(p_slug);
  if not found then raise exception 'negocio_no_existe'; end if;
  if not exists (select 1 from public.canchas where id = p_cancha and negocio_id = n.id) then
    raise exception 'datos_invalidos'; end if;
  if p_nombre is null or char_length(btrim(p_nombre)) < 2 or char_length(p_nombre) > 80
     or p_telefono is null or p_telefono !~ '^9[0-9]{8}$' or p_dur not between 1 and 2 then
    raise exception 'datos_invalidos'; end if;
  if p_hora < n.hora_inicio or p_hora + p_dur > n.hora_fin then raise exception 'horario_invalido'; end if;
  ahora_lima := now() at time zone 'America/Lima';
  if p_fecha::timestamp + p_hora * interval '1 hour' <= ahora_lima then raise exception 'pasado'; end if;
  if p_fecha > (ahora_lima::date + 31) then raise exception 'horario_invalido'; end if;
  if (select count(*) from public.reservas where negocio_id = n.id and telefono = p_telefono and estado = 'pendiente') >= 2 then
    raise exception 'limite_pendientes'; end if;
  begin
    insert into public.reservas (negocio_id, cancha_id, fecha, hora, dur, nombre, telefono, sena, estado, origen, vence_en)
    values (n.id, p_cancha, p_fecha, p_hora, p_dur, btrim(p_nombre), p_telefono, n.sena, 'pendiente', 'enlace',
            now() + n.minutos_sena * interval '1 minute')
    returning * into r;
  exception when exclusion_violation then
    raise exception 'ocupado';
  end;
  return json_build_object('id', r.id, 'codigo', upper(right(r.id::text, 4)), 'venceEn', r.vence_en);
end $$;

-- El jugador consulta su reserva. El id (uuid) funciona como llave: solo lo tiene quien reservó.
create or replace function public.public_estado_reserva(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r public.reservas;
begin
  perform public.expirar_pendientes();
  select * into r from public.reservas where id = p_id;
  if not found then return null; end if;
  return json_build_object('id', r.id, 'estado', r.estado, 'venceEn', r.vence_en, 'canchaId', r.cancha_id,
    'fecha', r.fecha, 'hora', r.hora, 'dur', r.dur, 'sena', r.sena, 'nombre', r.nombre,
    'codigo', upper(right(r.id::text, 4)));
end $$;

-- ---------- Permisos de las funciones ----------
revoke execute on function public.public_negocio(text), public.public_ocupados(text, date, int),
  public.public_reservar(text, uuid, date, int, int, text, text), public.public_estado_reserva(uuid),
  public.expirar_pendientes() from public;
grant execute on function public.public_negocio(text), public.public_ocupados(text, date, int),
  public.public_reservar(text, uuid, date, int, int, text, text), public.public_estado_reserva(uuid),
  public.expirar_pendientes() to anon, authenticated;
