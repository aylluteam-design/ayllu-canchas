// MODO DEMO: misma interfaz que supabase.js pero con datos en el navegador (localStorage).
// Sirve para mostrar la app sin base de datos. No es seguro ni compartido: es solo una demostración.
import { uid, iso, addDias, hoyD, inicioMs, codigo } from '../util.js';

const KEY = 'ayllu-canchas-demo-v4';
const SLUG = 'demo';
let mem = null;

function demoInicial() {
  const c1 = uid(), c2 = uid(), h = iso(hoyD()), m = iso(addDias(hoyD(), 1)), p = iso(addDias(hoyD(), 2));
  const R = (canchaId, fecha, hora, dur, nombre, telefono, sena, pag, origen, estado = 'activa', venceMin = null) => ({
    id: uid(), canchaId, fecha, hora, dur, nombre, telefono, sena, senaPagada: pag, estado, origen,
    venceEn: venceMin ? new Date(Date.now() + venceMin * 60000).toISOString() : null, recordatorioEnviado: false, creada: new Date().toISOString(), extras: []
  });
  return {
    negocio: { id: 'demo', slug: SLUG, nombre: 'Complejo Los Olivos (demo)', yape: '987 654 321', whatsapp: '987654321', sena: 20, minutosSena: 30, horaInicio: 16, horaFin: 24 },
    canchas: [{ id: c1, nombre: 'Cancha 1', precioHora: 70, deporte: 'futbol', fotoUrl: null }, { id: c2, nombre: 'Cancha 2', precioHora: 80, deporte: 'futbol', fotoUrl: null }],
    extras: [{ id: uid(), nombre: 'Juego de chalecos', precio: 15 }, { id: uid(), nombre: 'Balón', precio: 10 }, { id: uid(), nombre: 'Caja de cervezas', precio: 90 }],
    reservas: [
      R(c1, h, 19, 1, 'Carlos Ríos', '911222333', 20, true, 'enlace'),
      R(c1, m, 20, 2, 'Los Halcones FC', '922333444', 30, true, 'dueno'),
      R(c2, m, 19, 1, 'Pedro Vásquez', '933444555', 20, false, 'dueno'),
      R(c2, m, 21, 1, 'Academia Sporting Norte', '944555666', 20, true, 'enlace'),
      R(c1, p, 18, 1, 'Jorge Quispe', '955666777', 20, false, 'enlace', 'pendiente', 22),
      R(c2, h, 22, 1, 'Marcos Huamán', '966777888', 20, false, 'enlace', 'pendiente', 9)
    ]
  };
}
function leer() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return mem ? JSON.parse(JSON.stringify(mem)) : null;
}
let db = leer() || demoInicial();
function guardar() { mem = JSON.parse(JSON.stringify(db)); try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
guardar();

function expirar() {
  let cambio = false;
  db.reservas.forEach(r => { if (r.estado === 'pendiente' && r.venceEn && new Date(r.venceEn).getTime() <= Date.now()) { r.estado = 'vencida'; cambio = true; } });
  if (cambio) guardar();
}
const ocupan = () => db.reservas.filter(r => r.estado === 'activa' || r.estado === 'pendiente');
const choque = (canchaId, fecha, hora, dur) => ocupan().find(r => r.canchaId === canchaId && r.fecha === fecha && hora < r.hora + r.dur && r.hora < hora + dur);
const copia = x => JSON.parse(JSON.stringify(x));

// Las pestañas (dueño y jugador) comparten localStorage: antes de cada operación se relee,
// así lo que hace una pestaña se ve en la otra (como pasaría con una base de datos real).
function conSync(api) {
  for (const k of Object.keys(api)) {
    if (typeof api[k] !== 'function') continue;
    const f = api[k];
    api[k] = (...a) => { if (k !== 'reiniciarDemo') { const x = leer(); if (x) db = x; } return f(...a); };
  }
  return api;
}

export function crearLocal() {
  let logueado = false;
  return conSync({
    modo: 'demo',
    // --- cuenta del dueño (en demo, entrar es un clic) ---
    async sesion() { return logueado ? { email: 'demo@ayllu.pe' } : null; },
    async entrar() { logueado = true; return {}; },
    async registrar() { logueado = true; return {}; },
    async salir() { logueado = false; },
    // --- panel del dueño ---
    async cargarDueno() { expirar(); return copia({ negocio: db.negocio, canchas: db.canchas, extras: db.extras, reservas: db.reservas }); },
    async crearNegocio() { return {}; },
    async guardarNegocio(p) { Object.assign(db.negocio, p); guardar(); return {}; },
    async guardarCancha(c) {
      if (c.id) { const x = db.canchas.find(y => y.id === c.id); if (x) Object.assign(x, c); }
      else db.canchas.push({ id: uid(), nombre: c.nombre, precioHora: c.precioHora, deporte: c.deporte || 'futbol', fotoUrl: null });
      guardar(); return {};
    },
    async quitarCancha(id) {
      if (db.reservas.some(r => r.canchaId === id)) return { error: 'Esa cancha tiene reservas; no se puede quitar.' };
      db.canchas = db.canchas.filter(c => c.id !== id); guardar(); return {};
    },
    async guardarExtra(e) {
      if (e.id) { const x = db.extras.find(y => y.id === e.id); if (x) Object.assign(x, { nombre: e.nombre, precio: e.precio }); }
      else db.extras.push({ id: uid(), nombre: e.nombre, precio: e.precio });
      guardar(); return {};
    },
    async quitarExtra(id) { db.extras = db.extras.filter(x => x.id !== id); guardar(); return {}; },
    async crearReservaDueno(d) {
      expirar();
      if (choque(d.canchaId, d.fecha, d.hora, d.dur)) { const c = choque(d.canchaId, d.fecha, d.hora, d.dur); return { error: `Choque: ${c.nombre} ya tiene esa cancha de ${c.hora}:00 a ${c.hora + c.dur}:00.` }; }
      const r = { id: uid(), canchaId: d.canchaId, fecha: d.fecha, hora: d.hora, dur: d.dur, nombre: d.nombre.trim(), telefono: d.telefono || '',
        sena: d.sena, senaPagada: !!d.senaPagada, estado: 'activa', origen: 'dueno', venceEn: null, recordatorioEnviado: false, creada: new Date().toISOString(), extras: [] };
      db.reservas.push(r); guardar(); return { reserva: copia(r) };
    },
    async actualizarReserva(id, patch) { const r = db.reservas.find(x => x.id === id); if (r) { Object.assign(r, patch); guardar(); } return {}; },
    // --- jugador (público) ---
    async publico() { return copia({ ...db.negocio, canchas: db.canchas, extras: db.extras }); },
    async ocupados(slug, desde, dias) {
      expirar();
      const hasta = iso(addDias(new Date(desde + 'T00:00:00'), dias));
      return ocupan().filter(r => r.fecha >= desde && r.fecha < hasta).map(r => ({ canchaId: r.canchaId, fecha: r.fecha, hora: r.hora, dur: r.dur }));
    },
    async reservar(slug, d) {
      expirar();
      if (inicioMs(d.fecha, d.hora) <= Date.now()) return { error: 'pasado' };
      if (db.reservas.filter(r => r.estado === 'pendiente' && r.telefono === d.telefono).length >= 2) return { error: 'limite_pendientes' };
      if (choque(d.canchaId, d.fecha, d.hora, d.dur)) return { error: 'ocupado' };
      const pedidos = d.extras || [], lista = [];
      for (const x of pedidos) {   // el precio y el nombre salen del catálogo del dueño, no del jugador
        const e = db.extras.find(y => y.id === x.id);
        if (!e || !(x.cant >= 1 && x.cant <= 10)) return { error: 'datos_invalidos' };
        lista.push({ nombre: e.nombre, precio: e.precio, cant: x.cant });
      }
      const r = { id: uid(), canchaId: d.canchaId, fecha: d.fecha, hora: d.hora, dur: d.dur, nombre: d.nombre.trim(), telefono: d.telefono,
        sena: db.negocio.sena, senaPagada: false, estado: 'pendiente', origen: 'enlace',
        venceEn: new Date(Date.now() + db.negocio.minutosSena * 60000).toISOString(), recordatorioEnviado: false, creada: new Date().toISOString(), extras: lista };
      db.reservas.push(r); guardar();
      return { reserva: { id: r.id, codigo: codigo(r.id), venceEn: r.venceEn } };
    },
    async estado(id) {
      expirar(); const r = db.reservas.find(x => x.id === id); if (!r) return null;
      return { id: r.id, estado: r.estado, venceEn: r.venceEn, canchaId: r.canchaId, fecha: r.fecha, hora: r.hora, dur: r.dur, sena: r.sena, nombre: r.nombre, extras: r.extras || [], codigo: codigo(r.id) };
    },
    async reiniciarDemo() { db = demoInicial(); guardar(); }
  });
}
