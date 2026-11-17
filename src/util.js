// Utilidades compartidas (fechas, formato, WhatsApp). Sin dependencias.
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const hoyD = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const lunesDe = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const horaTxt = h => `${pad(h)}:00`;
export const soles = n => 'S/ ' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '');
export const fechaCorta = s => { const d = fromIso(s); return `${DIAS_CORTO[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
export const fechaMsg = s => {
  const diff = Math.round((fromIso(s) - hoyD()) / 86400000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  const d = fromIso(s);
  return `el ${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};
// Inicio de una reserva como instante. Se asume que el dueño y los jugadores están en hora de Perú.
export const inicioMs = (fecha, hora) => { const d = fromIso(fecha); d.setHours(hora, 0, 0, 0); return d.getTime(); };
export const cuenta = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
export const codigo = id => String(id).slice(-4).toUpperCase();

export function normTel(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? d : '';
}
export function waLink(telefono, texto) {
  const d = String(telefono || '').replace(/\D/g, '');
  let num = '';
  if (d.length === 9 && d[0] === '9') num = '51' + d;
  else if (d.length === 11 && d.startsWith('51')) num = d;
  else if (d.length >= 10) num = d;
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;   // sin número: se elige el contacto
}
export function slugify(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
export async function copiarTexto(txt) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(txt); return true; } } catch (e) {}
  return false;
}
