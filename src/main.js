import './style.css';
import { api } from './data/index.js';
import {
  DIAS_CORTO, MESES, $, esc, pad, iso, fromIso, addDias, hoyD, lunesDe, horaTxt, soles, fechaCorta, fechaMsg,
  inicioMs, cuenta, codigo, normTel, waLink, slugify, copiarTexto
} from './util.js';

/* ====================== ESTADO ====================== */
const MSG_DEFECTO = '¡Hola! 👋 Reserva tu cancha en {negocio} aquí: {enlace}\nElige tu horario y regístrate con tu nombre y celular. Tu horario queda apartado y lo confirmas pagando la seña de {sena} por Yape.';
const KEY_MSG = 'ayllu-canchas-msg', KEY_J = 'ayllu-canchas-jugador', KEY_MIS = 'ayllu-canchas-mis-reservas';
const ls = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const ruta = (location.hash.match(/^#\/r\/([a-z0-9-]+)/) || [])[1] || null;   // /#/r/<slug> = vista del jugador
const esJugador = !!ruta;
if (esJugador) document.body.classList.add('jugador');

let A = null;                                    // sesión del dueño
let S = { negocio: null, canchas: [], extras: [], reservas: [] };   // datos del dueño
let cargando = true, errorCarga = '';
const ui = { tab: 'agenda', canchaId: null, lunes: lunesDe(hoyD()), fechaRec: iso(addDias(hoyD(), 1)), confirmarCancelar: false, authMsg: '', authAviso: '', slugEditado: false };
const j0 = ls.get(KEY_J, {});
const P = { slug: ruta, info: null, noExiste: false, ocupados: [], fecha: iso(hoyD()), canchaId: null, dur: 1, hora: null,
  nombre: j0.nombre || '', tel: j0.telefono || '', resId: null, res: null, mias: [], extras: {} };

const canchaPorId = id => S.canchas.find(c => c.id === id);
const canchaActual = () => canchaPorId(ui.canchaId) || S.canchas[0];
const ocupan = () => S.reservas.filter(r => r.estado === 'activa' || r.estado === 'pendiente');
const activas = () => S.reservas.filter(r => r.estado === 'activa');
const pendientes = () => S.reservas.filter(r => r.estado === 'pendiente');
const totalExtras = lista => (lista || []).reduce((a, x) => a + Number(x.precio) * x.cant, 0);
const total = r => (canchaPorId(r.canchaId)?.precioHora || 0) * r.dur + totalExtras(r.extras);
const DEPORTES = { futbol: 'Fútbol', loza: 'Loza multiuso', basquet: 'Básquet', voley: 'Vóley' };
const imgCancha = c => c?.fotoUrl || `img/${DEPORTES[c?.deporte] ? c.deporte : 'futbol'}.svg`;
const textoExtras = lista => (lista && lista.length) ? ` Agregados: ${lista.map(x => x.tipo === 'servicio' ? x.nombre : `${x.cant} ${x.nombre}`).join(', ')}.` : '';
const listaExtras = lista => lista.map(x => x.tipo === 'servicio' ? `${esc(x.nombre)} (incluido)` : `${x.cant} × ${esc(x.nombre)} (${soles(x.precio * x.cant)})`).join(' · ');
const hayCobro = lista => (lista || []).some(x => x.tipo !== 'servicio');
const HORAS = () => ({ inicio: S.negocio?.horaInicio ?? 16, fin: S.negocio?.horaFin ?? 24 });

function urlJugador() {
  const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.split('#')[0];
  return `${base}#/r/${S.negocio?.slug || ''}`;
}
function mensajeEnlace() {
  const guardado = ls.get(KEY_MSG, '');
  if (guardado) return guardado;
  const n = S.negocio;
  return MSG_DEFECTO.replace('{negocio}', n.nombre.replace(/ \(demo\)$/, '')).replace('{enlace}', urlJugador()).replace('{sena}', soles(n.sena));
}
const cod = codigo;
function textoSena(r) { return r.senaPagada ? 'Tu seña ya está registrada.' : (r.sena > 0 ? `Falta la seña de ${soles(r.sena)} para asegurar la cancha.` : ''); }
const textoRecordatorio = r => `Hola ${r.nombre}, te recordamos tu reserva en ${S.negocio.nombre} (${canchaPorId(r.canchaId)?.nombre}) ${fechaMsg(r.fecha)} a las ${horaTxt(r.hora)}. ${textoSena(r)} ¿Confirmas que vienes?${textoExtras(r.extras)} ⚽`.replace(/\s+/g, ' ').trim();
const textoConfirmacion = r => `Hola ${r.nombre}, tu reserva en ${S.negocio.nombre} quedó: ${canchaPorId(r.canchaId)?.nombre}, ${fechaMsg(r.fecha)} de ${horaTxt(r.hora)} a ${horaTxt(r.hora + r.dur)}. Total ${soles(total(r))}.${textoExtras(r.extras)} ${textoSena(r)} ⚽`.replace(/\s+/g, ' ').trim();
const textoPendiente = r => `Hola ${r.nombre}, vimos tu reserva de ${canchaPorId(r.canchaId)?.nombre} ${fechaMsg(r.fecha)} a las ${horaTxt(r.hora)}. Falta la seña de ${soles(r.sena)}${S.negocio.yape ? ` (Yape ${S.negocio.yape})` : ''} para asegurarla.${textoExtras(r.extras)} ⚽`;

/* ====================== CARGA ====================== */
let recargando = false;
async function recargar() {
  if (recargando) return; recargando = true;
  try {
    S = await api.cargarDueno(); errorCarga = '';
    if (S.negocio && !canchaPorId(ui.canchaId)) ui.canchaId = S.canchas[0]?.id || null;
  } catch (e) { errorCarga = 'No pude cargar tus datos. Revisa tu conexión e intenta de nuevo.'; console.error(e); }
  recargando = false; cargando = false; render();
}
async function cargarJugador() {
  try {
    P.info = await api.publico(P.slug);
    if (!P.info) P.noExiste = true;
    else {
      P.canchaId = P.info.canchas[0]?.id || null;
      await refrescarOcupados(true);
      const ids = ls.get(KEY_MIS, []).slice(-5);
      P.mias = (await Promise.all(ids.map(id => api.estado(id)))).filter(Boolean);
    }
  } catch (e) { errorCarga = 'No pudimos cargar los horarios. Revisa tu conexión.'; console.error(e); }
  cargando = false; render();
}
async function refrescarOcupados(estricto = false) {
  try { P.ocupados = await api.ocupados(P.slug, iso(hoyD()), 8); }
  catch (e) { if (estricto) throw e; }   // en el refresco automático, si falla la red se conserva lo último que se vio
}

/* ====================== ARMAZÓN ====================== */
function render() {
  const jug = esJugador, logueado = !jug && !!A && !!S.negocio;
  $('#tit').textContent = jug ? 'Reserva tu cancha' : 'Ayllu Canchas';
  const b = $('#badge'); b.hidden = api.modo !== 'demo'; b.textContent = 'DEMO';
  $('#neg').textContent = jug ? (P.info?.nombre || '') : (S.negocio?.nombre || '');
  $('#nav').hidden = !logueado; $('#salir').hidden = !logueado;
  const np = pendientes().length;
  document.querySelectorAll('nav button').forEach(x => {
    if (x.dataset.tab === ui.tab) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    if (x.dataset.tab === 'pend') x.textContent = np ? `Pendientes (${np})` : 'Pendientes';
  });
  let html;
  if (cargando) html = '<p class="vacio">Cargando…</p>';
  else if (errorCarga) html = `<p class="nota aviso">${esc(errorCarga)}</p><div class="acciones" style="justify-content:flex-start"><button class="btn" data-a="reintentar">Reintentar</button></div>`;
  else if (jug) html = vistaJugador();
  else if (!A) html = vistaLogin();
  else if (!S.negocio) html = vistaOnboarding();
  else html = ({ agenda: vistaAgenda, pend: vistaPend, manana: vistaRecordatorios, enlace: vistaEnlace, config: vistaConfig })[ui.tab]();
  $('#vista').innerHTML = html;
  tick();
}
const tick = () => document.querySelectorAll('[data-vence]').forEach(el => { el.textContent = cuenta(new Date(el.dataset.vence).getTime() - Date.now()); });

/* ====================== DUEÑO: ACCESO ====================== */
function vistaLogin() {
  if (api.modo === 'demo') return `
    <div class="card"><h2>Bienvenido a Ayllu Canchas</h2>
      <p class="sub">Estás en <b>modo demostración</b>: los datos viven solo en este navegador. Para usar la versión real, conecta Supabase (ver README).</p>
      <button class="btn grande" data-a="entrarDemo">Entrar a la demo del dueño</button>
      <p class="sub" style="margin:12px 0 0">¿Quieres ver lo que ve el jugador? <a href="#/r/demo" data-a="irJugador">Abrir la vista del jugador</a></p></div>`;
  return `
    <div class="card"><h2>Entra a tu panel</h2>
      <p class="sub">Para dueños de canchas. Los jugadores no necesitan cuenta: reservan desde tu enlace.</p>
      <label>Correo<input id="a-email" type="email" autocomplete="email" inputmode="email"></label>
      <label>Contraseña<input id="a-pw" type="password" autocomplete="current-password"></label>
      <p class="err" id="a-err" role="alert">${esc(ui.authMsg)}</p>
      ${ui.authAviso ? `<p class="nota">${esc(ui.authAviso)}</p>` : ''}
      <div class="acciones" style="justify-content:flex-start"><button class="btn" data-a="entrar">Entrar</button><button class="btn sec" data-a="registrar">Crear cuenta</button></div>
    </div>`;
}
function vistaOnboarding() {
  return `<div class="card"><h2>Crea tu complejo</h2>
    <p class="sub">Solo necesitas el nombre. Después ajustas canchas, precios y Yape en "Ajustes".</p>
    <label>Nombre del complejo<input id="o-nombre" placeholder="Ej.: Complejo Los Olivos" autocomplete="off"></label>
    <label>Tu enlace de reservas<input id="o-slug" placeholder="complejo-los-olivos" autocomplete="off"></label>
    <p class="sub" id="o-prev">Será: ${esc(location.origin !== 'null' ? location.origin + location.pathname : '')}#/r/<b>…</b></p>
    <p class="err" id="o-err" role="alert"></p>
    <button class="btn" data-a="crearNegocio">Crear mi complejo</button></div>`;
}

/* ====================== DUEÑO: VISTAS ====================== */
function vistaAgenda() {
  const lun = ui.lunes, dom = addDias(lun, 6), hoyIso = iso(hoyD()), H = HORAS(), c = canchaActual();
  if (!c) return '<p class="vacio">Agrega una cancha en Ajustes.</p>';
  const chips = S.canchas.map(x => `<button class="chip" data-a="cancha" data-id="${x.id}" aria-pressed="${x.id === c.id}">${esc(x.nombre)}</button>`).join('');
  const titulo = `${lun.getDate()} ${MESES[lun.getMonth()]} al ${dom.getDate()} ${MESES[dom.getMonth()]}`;
  let cab = '<th class="hora"></th>';
  for (let i = 0; i < 7; i++) { const d = addDias(lun, i); cab += `<th class="${iso(d) === hoyIso ? 'hoy' : ''}">${DIAS_CORTO[d.getDay()]} ${d.getDate()}</th>`; }
  let filas = '';
  for (let h = H.inicio; h < H.fin; h++) {
    let tds = `<th class="hora">${horaTxt(h)}</th>`;
    for (let i = 0; i < 7; i++) {
      const f = iso(addDias(lun, i)), cls = f === hoyIso ? 'hoy' : '';
      const r = ocupan().find(x => x.canchaId === c.id && x.fecha === f && h >= x.hora && h < x.hora + x.dur);
      if (!r) tds += `<td class="${cls}"><button class="libre" data-a="nueva" data-fecha="${f}" data-hora="${h}" aria-label="Reservar ${f} ${horaTxt(h)}">+</button></td>`;
      else if (r.hora === h) {
        const espera = r.estado === 'pendiente';
        const clase = espera ? 'espera' : (r.senaPagada ? 'pagada' : 'pend');
        const sub = espera ? `por pagar · <span class="contador" data-vence="${r.venceEn}"></span>` : (r.senaPagada ? 'seña ✓' : 'seña pendiente');
        tds += `<td class="${cls}" rowspan="${r.dur}"><button class="res ${clase}" data-a="ver" data-id="${r.id}"><b>${esc(r.nombre)}</b>${sub}</button></td>`;
      }
    }
    filas += `<tr>${tds}</tr>`;
  }
  const sem = ocupan().filter(r => r.canchaId === c.id && r.fecha >= iso(lun) && r.fecha <= iso(dom));
  const pend = sem.filter(r => !r.senaPagada).reduce((a, r) => a + r.sena, 0);
  return `
    <div class="chips">${chips}</div>
    <div class="barra">
      <div><button class="btn sec chico" data-a="sem" data-d="-7" aria-label="Semana anterior">‹</button>
      <span class="titulo">&nbsp;${esc(titulo)}&nbsp;</span>
      <button class="btn sec chico" data-a="sem" data-d="7" aria-label="Semana siguiente">›</button>
      <button class="btn sec chico" data-a="sem" data-d="0">Hoy</button></div>
      <div class="sub" style="margin:0"><span id="res-sem">${sem.length}</span> reservas · seña por cobrar ${soles(pend)}</div>
    </div>
    <div class="leyenda"><span><i style="background:var(--pagada)"></i>Seña pagada</span><span><i style="background:var(--pend)"></i>Seña pendiente</span><span><i style="background:var(--espera)"></i>Apartada desde el enlace (vence sola)</span><span>"+" = reserva por llamada o en persona</span></div>
    <div class="tabla-wrap"><table class="agenda"><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table></div>`;
}

function vistaPend() {
  const lista = pendientes().sort((a, b) => new Date(a.venceEn) - new Date(b.venceEn));
  const hace7 = Date.now() - 7 * 86400000;
  const liberadas = S.reservas.filter(r => r.estado === 'vencida' && new Date(r.creada).getTime() >= hace7).length;
  const items = lista.map(r => `<div class="item">
      <div class="hora">${horaTxt(r.hora)}</div>
      <div class="quien"><b>${esc(r.nombre)}</b> <span class="tag espera">vence en <span class="contador" data-vence="${r.venceEn}"></span></span>
        <small>${esc(canchaPorId(r.canchaId)?.nombre)} · ${esc(fechaCorta(r.fecha))} · ${r.dur} h · ${esc(r.telefono)} · seña ${soles(r.sena)}</small>${r.extras?.length ? `<small>Agregados: ${listaExtras(r.extras)}</small>` : ''}</div>
      <div class="acciones" style="margin:0"><button class="btn chico" data-a="confirmarSena" data-id="${r.id}">Recibí la seña</button><button class="btn sec chico" data-a="ver" data-id="${r.id}">Más…</button></div>
    </div>`).join('');
  return `
    <h2>Reservas por confirmar</h2>
    <p class="sub">Llegaron desde tu enlace. El horario queda apartado ${esc(S.negocio.minutosSena)} minutos. Cuando veas el Yape, toca "Recibí la seña". Si no paga, el horario se libera solo.</p>
    <p class="nota">Esta lista se actualiza sola cada 15 segundos. Aún no hay notificación push: está pendiente para la siguiente etapa.</p>
    <div class="card lista">${items || '<div class="vacio">No hay reservas esperando seña.</div>'}</div>
    <p class="sub">Liberadas por no pagar la seña (últimos 7 días): <b>${liberadas}</b></p>`;
}

function vistaRecordatorios() {
  const lista = activas().filter(r => r.fecha === ui.fechaRec).sort((a, b) => a.hora - b.hora);
  const env = lista.filter(r => r.recordatorioEnviado).length;
  const items = lista.map(r => `<div class="item">
      <div class="hora">${horaTxt(r.hora)}</div>
      <div class="quien"><b>${esc(r.nombre)}</b> <span class="tag ${r.senaPagada ? 'ok' : 'pend'}">${r.senaPagada ? 'seña ✓' : 'seña pendiente'}</span> ${r.recordatorioEnviado ? '<span class="tag env">recordatorio enviado</span>' : ''}
        <small>${esc(canchaPorId(r.canchaId)?.nombre)} · ${r.dur} h · ${r.telefono ? esc(r.telefono) : 'sin teléfono (elegirás el contacto)'}</small></div>
      <a class="btn chico" href="${waLink(r.telefono, textoRecordatorio(r))}" target="_blank" rel="noopener" data-a="enviado" data-id="${r.id}">Recordar por WhatsApp</a>
    </div>`).join('');
  return `
    <h2>Recordatorios del día</h2>
    <p class="sub">Un toque por jugador abre tu WhatsApp con el mensaje listo. Recordar 24 horas antes ayuda a reducir las faltas.</p>
    <div class="barra"><label style="margin:0">Fecha de las reservas<input type="date" id="fecha-rec" value="${ui.fechaRec}"></label>
      <div class="sub" style="margin:0">${env} de ${lista.length} recordatorios enviados</div></div>
    <div class="card lista">${items || '<div class="vacio">No hay reservas confirmadas para esa fecha.</div>'}</div>`;
}

function vistaEnlace() {
  const mes = iso(hoyD()).slice(0, 7);
  const delMes = ocupan().filter(r => r.fecha.slice(0, 7) === mes);
  const porEnlace = delMes.filter(r => r.origen === 'enlace').length;
  const pct = delMes.length ? Math.round(100 * porEnlace / delMes.length) : 0;
  const msg = mensajeEnlace();
  return `
    <h2>Tu enlace de reservas</h2>
    <p class="sub">Un solo enlace para todos tus jugadores. Ahí eligen horario y se registran con nombre y celular. Tú dejas de armar reservas por chat.</p>
    <div class="card">
      <label>Enlace<input id="enlace-url" readonly value="${esc(urlJugador())}"></label>
      <div class="acciones" style="justify-content:flex-start"><button class="btn chico" data-a="copiar" data-from="enlace-url">Copiar enlace</button>
        <a class="btn sec chico" href="${esc(urlJugador())}" target="_blank" rel="noopener">Probar como jugador</a></div>
    </div>
    <div class="card"><h3>Mensaje listo para enviar</h3>
      <p class="sub">Es lo que mandas cuando alguien te escribe pidiendo cancha. Puedes editarlo (se guarda en este celular).</p>
      <textarea id="enlace-msg" rows="5">${esc(msg)}</textarea>
      <div class="acciones" style="justify-content:flex-start;margin-top:8px"><button class="btn chico" data-a="copiar" data-from="enlace-msg">Copiar mensaje</button>
        <a class="btn sec chico" id="enlace-wsp" href="${waLink('', msg)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <button class="btn sec chico" data-a="resetMsg">Restablecer</button></div>
    </div>
    <div class="card"><h3>Dónde ponerlo, según tu WhatsApp</h3>
      <p class="sub">Los nombres de los menús cambian según la versión: confirma en tu celular.</p>
      <p><b>WhatsApp Business.</b> Pon el enlace en tu perfil de empresa (campo de sitio web), y guarda el mensaje en "Respuestas rápidas" con un atajo que empieza con "/". También puedes usarlo como mensaje de bienvenida o de ausencia.</p>
      <p><b>WhatsApp normal.</b> No tiene respuestas rápidas. Pon el enlace en tu "Info" (la frase del perfil) y en tus Estados, y crea un atajo de texto en el teclado del celular (por ejemplo "reservar") que escriba el mensaje completo. Prueba desde otro número si el enlace de "Info" se puede tocar: no siempre lo es.</p>
      <p style="margin:0"><b>En la cancha.</b> Un cartel con el enlace o un código QR (el QR aún no se genera en la app).</p>
    </div>
    <div class="card"><h3>Cuánto se usa el enlace este mes</h3>
      <div class="barra-uso" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <p style="margin:0"><b>${pct}%</b> de las reservas entró por el enlace (${porEnlace} de ${delMes.length}). El resto las armaste tú.</p>
      <p class="sub" style="margin:6px 0 0">Esta es la cifra que más importa en el piloto: si el dueño sigue aceptando reservas por chat, vuelven los cruces de horario. Una meta de partida podría ser 70% o más (supuesto, a validar con el primer dueño).</p>
    </div>`;
}

function vistaConfig() {
  const n = S.negocio;
  const filas = S.canchas.map(c => `<div class="cfg-cancha">
      <label>Nombre<input data-a-ch="nombre" data-cid="${c.id}" value="${esc(c.nombre)}"></label>
      <label>Deporte<select data-a-ch="deporte" data-cid="${c.id}">${Object.entries(DEPORTES).map(([k, v]) => `<option value="${k}" ${k === (c.deporte || 'futbol') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>S/ por hora<input type="number" min="0" step="1" data-a-ch="precioHora" data-cid="${c.id}" value="${c.precioHora}"></label>
      <button class="btn sec chico" data-a="quitarCancha" data-id="${c.id}" aria-label="Quitar ${esc(c.nombre)}">Quitar</button></div>`).join('');
  const optH = (sel, desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${horaTxt(h === 24 ? 0 : h)}${h === 24 ? ' (medianoche)' : ''}</option>`).join('');
  return `
    <h2>Ajustes</h2>
    <div class="card"><h3>Negocio</h3>
      <label>Nombre del negocio<input id="cfg-nombre" value="${esc(n.nombre)}"></label>
      <div class="fila">
        <label>Abres desde<select id="cfg-hini">${optH(n.horaInicio, 0, 23)}</select></label>
        <label>Cierras a las<select id="cfg-hfin">${optH(n.horaFin, 1, 24)}</select></label>
      </div>
      <h3 style="margin-top:8px">Canchas</h3>${filas}
      <button class="btn sec chico" data-a="agregarCancha">+ Agregar cancha</button>
      <p class="sub" style="margin:8px 0 0">La foto de cada cancha es una imagen genérica según el deporte. Subir tus propias fotos viene en una siguiente versión.</p></div>
    <div class="card"><h3>Incluido en la reserva</h3>
      <p class="sub">Lo que forma parte del servicio y no se cobra (chalecos, proyector…). El jugador lo marca si lo necesita y tú lo ves en su reserva.</p>
      ${S.extras.filter(x => x.tipo === 'servicio').map(x => `<div class="cfg-cancha cfg-ex">
        <label>Nombre<input data-a-ex="nombre" data-eid="${x.id}" value="${esc(x.nombre)}"></label>
        <button class="btn sec chico" data-a="quitarExtra" data-id="${x.id}" aria-label="Quitar ${esc(x.nombre)}">Quitar</button></div>`).join('') || '<p class="sub">Aún no tienes servicios incluidos.</p>'}
      <button class="btn sec chico" data-a="agregarExtra" data-tipo="servicio">+ Agregar servicio incluido</button></div>
    <div class="card"><h3>Tienda</h3>
      <p class="sub">Bebidas y comida que vendes. El jugador las pide con su reserva, suman al total y se cobran en la cancha. Los precios de ejemplo son referenciales: cámbialos por los tuyos.</p>
      ${S.extras.filter(x => x.tipo !== 'servicio').map(x => `<div class="cfg-cancha">
        <label>Nombre<input data-a-ex="nombre" data-eid="${x.id}" value="${esc(x.nombre)}"></label>
        <label>Precio (S/)<input type="number" min="0" step="1" data-a-ex="precio" data-eid="${x.id}" value="${x.precio}"></label>
        <button class="btn sec chico" data-a="quitarExtra" data-id="${x.id}" aria-label="Quitar ${esc(x.nombre)}">Quitar</button></div>`).join('') || '<p class="sub">Aún no tienes productos.</p>'}
      <button class="btn sec chico" data-a="agregarExtra" data-tipo="producto">+ Agregar producto</button></div>
    <div class="card"><h3>Cobro de la seña</h3>
      <p class="sub">Lo ve el jugador al reservar. El pago es por Yape/Plin fuera de la app: tú marcas "Recibí la seña".</p>
      <div class="fila">
        <label>Yape / Plin al número<input id="cfg-yape" inputmode="tel" value="${esc(n.yape)}" placeholder="9XX XXX XXX"></label>
        <label>Tu WhatsApp (para el aviso de pago)<input id="cfg-wsp" inputmode="tel" value="${esc(n.whatsapp)}" placeholder="9XXXXXXXX"></label>
      </div>
      <div class="fila">
        <label>Seña por reserva (S/)<input type="number" id="cfg-sena" min="0" step="1" value="${n.sena}"></label>
        <label>Plazo para pagar (minutos)<input type="number" id="cfg-plazo" min="5" max="240" step="5" value="${n.minutosSena}"></label>
      </div>
    </div>
    <div class="card"><h3>Instalar en el celular</h3>
      <p class="sub" style="margin:0">Android (Chrome): menú ⋮ → "Instalar app". iPhone (Safari): botón Compartir → "Agregar a pantalla de inicio". Así abre como una app, sin barra del navegador.</p></div>
    ${api.modo === 'demo' ? `<div class="card"><h3>Datos de demostración</h3>
      <p class="sub">Los datos viven solo en este navegador.</p>
      <button class="btn sec" data-a="reiniciarDemo">Volver a los datos de ejemplo</button></div>` : `<div class="card"><h3>Cuenta</h3><p class="sub" style="margin:0">Sesión: ${esc(A?.email || '')}</p></div>`}`;
}

/* ====================== JUGADOR ====================== */
const ERRORES_J = {
  ocupado: 'Ese horario se acaba de ocupar. Elige otro.',
  limite_pendientes: 'Ya tienes 2 reservas esperando seña. Paga una o espera a que venzan.',
  pasado: 'Ese horario ya pasó. Elige otro.',
  horario_invalido: 'Ese horario está fuera de atención.',
  datos_invalidos: 'Revisa tu nombre y tu celular (9 dígitos, empieza con 9).',
  negocio_no_existe: 'Este enlace ya no existe.',
  desconocido: 'No pudimos reservar. Intenta de nuevo en un momento.'
};
function disponibleJ(canchaId, fecha, hora, dur) {
  const I = P.info;
  if (hora < I.horaInicio || hora + dur > I.horaFin || inicioMs(fecha, hora) <= Date.now()) return false;
  return !P.ocupados.some(o => o.canchaId === canchaId && o.fecha === fecha && hora < o.hora + o.dur && o.hora < hora + dur);
}
function vistaJugador() {
  if (P.noExiste) return '<div class="card"><h2>No encontramos este complejo</h2><p class="sub" style="margin:0">Revisa que el enlace esté completo. Si el problema sigue, pídele el enlace de nuevo al dueño.</p></div>';
  if (P.resId && P.res) return vistaMiReserva(P.res);
  const I = P.info, c = I.canchas.find(x => x.id === P.canchaId) || I.canchas[0];
  if (!c) return '<p class="vacio">Este complejo aún no tiene canchas disponibles.</p>';
  P.canchaId = c.id;
  const dias = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDias(hoyD(), i), f = iso(d);
    return `<button class="chip" data-a="jDia" data-f="${f}" aria-pressed="${f === P.fecha}">${i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${DIAS_CORTO[d.getDay()]} ${d.getDate()}`}</button>`;
  }).join('');
  const canchas = I.canchas.map(x => `<button class="ccard" data-a="jCancha" data-id="${x.id}" aria-pressed="${x.id === c.id}">
      <img src="${esc(imgCancha(x))}" alt="" loading="lazy"><span><b>${esc(x.nombre)}</b><small>${esc(DEPORTES[x.deporte] || 'Fútbol')} · ${soles(x.precioHora)}/h</small></span></button>`).join('');
  const hero = `<div class="hero"><img src="${esc(imgCancha(c))}" alt="${esc(c.nombre)}"><div class="hero-t"><b>${esc(c.nombre)}</b><span>${esc(DEPORTES[c.deporte] || 'Fútbol')} · ${soles(c.precioHora)} por hora</span></div></div>`;
  const durs = [1, 2].map(d => `<button class="chip" data-a="jDur" data-d="${d}" aria-pressed="${P.dur === d}">${d} ${d === 1 ? 'hora' : 'horas'}</button>`).join('');
  let horas = '';
  for (let h = I.horaInicio; h < I.horaFin; h++) {
    const libre = disponibleJ(c.id, P.fecha, h, P.dur), pasada = inicioMs(P.fecha, h) <= Date.now();
    const sub = libre ? soles(c.precioHora * P.dur) : (pasada ? 'pasó' : (h + P.dur > I.horaFin ? 'no alcanza' : 'ocupado'));
    horas += `<button class="hbtn" data-a="jHora" data-h="${h}" aria-pressed="${P.hora === h}" ${libre ? '' : 'disabled'}><b>${horaTxt(h)}</b><small>${sub}</small></button>`;
  }
  const ex = I.extras || [];
  const extrasSel = ex.filter(x => P.extras[x.id] > 0).map(x => ({ id: x.id, nombre: x.nombre, precio: x.precio, tipo: x.tipo, cant: P.extras[x.id] }));
  const servicios = ex.filter(x => x.tipo === 'servicio'), tienda = ex.filter(x => x.tipo !== 'servicio');
  const extrasHtml = (servicios.length ? `<div class="card"><h3>Incluido en tu reserva <small style="font-weight:400">(pídelo si lo necesitas)</small></h3>
      <p class="sub">Sin costo adicional.</p>
      <div class="chips">${servicios.map(x => `<button class="chip" data-a="jExtra" data-id="${x.id}" data-d="${P.extras[x.id] ? -1 : 1}" aria-pressed="${!!P.extras[x.id]}">${P.extras[x.id] ? '✓ ' : '+ '}${esc(x.nombre)}</button>`).join('')}</div></div>` : '')
    + (tienda.length ? `<div class="card"><h3>Tienda <small style="font-weight:400">(opcional)</small></h3>
      <p class="sub">Pídelo con tu reserva y lo pagas en la cancha.</p>
      ${tienda.map(x => `<div class="ex"><span><b>${esc(x.nombre)}</b><small>${soles(x.precio)}</small></span>
        <span class="step"><button class="btn sec chico" data-a="jExtra" data-id="${x.id}" data-d="-1" aria-label="Quitar ${esc(x.nombre)}" ${P.extras[x.id] > 0 ? '' : 'disabled'}>−</button>
        <b aria-live="polite">${P.extras[x.id] || 0}</b>
        <button class="btn sec chico" data-a="jExtra" data-id="${x.id}" data-d="1" aria-label="Agregar ${esc(x.nombre)}">+</button></span></div>`).join('')}</div>` : '');
  let form = '';
  if (P.hora !== null && disponibleJ(c.id, P.fecha, P.hora, P.dur)) {
    form = `<div class="card">
      <div class="resumen"><b>${esc(c.nombre)}</b> · ${esc(fechaMsg(P.fecha))} · ${horaTxt(P.hora)} a ${horaTxt(P.hora + P.dur)}<br>
        ${extrasSel.length ? `Agregados: ${listaExtras(extrasSel)}<br>` : ''}Total ${soles(c.precioHora * P.dur + totalExtras(extrasSel))} · Seña ${soles(I.sena)} por Yape</div>
      <label>Tu nombre<input id="j-nombre" autocomplete="name" value="${esc(P.nombre)}"></label>
      <label>Tu celular<input id="j-tel" inputmode="tel" autocomplete="tel" placeholder="9XXXXXXXX" value="${esc(P.tel)}"></label>
      <p class="err" id="j-err" role="alert"></p>
      <button class="btn grande" data-a="jReservar">Apartar mi horario</button>
      <p class="sub" style="margin:8px 0 0">Tu horario queda apartado ${esc(I.minutosSena)} minutos. Si no llega la seña, se libera para otros.</p>
    </div>`;
  }
  const mias = P.mias.filter(r => (r.estado === 'pendiente' || r.estado === 'activa') && inicioMs(String(r.fecha).slice(0, 10), r.hora) > Date.now());
  const lista = mias.length ? `<div class="card lista"><h3>Tus reservas</h3>${mias.map(r => `<div class="item">
      <div class="hora">${horaTxt(r.hora)}</div><div class="quien"><b>${esc(fechaCorta(String(r.fecha).slice(0, 10)))}</b> · ${esc(I.canchas.find(x => x.id === r.canchaId)?.nombre || '')}
      <small>${r.estado === 'pendiente' ? 'Falta la seña' : 'Confirmada'}</small></div>
      <button class="btn sec chico" data-a="jVer" data-id="${r.id}">Ver</button></div>`).join('')}</div>` : '';
  return `
    <h2>Elige tu horario</h2>
    <p class="sub">Ves solo los horarios libres. Reservas en un minuto y sin escribir por chat.</p>
    <div class="canchas">${canchas}</div>${hero}
    <h3 class="paso-t">¿Qué día y a qué hora?</h3>
    <div class="dias">${dias}</div><div class="chips">${durs}</div>
    <div class="horas">${horas}</div>${extrasHtml}${form}${lista}`;
}
function vistaMiReserva(r) {
  const I = P.info, c = I.canchas.find(x => x.id === r.canchaId), fecha = String(r.fecha).slice(0, 10);
  const totalR = (c?.precioHora || 0) * r.dur + totalExtras(r.extras);
  const resumen = `<div class="resumen"><b>${esc(c?.nombre || '')}</b> · ${esc(fechaMsg(fecha))} · ${horaTxt(r.hora)} a ${horaTxt(r.hora + r.dur)}<br>
      ${r.extras?.length ? `Agregados: ${listaExtras(r.extras)}${hayCobro(r.extras) ? ' (se pagan en la cancha)' : ''}<br>` : ''}Total ${soles(totalR)} · Seña ${soles(r.sena)}<br>Código: <span class="codigo">${esc(r.codigo)}</span></div>`;
  const volver = '<div class="acciones" style="justify-content:flex-start"><button class="btn sec" data-a="jVolver">Volver a los horarios</button></div>';
  if (r.estado === 'pendiente') {
    const texto = `Hola, soy ${r.nombre}. Reservé ${c?.nombre} ${fechaMsg(fecha)} de ${horaTxt(r.hora)} a ${horaTxt(r.hora + r.dur)} (código ${r.codigo}).${textoExtras(r.extras)} Te envío la constancia de la seña de ${soles(r.sena)} por Yape. 🙏`;
    return `<h2>Horario apartado</h2>${resumen}
      <div class="card">
        <p style="margin:0 0 10px">Tienes <b class="contador" data-vence="${r.venceEn}"></b> para pagar la seña. Si no llega, el horario se libera.</p>
        <div class="paso"><div class="n">1</div><div>Paga <b>${soles(r.sena)}</b> por Yape o Plin al <b>${esc(I.yape || 'número del dueño')}</b>.
          ${I.yape ? `<button class="btn sec chico" data-a="copiar" data-txt="${esc(I.yape.replace(/\D/g, ''))}">Copiar número</button>` : ''}</div></div>
        <div class="paso"><div class="n">2</div><div>Envía la constancia al dueño por WhatsApp. Él confirma tu reserva.</div></div>
        <a class="btn grande" href="${waLink(I.whatsapp, texto)}" target="_blank" rel="noopener" id="j-pague">Ya pagué: avisar por WhatsApp</a>
      </div>${volver}`;
  }
  if (r.estado === 'activa') return `<h2>¡Reserva confirmada! ⚽</h2>${resumen}<p class="nota">El dueño recibió tu seña. Llega unos minutos antes. Si no puedes venir, avísale con tiempo.</p>${volver}`;
  if (r.estado === 'vencida') return `<h2>Se liberó el horario</h2>${resumen}<p class="nota aviso">No llegó la seña a tiempo, así que el horario volvió a estar libre. Si todavía lo quieres, revisa si sigue disponible y reserva de nuevo.</p>${volver}`;
  return `<h2>Reserva cancelada</h2>${resumen}<p class="nota aviso">Esta reserva fue cancelada. Puedes elegir otro horario.</p>${volver}`;
}

/* ====================== MODALES Y AVISOS ====================== */
let tToast = null;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('visible'); clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('visible'), 2800); }
function abrirModal(html) { $('#caja').innerHTML = html; $('#modal').classList.add('abierto'); const f = $('#caja input, #caja button'); if (f) f.focus(); tick(); }
function cerrarModal() { $('#modal').classList.remove('abierto'); $('#caja').innerHTML = ''; ui.confirmarCancelar = false; }
const modalAbierto = () => $('#modal').classList.contains('abierto');

function modalNueva(fecha, hora) {
  const c = canchaActual();
  abrirModal(`<h3>Nueva reserva</h3>
    <p class="sub">${esc(c.nombre)} · ${esc(fechaCorta(fecha))} · ${horaTxt(hora)} · por llamada o en persona</p>
    <label>Nombre<input id="f-nombre" autocomplete="off"></label>
    <label>Teléfono (WhatsApp)<input id="f-tel" inputmode="tel" placeholder="9XXXXXXXX"></label>
    <div class="fila">
      <label>Duración<select id="f-dur"><option value="1">1 hora</option><option value="2">2 horas</option></select></label>
      <label>Seña (S/)<input id="f-sena" type="number" min="0" step="1" value="${esc(S.negocio.sena)}"></label>
    </div>
    <label class="chk"><input id="f-pagada" type="checkbox"> Seña ya pagada</label>
    <p class="err" id="f-err" role="alert"></p>
    <div class="acciones"><button class="btn sec" data-a="cerrar">Cancelar</button>
    <button class="btn" data-a="guardarNueva" data-fecha="${fecha}" data-hora="${hora}">Guardar reserva</button></div>`);
}
function modalVer(id) {
  const r = S.reservas.find(x => x.id === id); if (!r) return;
  const c = canchaPorId(r.canchaId), espera = r.estado === 'pendiente';
  const estadoTag = espera ? `<span class="tag espera">vence en <span class="contador" data-vence="${r.venceEn}"></span></span>`
    : `<span class="tag ${r.senaPagada ? 'ok' : 'pend'}">${r.senaPagada ? 'pagada' : 'pendiente'}</span>`;
  const botones = espera
    ? `<button class="btn chico" data-a="confirmarSena" data-id="${r.id}">Recibí la seña</button>
       <button class="btn sec chico" data-a="extender" data-id="${r.id}">+15 min de plazo</button>
       <a class="btn sec chico" href="${waLink(r.telefono, textoPendiente(r))}" target="_blank" rel="noopener">Escribirle</a>`
    : `<button class="btn sec chico" data-a="toggleSena" data-id="${r.id}">${r.senaPagada ? 'Marcar seña como pendiente' : 'Marcar seña como pagada'}</button>
       <a class="btn chico" href="${waLink(r.telefono, textoConfirmacion(r))}" target="_blank" rel="noopener">Enviar confirmación</a>`;
  abrirModal(`<h3>${esc(r.nombre)}</h3>
    <p class="sub">${esc(c?.nombre)} · ${esc(fechaCorta(r.fecha))} · ${horaTxt(r.hora)} a ${horaTxt(r.hora + r.dur)}</p>
    <p>Total ${soles(total(r))} · Seña ${soles(r.sena)} ${estadoTag}<br>
    Teléfono: ${r.telefono ? esc(r.telefono) : 'sin registrar'}<br>
    ${r.extras?.length ? `Agregados: ${listaExtras(r.extras)}${hayCobro(r.extras) ? ' (se cobran en la cancha)' : ''}<br>` : ''}
    Origen: ${r.origen === 'enlace' ? 'enlace de reservas' : 'registrada por ti'} · Código ${cod(r.id)}</p>
    <div class="acciones" style="justify-content:flex-start;margin-bottom:10px">${botones}</div>
    <div class="acciones">
      ${ui.confirmarCancelar
        ? `<button class="btn sec" data-a="noCancelar" data-id="${r.id}">No, mantener</button><button class="btn peligro" data-a="siCancelar" data-id="${r.id}">${espera ? 'Sí, rechazar' : 'Sí, cancelar reserva'}</button>`
        : `<button class="btn sec" data-a="pedirCancelar" data-id="${r.id}">${espera ? 'Rechazar' : 'Cancelar reserva'}</button><button class="btn" data-a="cerrar">Cerrar</button>`}
    </div>`);
}

/* ====================== EVENTOS ====================== */
const val = id => ($(id) ? $(id).value : '');
const hacer = async (promesa, okMsg) => {
  const res = await promesa;
  if (res && res.error) { toast(res.error); return res; }
  if (okMsg) toast(okMsg);
  return res || {};
};
let deferredPrompt = null;
const acciones = {
  // --- acceso ---
  entrarDemo: async () => { await api.entrar(); A = await api.sesion(); await recargar(); },
  entrar: async () => {
    const r = await api.entrar(val('#a-email').trim(), val('#a-pw'));
    if (r.error) { ui.authMsg = r.error; ui.authAviso = ''; render(); return; }
    ui.authMsg = ''; A = await api.sesion(); cargando = true; render(); await recargar();
  },
  registrar: async () => {
    const email = val('#a-email').trim(), pw = val('#a-pw');
    if (!email || pw.length < 6) { ui.authMsg = 'Escribe tu correo y una contraseña de al menos 6 caracteres.'; render(); return; }
    const r = await api.registrar(email, pw);
    if (r.error) { ui.authMsg = r.error; ui.authAviso = ''; render(); return; }
    ui.authMsg = ''; ui.authAviso = r.aviso || '';
    if (!r.aviso) { A = await api.sesion(); cargando = true; render(); await recargar(); } else render();
  },
  salir: async () => { await api.salir(); A = null; S = { negocio: null, canchas: [], extras: [], reservas: [] }; ui.tab = 'agenda'; render(); },
  crearNegocio: async () => {
    const nombre = val('#o-nombre').trim(), slug = slugify(val('#o-slug') || nombre);
    const err = $('#o-err');
    if (nombre.length < 2) { err.textContent = 'Escribe el nombre del complejo.'; return; }
    if (slug.length < 3) { err.textContent = 'El enlace necesita al menos 3 letras o números.'; return; }
    const r = await api.crearNegocio({ nombre, slug });
    if (r.error) { err.textContent = r.error; return; }
    toast('Complejo creado'); await recargar();
  },
  reintentar: () => { errorCarga = ''; cargando = true; render(); esJugador ? cargarJugador() : recargar(); },
  instalar: async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; $('#instalar').hidden = true; } },
  irJugador: () => {},
  // --- dueño ---
  tab: el => { ui.tab = el.dataset.tab; render(); },
  cancha: el => { ui.canchaId = el.dataset.id; render(); },
  sem: el => { const d = Number(el.dataset.d); ui.lunes = d === 0 ? lunesDe(hoyD()) : addDias(ui.lunes, d); render(); },
  nueva: el => modalNueva(el.dataset.fecha, Number(el.dataset.hora)),
  ver: el => { ui.confirmarCancelar = false; modalVer(el.dataset.id); },
  cerrar: () => cerrarModal(),
  guardarNueva: async el => {
    const nombre = val('#f-nombre').trim(), tel = val('#f-tel').trim();
    if (nombre.length < 2) { $('#f-err').textContent = 'Falta el nombre (2 letras o más).'; return; }
    let telOk = '';
    if (tel) { telOk = normTel(tel); if (!telOk) { $('#f-err').textContent = 'El celular debe tener 9 dígitos y empezar con 9 (o déjalo vacío).'; return; } }
    const res = await api.crearReservaDueno({ canchaId: ui.canchaId, fecha: el.dataset.fecha, hora: Number(el.dataset.hora), dur: Number(val('#f-dur')),
      nombre, telefono: telOk, sena: Number(val('#f-sena')) || 0, senaPagada: $('#f-pagada').checked });
    if (res.error) { $('#f-err').textContent = res.error; return; }
    cerrarModal(); toast('Reserva guardada'); await recargar();
  },
  toggleSena: async el => { const r = S.reservas.find(x => x.id === el.dataset.id); await hacer(api.actualizarReserva(r.id, { senaPagada: !r.senaPagada })); await recargar(); modalVer(r.id); },
  confirmarSena: async el => { await hacer(api.actualizarReserva(el.dataset.id, { estado: 'activa', senaPagada: true, venceEn: null }), 'Seña registrada: reserva confirmada'); cerrarModal(); await recargar(); },
  extender: async el => {
    const r = S.reservas.find(x => x.id === el.dataset.id);
    const nuevo = new Date(Math.max(Date.now(), new Date(r.venceEn).getTime()) + 15 * 60000).toISOString();
    await hacer(api.actualizarReserva(r.id, { venceEn: nuevo }), 'Plazo ampliado 15 minutos'); await recargar(); modalVer(r.id);
  },
  pedirCancelar: el => { ui.confirmarCancelar = true; modalVer(el.dataset.id); },
  noCancelar: el => { ui.confirmarCancelar = false; modalVer(el.dataset.id); },
  siCancelar: async el => { await hacer(api.actualizarReserva(el.dataset.id, { estado: 'cancelada' }), 'Reserva cancelada: el horario quedó libre'); cerrarModal(); await recargar(); },
  enviado: async el => { api.actualizarReserva(el.dataset.id, { recordatorioEnviado: true }).then(() => setTimeout(recargar, 400)); },   // sin preventDefault: el enlace se abre
  copiar: async el => {
    const src = el.dataset.from ? document.getElementById(el.dataset.from) : null;
    const ok = await copiarTexto(el.dataset.txt || (src ? src.value : ''));
    if (ok) toast('Copiado'); else { if (src) { src.focus(); src.select(); } toast('No pude copiar solo: el texto quedó seleccionado, cópialo manualmente'); }
  },
  resetMsg: () => { ls.set(KEY_MSG, ''); render(); toast('Mensaje restablecido'); },
  agregarCancha: async () => { await hacer(api.guardarCancha({ nombre: 'Cancha ' + (S.canchas.length + 1), precioHora: 70, deporte: S.canchas.at(-1)?.deporte || 'futbol' })); await recargar(); },
  agregarExtra: async el => { const serv = el.dataset.tipo === 'servicio'; await hacer(api.guardarExtra({ nombre: serv ? 'Nuevo servicio' : 'Nuevo producto', precio: serv ? 0 : 10, tipo: el.dataset.tipo })); await recargar(); },
  quitarExtra: async el => { await hacer(api.quitarExtra(el.dataset.id)); await recargar(); },
  quitarCancha: async el => {
    if (S.canchas.length <= 1) { toast('Debe quedar al menos una cancha'); return; }
    await hacer(api.quitarCancha(el.dataset.id)); await recargar();
  },
  reiniciarDemo: async () => { await api.reiniciarDemo(); ui.canchaId = null; await recargar(); toast('Datos de ejemplo restaurados'); },
  // --- jugador ---
  jDia: el => { P.fecha = el.dataset.f; P.hora = null; render(); },
  jCancha: el => { P.canchaId = el.dataset.id; P.hora = null; render(); },
  jExtra: el => { const id = el.dataset.id, n = Math.min(10, Math.max(0, (P.extras[id] || 0) + Number(el.dataset.d))); if (n) P.extras[id] = n; else delete P.extras[id]; render(); },
  jDur: el => { P.dur = Number(el.dataset.d); P.hora = null; render(); },
  jHora: el => { P.hora = Number(el.dataset.h); render(); const f = $('#j-nombre'); if (f) f.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
  jReservar: async () => {
    const nombre = val('#j-nombre').trim(), tel = normTel(val('#j-tel')), err = $('#j-err');
    P.nombre = nombre; P.tel = val('#j-tel');
    if (nombre.length < 2) { err.textContent = 'Escribe tu nombre.'; return; }
    if (!tel) { err.textContent = 'Escribe tu celular de 9 dígitos (empieza con 9).'; return; }
    const btn = $('[data-a=jReservar]'); btn.disabled = true; btn.textContent = 'Apartando…';
    const res = await api.reservar(P.slug, { canchaId: P.canchaId, fecha: P.fecha, hora: P.hora, dur: P.dur, nombre, telefono: tel,
      extras: Object.entries(P.extras).map(([id, cant]) => ({ id, cant })) });
    if (res.error) {
      await refrescarOcupados(); if (res.error === 'ocupado' || res.error === 'pasado') P.hora = null;
      render(); toast(ERRORES_J[res.error] || ERRORES_J.desconocido);
      const e2 = $('#j-err'); if (e2) e2.textContent = ERRORES_J[res.error] || ERRORES_J.desconocido; return;
    }
    P.tel = tel; ls.set(KEY_J, { nombre, telefono: tel });
    ls.set(KEY_MIS, [...ls.get(KEY_MIS, []).filter(x => x !== res.reserva.id), res.reserva.id].slice(-10));
    P.resId = res.reserva.id; P.res = await api.estado(P.resId); P.hora = null; P.extras = {};
    await refrescarOcupados(); render(); window.scrollTo(0, 0);
  },
  jVer: async el => { P.resId = el.dataset.id; P.res = await api.estado(P.resId); render(); window.scrollTo(0, 0); },
  jVolver: async () => {
    P.resId = null; P.res = null; await refrescarOcupados();
    P.mias = (await Promise.all(ls.get(KEY_MIS, []).slice(-5).map(id => api.estado(id)))).filter(Boolean); render();
  }
};
document.addEventListener('click', e => {
  if (e.target.id === 'modal') { cerrarModal(); return; }
  const el = e.target.closest('[data-a]');
  if (el && acciones[el.dataset.a]) acciones[el.dataset.a](el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalAbierto()) cerrarModal();
  if (e.key === 'Enter' && e.target.id === 'a-pw') acciones.entrar();
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'fecha-rec') { ui.fechaRec = t.value || ui.fechaRec; render(); return; }
  const mapa = { 'cfg-nombre': () => ({ nombre: t.value.trim() || S.negocio.nombre }), 'cfg-yape': () => ({ yape: t.value.trim() }), 'cfg-wsp': () => ({ whatsapp: t.value.trim() }),
    'cfg-sena': () => ({ sena: Math.max(0, Number(t.value) || 0) }), 'cfg-plazo': () => ({ minutosSena: Math.min(240, Math.max(5, Number(t.value) || 30)) }) };
  if (mapa[t.id]) { await hacer(api.guardarNegocio(mapa[t.id]()), 'Guardado'); await recargar(); return; }
  if (t.id === 'cfg-hini' || t.id === 'cfg-hfin') {
    const ini = Number(val('#cfg-hini')), fin = Number(val('#cfg-hfin'));
    if (fin <= ini) { toast('La hora de cierre debe ser después de la de apertura'); await recargar(); return; }
    await hacer(api.guardarNegocio({ horaInicio: ini, horaFin: fin }), 'Guardado'); await recargar(); return;
  }
  if (t.dataset.aCh) {
    const c = canchaPorId(t.dataset.cid); if (!c) return;
    const patch = { id: c.id, nombre: c.nombre, precioHora: c.precioHora, deporte: c.deporte || 'futbol' };
    if (t.dataset.aCh === 'nombre') patch.nombre = t.value.trim() || c.nombre;
    else if (t.dataset.aCh === 'deporte') patch.deporte = t.value;
    else patch.precioHora = Math.max(0, Number(t.value) || 0);
    await hacer(api.guardarCancha(patch), 'Guardado'); await recargar();
  }
  if (t.dataset.aEx) {
    const x = S.extras.find(y => y.id === t.dataset.eid); if (!x) return;
    const patch = { id: x.id, nombre: x.nombre, precio: x.precio, tipo: x.tipo };
    if (t.dataset.aEx === 'nombre') patch.nombre = t.value.trim() || x.nombre; else patch.precio = Math.max(0, Number(t.value) || 0);
    await hacer(api.guardarExtra(patch), 'Guardado'); await recargar();
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'j-nombre') P.nombre = t.value;
  else if (t.id === 'j-tel') P.tel = t.value;
  else if (t.id === 'enlace-msg') { ls.set(KEY_MSG, t.value); const a = $('#enlace-wsp'); if (a) a.href = waLink('', t.value); }
  else if (t.id === 'o-nombre') { const s = $('#o-slug'); if (s && !ui.slugEditado) s.value = slugify(t.value); const p = $('#o-prev'); if (p) p.innerHTML = `Será: ${esc(location.origin !== 'null' ? location.origin + location.pathname : '')}#/r/<b>${esc(slugify(t.value))}</b>`; }
  else if (t.id === 'o-slug') ui.slugEditado = true;
});

/* ====================== TIEMPO REAL (cuentas regresivas y refresco) ====================== */
const escribiendo = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
setInterval(() => {
  tick();
  if (esJugador) {
    if (P.res && P.res.estado === 'pendiente' && new Date(P.res.venceEn).getTime() <= Date.now()) refrescarRes();
  } else if (A && S.negocio && pendientes().some(r => new Date(r.venceEn).getTime() <= Date.now())) { recargar(); }
}, 1000);
async function refrescarRes() {
  if (!P.resId) return; const nuevo = await api.estado(P.resId);
  if (nuevo && (!P.res || nuevo.estado !== P.res.estado || nuevo.venceEn !== P.res.venceEn)) { P.res = nuevo; render(); }
}
setInterval(() => {
  if (document.hidden || modalAbierto() || escribiendo()) return;
  if (esJugador) { if (P.resId && P.res?.estado === 'pendiente') refrescarRes(); else if (!P.resId && P.info) refrescarOcupados().then(() => { if (!escribiendo()) render(); }); }
  else if (A && S.negocio) recargar();
}, 15000);
// El jugador que espera la confirmación la ve más rápido (cada 5 s).
setInterval(() => { if (esJugador && !document.hidden && P.resId && P.res?.estado === 'pendiente') refrescarRes(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !modalAbierto() && !escribiendo()) { if (esJugador) { if (P.resId) refrescarRes(); else if (P.info) refrescarOcupados().then(render); } else if (A && S.negocio) recargar(); } });

/* ====================== INSTALACIÓN (PWA) ====================== */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (!esJugador) $('#instalar').hidden = false; });
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});

/* ====================== ARRANQUE ====================== */
(async function arrancar() {
  render();
  if (esJugador) { await cargarJugador(); return; }
  try { A = await api.sesion(); } catch (e) { A = null; }
  if (A) await recargar(); else { cargando = false; render(); }
})();
// Cambiar de #/r/<enlace> a la raíz (o al revés) en la misma pestaña: recargar para elegir la vista correcta.
window.addEventListener('hashchange', () => location.reload());
