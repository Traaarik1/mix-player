// Анонимные счётчики (GoatCounter, бесплатно, без cookies): сколько установок, пользователей и приглашённых.
// Никаких имён, номеров и треков — только пути вида /install, /user, /ref/<код приглашения>.
// GC — код счётчика с goatcounter.com (часть адреса до .goatcounter.com). Пусто — счётчики выключены.
export const GC = '';
const base = () => `https://${GC}.goatcounter.com`;

export function count(path) {
  if (!GC || !navigator.onLine) return;
  const img = new Image();
  img.src = `${base()}/count?p=${encodeURIComponent(path)}&t=${encodeURIComponent(path)}&rnd=${Math.random().toString(36).slice(2)}`;
}
// Сколько раз засчитан путь (у счётчика должна быть включена настройка «Allow adding visitor counts on your website»)
export async function countOf(path) {
  if (!GC) return null;
  const r = await fetch(`${base()}/counter/${encodeURIComponent(path)}.json`).catch(() => null);
  if (!r) return null;
  if (r.status === 404) return 0; // ещё ни разу
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j ? Number(String(j.count).replace(/\D/g, '')) || 0 : null;
}
export const dashboard = () => GC ? base() : '';
