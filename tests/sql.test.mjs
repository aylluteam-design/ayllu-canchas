import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'fs';
const db = new PGlite({ extensions: { btree_gist } });
const out = []; const ok = (n, c, d = '') => out.push([n, !!c, d]);
await db.exec(`
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 create role anon nologin; create role authenticated nologin;
 grant usage on schema public, auth to anon, authenticated;
 alter default privileges in schema public grant all on tables to anon, authenticated;
 alter default privileges in schema public grant all on functions to anon, authenticated;`);
await db.exec(readFileSync(new URL('../supabase/migrations/001_canchas.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/002_deporte_extras.sql', import.meta.url), 'utf8'));
ok('Migraciones 001 + 002 corren completas', true);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${A}'),('${B}')`);
const as = async (rol, uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); set role ${rol}`); };
const intentar = async (sql, params) => { try { const r = await db.query(sql, params); return { r }; } catch (e) { return { e: e.message, code: e.code }; } };

// Dueño A crea su negocio y canchas; B el suyo
await as('authenticated', A);
await db.query(`insert into negocios(owner_id,slug,nombre,yape,whatsapp) values ($1,'los-olivos','Los Olivos','987654321','987654321')`, [A]);
const nA = (await db.query(`select id from negocios`)).rows[0].id;
await db.query(`insert into canchas(negocio_id,nombre,precio_hora) values ($1,'Cancha 1',70),($1,'Cancha 2',80)`, [nA]);
await as('authenticated', B);
await db.query(`insert into negocios(owner_id,slug,nombre) values ($1,'la-bombonera','La Bombonera')`, [B]);
const nB = (await db.query(`select id from negocios`)).rows[0].id;
await db.query(`insert into canchas(negocio_id,nombre) values ($1,'Cancha B1')`, [nB]);
ok('B solo ve su negocio (RLS)', (await db.query(`select id from negocios`)).rows.length === 1);
ok('B no ve canchas de A', (await db.query(`select nombre from canchas`)).rows.every(r => r.nombre === 'Cancha B1'));
const dup = await intentar(`insert into negocios(owner_id,slug,nombre) values ($1,'otro','Otro')`, [B]);
ok('Un dueño no puede crear 2º negocio (V1)', dup.e);
const robo = await intentar(`insert into negocios(owner_id,slug,nombre) values ($1,'robo','Robo')`, [A]);
ok('No se puede crear negocio a nombre de otro', robo.e);

// Anónimo: sin acceso a tablas
await as('anon');
const t = await intentar(`select * from reservas`); ok('Anónimo NO lee reservas', t.e && /permission denied/.test(t.e), t.e);
const t2 = await intentar(`select * from negocios`); ok('Anónimo NO lee negocios', t2.e && /permission denied/.test(t2.e));
const neg = (await db.query(`select public_negocio('los-olivos') j`)).rows[0].j;
ok('public_negocio devuelve datos públicos y canchas', neg.nombre === 'Los Olivos' && neg.canchas.length === 2 && !('owner_id' in neg));
ok('public_negocio de slug inexistente = null', (await db.query(`select public_negocio('nada') j`)).rows[0].j === null);
const c1 = neg.canchas[0].id, c2 = neg.canchas[1].id;

const man = new Date(Date.now() - 5 * 3600e3 + 86400e3).toISOString().slice(0, 10);
const reservar = (cancha, fecha, hora, dur, nom, tel) => intentar(`select public_reservar('los-olivos',$1,$2,$3,$4,$5,$6) j`, [cancha, fecha, hora, dur, nom, tel]);
const r1 = await reservar(c1, man, 20, 2, 'Luis Jugador', '999111222');
ok('Jugador aparta 20:00–22:00', r1.r && r1.r.rows[0].j.codigo.length === 4, JSON.stringify(r1.r?.rows[0].j));
const r2 = await reservar(c1, man, 21, 1, 'Otro', '988777666'); ok('Choque (21:00 dentro de 20–22) rechazado: ocupado', r2.e === 'ocupado', r2.e);
const r3 = await reservar(c1, man, 19, 2, 'Otro', '988777666'); ok('Choque parcial (19–21) rechazado', r3.e === 'ocupado', r3.e);
const r4 = await reservar(c1, man, 22, 1, 'Otro', '988777666'); ok('Horario contiguo (22:00) sí se puede', !r4.e, r4.e);
const r5 = await reservar(c2, man, 20, 1, 'Otro', '977666555'); ok('Otra cancha, misma hora: sí', !r5.e, r5.e);
const lim = await reservar(c2, man, 18, 1, 'Luis Jugador', '999111222'); // 2º pendiente de Luis
const lim3 = await reservar(c2, man, 17, 1, 'Luis Jugador', '999111222');
ok('Límite: 3ª pendiente del mismo celular rechazada', !lim.e && lim3.e === 'limite_pendientes', lim3.e);
ok('Celular inválido', (await reservar(c2, man, 16, 1, 'Ana', '12345')).e === 'datos_invalidos');
ok('Nombre vacío', (await reservar(c2, man, 16, 1, ' ', '955444333')).e === 'datos_invalidos');
ok('Hora fuera de horario (15:00)', (await reservar(c2, man, 15, 1, 'Ana', '955444333')).e === 'horario_invalido');
ok('Pasa de medianoche (23:00 x2)', (await reservar(c2, man, 23, 2, 'Ana', '955444333')).e === 'horario_invalido');
ok('Fecha pasada', (await reservar(c2, '2020-01-01', 18, 1, 'Ana', '955444333')).e === 'pasado');
ok('Cancha de otro negocio', (await reservar('00000000-0000-0000-0000-000000000000', man, 18, 1, 'Ana', '955444333')).e === 'datos_invalidos');
const oc = (await db.query(`select * from public_ocupados('los-olivos', $1::date, 7)`, [man])).rows;
ok('public_ocupados: solo cancha/fecha/hora/dur, sin nombres', oc.length >= 3 && Object.keys(oc[0]).join() === 'cancha_id,fecha,hora,dur', Object.keys(oc[0]).join());
const est = (await db.query(`select public_estado_reserva($1) j`, [r1.r.rows[0].j.id])).rows[0].j;
ok('public_estado_reserva por id', est.estado === 'pendiente' && est.hora === 20);
ok('Anónimo no puede escribir directo', (await intentar(`update reservas set estado='activa'`)).e);

// Dueño: ve, choque manual, confirma
await as('authenticated', A);
const rv = (await db.query(`select * from reservas order by inicio`)).rows;
ok('Dueño A ve todas sus reservas', rv.length >= 4);
const manual = await intentar(`insert into reservas(negocio_id,cancha_id,fecha,hora,dur,nombre,estado,origen) values ($1,$2,$3,21,1,'Manual','activa','dueno')`, [nA, c1, man]);
ok('Reserva manual del dueño también choca (23P01)', manual.code === '23P01', manual.code);
const okm = await intentar(`insert into reservas(negocio_id,cancha_id,fecha,hora,dur,nombre,estado,origen) values ($1,$2,$3,16,1,'Manual','activa','dueno')`, [nA, c1, man]);
ok('Reserva manual en hueco libre: ok', !okm.e, okm.e);
const rid = r1.r.rows[0].j.id;
await db.query(`update reservas set estado='activa', sena_pagada=true, vence_en=null where id=$1`, [rid]);
ok('Dueño confirma la seña', (await db.query(`select estado from reservas where id=$1`, [rid])).rows[0].estado === 'activa');
// B intenta tocar lo de A
await as('authenticated', B);
const upd = await db.query(`update reservas set estado='cancelada' where id=$1`, [rid]); ok('B no puede cancelar reservas de A', upd.affectedRows === 0);
const ins = await intentar(`insert into reservas(negocio_id,cancha_id,fecha,hora,dur,nombre,estado,origen) values ($1,$2,$3,18,1,'Intruso','activa','dueno')`, [nB, c1, man]);
ok('B no puede reservar en cancha de A (FK compuesta/RLS)', ins.e);
const ins2 = await intentar(`insert into reservas(negocio_id,cancha_id,fecha,hora,dur,nombre,estado,origen) values ($1,$2,$3,18,1,'Intruso','activa','dueno')`, [nA, c1, man]);
ok('B no puede insertar con negocio_id de A (RLS)', ins2.e);

// Vencimiento
await as('authenticated', A);
const pend = (await db.query(`select id from reservas where estado='pendiente' limit 1`)).rows[0].id;
await db.query(`update reservas set vence_en = now() - interval '1 minute' where id=$1`, [pend]);
await as('anon');
const n = (await db.query(`select expirar_pendientes() n`)).rows[0].n;
ok('Pendiente vencida pasa a "vencida"', n >= 1);
await as('authenticated', A);
ok('Estado quedó vencida', (await db.query(`select estado from reservas where id=$1`, [pend])).rows[0].estado === 'vencida');
const info = (await db.query(`select cancha_id, fecha, hora, dur from reservas where id=$1`, [pend])).rows[0];
await as('anon');
const re = await reservar(info.cancha_id, info.fecha.toISOString ? info.fecha.toISOString().slice(0, 10) : info.fecha, info.hora, info.dur, 'Nuevo Jugador', '944333222');
ok('El horario vencido se puede volver a reservar', !re.e, re.e);
// Cancelada libera
await as('authenticated', A);
await db.query(`update reservas set estado='cancelada' where id=$1`, [rid]);
await as('anon');
const re2 = await reservar(c1, man, 20, 2, 'Despues Cancelada', '933222111'); ok('Cancelada libera el horario', !re2.e, re2.e);
await as('authenticated', A);
const bad = await intentar(`insert into reservas(negocio_id,cancha_id,fecha,hora,dur,nombre,estado,origen) values ($1,$2,$3,17,1,'SinVence','pendiente','dueno')`, [nA, c2, man]);
ok('Pendiente sin vencimiento es inválida (check)', bad.e);

// ---- Migración 002: deporte, foto y agregados ----
await as('authenticated', A);
await db.query(`insert into extras(negocio_id,nombre,precio,tipo) values ($1,'Chalecos',0,'servicio'),($1,'Caja de cervezas',90,'producto')`, [nA]);
await as('authenticated', B);
await db.query(`insert into extras(negocio_id,nombre,precio) values ($1,'Balón B',10)`, [nB]);
ok('B solo ve sus agregados (RLS)', (await db.query(`select nombre from extras`)).rows.length === 1);
const robo2 = await intentar(`insert into extras(negocio_id,nombre,precio) values ($1,'Intruso',1)`, [nA]);
ok('B no puede crear agregados en el negocio de A', robo2.e);
await as('anon');
ok('Anónimo NO lee la tabla extras', (await intentar(`select * from extras`)).e);
const neg2 = (await db.query(`select public_negocio('los-olivos') j`)).rows[0].j;
ok('public_negocio incluye agregados y deporte de cada cancha', neg2.extras.length === 2 && neg2.canchas[0].deporte === 'futbol' && neg2.canchas[0].fotoUrl === null);
const ex = neg2.extras, chal = ex.find(e => e.nombre === 'Chalecos'), cerv = ex.find(e => e.nombre === 'Caja de cervezas');
const man3 = new Date(Date.now() - 5 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
const resX = (hora, extras) => intentar(`select public_reservar('los-olivos',$1,$2,$3,1,'Con Extras','966555444',$4::jsonb) j`, [c2, man3, hora, JSON.stringify(extras)]);
const rx = await resX(16, [{ id: chal.id, cant: 1 }, { id: cerv.id, cant: 2 }]);
ok('Reserva con agregados', rx.r, rx.e);
const estX = (await db.query(`select public_estado_reserva($1) j`, [rx.r.rows[0].j.id])).rows[0].j;
ok('Chalecos quedan como servicio sin costo', estX.extras.find(e => e.nombre === 'Chalecos').tipo === 'servicio' && estX.extras.find(e => e.nombre === 'Chalecos').precio == 0);
ok('Estado devuelve agregados con precio de la base (foto fija)', estX.extras.length === 2 && estX.extras.find(e => e.nombre === 'Caja de cervezas').precio == 90 && estX.extras.find(e => e.nombre === 'Caja de cervezas').cant === 2, JSON.stringify(estX.extras));
ok('Agregado de otro negocio rechazado', (await resX(17, [{ id: (await (async () => { await as('authenticated', B); const id = (await db.query(`select id from extras`)).rows[0].id; await as('anon'); return id; })()), cant: 1 }])).e === 'datos_invalidos');
ok('Agregado inexistente rechazado', (await resX(17, [{ id: '00000000-0000-0000-0000-000000000000', cant: 1 }])).e === 'datos_invalidos');
ok('Cantidad 0 rechazada', (await resX(17, [{ id: chal.id, cant: 0 }])).e === 'datos_invalidos');
ok('Cantidad 11 rechazada', (await resX(17, [{ id: chal.id, cant: 11 }])).e === 'datos_invalidos');
ok('Id mal formado rechazado', (await resX(17, [{ id: 'xyz', cant: 1 }])).e === 'datos_invalidos');
ok('Sin agregados sigue funcionando', !(await resX(18, [])).e);
await as('authenticated', A);
const cx = await db.query(`select extras from reservas where nombre='Con Extras' and hora=16`);
ok('Dueño ve los agregados pedidos en su reserva', cx.rows[0].extras.length === 2);
const dep = await intentar(`update canchas set deporte='tenis' where id=$1`, [c1]);
ok('Un servicio incluido no puede tener precio (check)', (await intentar(`insert into extras(negocio_id,nombre,precio,tipo) values ($1,'Proyector',20,'servicio')`, [nA])).e);
ok('Deporte inválido rechazado (check)', dep.e);
ok('Deporte válido (básquet) aceptado', !(await intentar(`update canchas set deporte='basquet' where id=$1`, [c1])).e);
ok('Foto con http (no https) rechazada', (await intentar(`update canchas set foto_url='http://x.com/a.jpg' where id=$1`, [c1])).e);

const fallos = out.filter(o => !o[1]);
for (const [n, c, d] of out) console.log(c ? 'OK   ' : 'FALLA', n, d ? '| ' + d : '');
console.log(`${out.length - fallos.length}/${out.length} OK`);
