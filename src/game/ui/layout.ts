/** Calcula tamaño y posición de mis cartas para que ocupen la zona de mano (~3/4 de la pantalla). */
export interface CardPos { x: number; y: number; rot: number }
export interface HandLayout { w: number; h: number; pos: CardPos[] }

const RATIO = 440 / 695; // ancho/alto del naipe (Fournier 1878)

export function computeHandLayout(W: number, H: number, n: number): HandLayout {
  if (n <= 0 || W <= 0 || H <= 0) return { w: 0, h: 0, pos: [] };
  const pad = 4;
  W -= pad * 2;
  H -= pad * 2;
  // A) Abanico horizontal: cada carta deja ver al menos el 55% de su ancho.
  const hA = Math.min(H, W / (RATIO * (1 + (n - 1) * 0.55)));
  // B) Cascada diagonal (pantallas verticales): se ve la esquina con el número y el palo.
  const hB = n === 1 ? Math.min(H, W / RATIO) : Math.min(H / (1 + (n - 1) * 0.16), W / (RATIO * (1 + (n - 1) * 0.24)));
  const useA = hA >= hB * 0.98;
  const h = Math.floor(useA ? hA : hB);
  const w = Math.floor(h * RATIO);
  const pos: CardPos[] = [];
  if (n === 1) {
    pos.push({ x: pad + (W - w) / 2, y: pad + (H - h) / 2, rot: 0 });
    return { w, h, pos };
  }
  let dx = Math.min((W - w) / (n - 1), w * 1.06);
  let dy = useA ? 0 : (H - h) / (n - 1);
  if (!useA) dx = Math.max(dx, w * 0.24);
  dy = Math.max(0, dy);
  const totalW = w + dx * (n - 1);
  const totalH = h + dy * (n - 1);
  const x0 = pad + (W - totalW) / 2;
  const y0 = pad + (H - totalH) / 2;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) pos.push({ x: x0 + dx * i, y: y0 + dy * i, rot: useA ? (i - mid) * 2.5 : (i - mid) * 1.5 });
  return { w, h, pos };
}
