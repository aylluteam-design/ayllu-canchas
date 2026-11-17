// MODO REAL: misma interfaz que local.js pero con Supabase (Auth + Postgres + funciones públicas).
// Las reglas de verdad (no chocar horarios, quién ve qué, vencimientos) viven en la base de datos
// (supabase/migrations/001_canchas.sql); aquí solo se llama y se traduce.
import { createClient } from '@supabase/supabase-js';

const MENSAJES_AUTH = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Falta confirmar tu correo. Revisa tu bandeja de entrada.',
  'User already registered': 'Ese correo ya tiene cuenta. Usa "Entrar".'
};
const traducirAuth = e => MENSAJES_AUTH[e.message] || (/fetch|network/i.test(e.message) ? 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.' : null) || (/password/i.test(e.message) ? 'La contraseña debe tener al menos 6 caracteres.' : e.message);

const mapNegocio = n => ({ id: n.id, slug: n.slug, nombre: n.nombre, yape: n.yape, whatsapp: n.whatsapp, sena: Number(n.sena),
  minutosSena: n.minutos_sena, horaInicio: n.hora_inicio, horaFin: n.hora_fin });
const mapCancha = c => ({ id: c.id, nombre: c.nombre, precioHora: Number(c.precio_hora), deporte: c.deporte, fotoUrl: c.foto_url });
const mapExtra = e => ({ id: e.id, nombre: e.nombre, precio: Number(e.precio), tipo: e.tipo });
const mapReserva = r => ({ id: r.id, canchaId: r.cancha_id, fecha: r.fecha, hora: r.hora, dur: r.dur, nombre: r.nombre, telefono: r.telefono,
  sena: Number(r.sena), senaPagada: r.sena_pagada, estado: r.estado, origen: r.origen, venceEn: r.vence_en,
  recordatorioEnviado: r.recordatorio_enviado, creada: r.created_at, extras: r.extras || [] });
const NEG_COLS = { nombre: 'nombre', yape: 'yape', whatsapp: 'whatsapp', sena: 'sena', minutosSena: 'minutos_sena', horaInicio: 'hora_inicio', horaFin: 'hora_fin' };
const RES_COLS = { estado: 'estado', senaPagada: 'sena_pagada', venceEn: 'vence_en', recordatorioEnviado: 'recordatorio_enviado' };
const aColumnas = (patch, mapa) => Object.fromEntries(Object.entries(patch).filter(([k]) => mapa[k]).map(([k, v]) => [mapa[k], v]));

// Errores de las funciones públicas → texto para el jugador (se traducen en la interfaz).
const codigoError = e => {
  const m = (e && e.message) || '';
  for (const k of ['ocupado', 'limite_pendientes', 'horario_invalido', 'datos_invalidos', 'pasado', 'negocio_no_existe']) if (m.includes(k)) return k;
  return 'desconocido';
};

export function crearSupabase(url, key) {
  const sb = createClient(url, key);
  const hoy = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
  const hace = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  return {
    modo: 'supabase',
    // --- cuenta del dueño ---
    async sesion() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email } : null; },
    async entrar(email, pw) { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); return error ? { error: traducirAuth(error) } : {}; },
    async registrar(email, pw) {
      const { data, error } = await sb.auth.signUp({ email, password: pw });
      if (error) return { error: traducirAuth(error) };
      return data.session ? {} : { aviso: 'Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego entra aquí.' };
    },
    async salir() { await sb.auth.signOut(); },
    // --- panel del dueño (RLS: solo ve lo suyo) ---
    async cargarDueno() {
      await sb.rpc('expirar_pendientes');
      const { data: n, error } = await sb.from('negocios').select('*').maybeSingle();
      if (error) throw error;
      if (!n) return { negocio: null, canchas: [], extras: [], reservas: [] };
      const [c, r, x] = await Promise.all([
        sb.from('canchas').select('*').eq('negocio_id', n.id).order('created_at').order('nombre'),
        sb.from('reservas').select('*').eq('negocio_id', n.id).gte('fecha', hace(30)).order('inicio'),
        sb.from('extras').select('*').eq('negocio_id', n.id).order('created_at').order('nombre')
      ]);
      if (c.error) throw c.error; if (r.error) throw r.error; if (x.error) throw x.error;
      return { negocio: mapNegocio(n), canchas: c.data.map(mapCancha), extras: x.data.map(mapExtra), reservas: r.data.map(mapReserva) };
    },
    async crearNegocio({ nombre, slug }) {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return { error: 'Tu sesión venció. Entra de nuevo.' };
      const { data: n, error } = await sb.from('negocios').insert({ owner_id: u.user.id, nombre, slug }).select().single();
      if (error) return { error: error.code === '23505' ? 'Ese enlace ya está en uso. Prueba con otro nombre.' : error.message };
      const { error: e2 } = await sb.from('canchas').insert([{ negocio_id: n.id, nombre: 'Cancha 1', precio_hora: 70 }, { negocio_id: n.id, nombre: 'Cancha 2', precio_hora: 80 }]);
      if (e2) return { error: e2.message };
      // Agregados de ejemplo (el dueño los edita o quita en Ajustes)
      await sb.from('extras').insert([{ negocio_id: n.id, nombre: 'Chalecos', precio: 0, tipo: 'servicio' }, { negocio_id: n.id, nombre: 'Agua', precio: 3, tipo: 'producto' }, { negocio_id: n.id, nombre: 'Gaseosa', precio: 5, tipo: 'producto' }, { negocio_id: n.id, nombre: 'Caja de cervezas', precio: 90, tipo: 'producto' }]);
      return {};
    },
    async guardarNegocio(patch) {
      const { data: n } = await sb.from('negocios').select('id').maybeSingle();
      const { error } = await sb.from('negocios').update(aColumnas(patch, NEG_COLS)).eq('id', n.id);
      return error ? { error: error.message } : {};
    },
    async guardarCancha(c) {
      if (c.id) { const { error } = await sb.from('canchas').update({ nombre: c.nombre, precio_hora: c.precioHora, deporte: c.deporte || 'futbol' }).eq('id', c.id); return error ? { error: error.message } : {}; }
      const { data: n } = await sb.from('negocios').select('id').maybeSingle();
      const { error } = await sb.from('canchas').insert({ negocio_id: n.id, nombre: c.nombre, precio_hora: c.precioHora, deporte: c.deporte || 'futbol' });
      return error ? { error: error.message } : {};
    },
    async guardarExtra(e) {
      const tipo = e.tipo === 'servicio' ? 'servicio' : 'producto', precio = tipo === 'servicio' ? 0 : e.precio;   // un servicio incluido no tiene costo
      if (e.id) { const { error } = await sb.from('extras').update({ nombre: e.nombre, precio }).eq('id', e.id); return error ? { error: error.message } : {}; }
      const { data: n } = await sb.from('negocios').select('id').maybeSingle();
      const { error } = await sb.from('extras').insert({ negocio_id: n.id, nombre: e.nombre, precio, tipo });
      return error ? { error: error.message } : {};
    },
    async quitarExtra(id) { const { error } = await sb.from('extras').delete().eq('id', id); return error ? { error: error.message } : {}; },
    async quitarCancha(id) {
      const { error } = await sb.from('canchas').delete().eq('id', id);
      if (error) return { error: error.code === '23503' ? 'Esa cancha tiene reservas; no se puede quitar.' : error.message };
      return {};
    },
    async crearReservaDueno(d) {
      const { data: n } = await sb.from('negocios').select('id').maybeSingle();
      const { data, error } = await sb.from('reservas').insert({ negocio_id: n.id, cancha_id: d.canchaId, fecha: d.fecha, hora: d.hora, dur: d.dur,
        nombre: d.nombre.trim(), telefono: d.telefono || '', sena: d.sena, sena_pagada: !!d.senaPagada, estado: 'activa', origen: 'dueno' }).select().single();
      if (error) {
        if (error.code === '23P01') return { error: 'Choque: ya hay una reserva en ese horario.' };
        if (error.code === '23514') return { error: 'Revisa los datos: nombre de 2+ letras y celular de 9 dígitos (empieza con 9).' };
        return { error: error.message };
      }
      return { reserva: mapReserva(data) };
    },
    async actualizarReserva(id, patch) {
      const { error } = await sb.from('reservas').update(aColumnas(patch, RES_COLS)).eq('id', id);
      return error ? { error: error.message } : {};
    },
    // --- jugador (sin login; solo funciones públicas) ---
    async publico(slug) {
      const { data, error } = await sb.rpc('public_negocio', { p_slug: slug });
      if (error) throw error;          // error de red o del servidor: la interfaz muestra "reintentar"
      return data || null;             // null = el enlace no existe
    },
    async ocupados(slug, desde, dias) {
      const { data, error } = await sb.rpc('public_ocupados', { p_slug: slug, p_desde: desde, p_dias: dias });
      if (error) throw error;
      return data.map(r => ({ canchaId: r.cancha_id, fecha: r.fecha, hora: r.hora, dur: r.dur }));
    },
    async reservar(slug, d) {
      const { data, error } = await sb.rpc('public_reservar', { p_slug: slug, p_cancha: d.canchaId, p_fecha: d.fecha, p_hora: d.hora, p_dur: d.dur, p_nombre: d.nombre, p_telefono: d.telefono, p_extras: d.extras || [] });
      if (error) return { error: codigoError(error) };
      return { reserva: data };
    },
    async estado(id) {
      const { data, error } = await sb.rpc('public_estado_reserva', { p_id: id });
      return error ? null : data;
    },
    _hoy: hoy
  };
}
