/**
 * Bots: deciden solo con la vista pública (sus propias cartas + información de mesa).
 * Nunca reciben el estado completo, por eso no pueden ver cartas ocultas.
 */
import { cardValue, createDeck, handScore } from './cards';
import type { PublicView } from './engine';
import { Rng } from './rng';
import type { Action, BotProfile } from './types';

// Distribución de la suma de 3 cartas de la baraja de 40 (C(40,3) = 9880 combinaciones).
const DIST3: number[] = (() => {
  const vals = createDeck().map(cardValue);
  const d = new Array(22).fill(0);
  let total = 0;
  for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) for (let k = j + 1; k < vals.length; k++) {
    d[vals[i] + vals[j] + vals[k]]++;
    total++;
  }
  return d.map((x) => x / total);
})();

/** P(rival < s) + 0.5·P(rival = s) */
export function beatProb(score: number): number {
  if (score > 21) return 0;
  let p = 0;
  for (let v = 0; v < score; v++) p += DIST3[v];
  return p + 0.5 * DIST3[score];
}

const THIRD_CARD: [number, number][] = [[0, 12 / 40], [1, 0.1], [2, 0.1], [3, 0.1], [4, 0.1], [5, 0.1], [6, 0.1], [7, 0.1]];

/** Probabilidad aproximada de ganar la comparación contra k rivales. */
export function winEstimate(view: PublicView): number {
  const k = Math.max(1, view.opponents.filter((o) => !o.folded && !o.sittingOut).length);
  const s = handScore(view.myCards);
  if (view.myCards.length >= 3) return Math.pow(beatProb(s), k);
  return THIRD_CARD.reduce((acc, [v, pv]) => acc + pv * Math.pow(beatProb(s + v), k), 0);
}

interface ProfileParams { callMargin: number; raiseAt: number; bluff: number; restoAt: number; potFrac: number; bluffCall: number }
/** Agresivo es el perfil por defecto: farolea y sube a menudo. */
export const PROFILES: Record<BotProfile, ProfileParams> = {
  conservador: { callMargin: 0.1, raiseAt: 0.85, bluff: 0.03, restoAt: 0.995, potFrac: 0.5, bluffCall: 0.02 },
  equilibrado: { callMargin: 0.03, raiseAt: 0.7, bluff: 0.12, restoAt: 0.97, potFrac: 0.8, bluffCall: 0.06 },
  agresivo: { callMargin: -0.06, raiseAt: 0.55, bluff: 0.3, restoAt: 0.9, potFrac: 1.2, bluffCall: 0.12 },
};
export const DEFAULT_BOT_PROFILE: BotProfile = 'agresivo';

export interface BotDecision { action: Action; reason: string; estimate: number }

/** Tamaño de apuesta: proporcional al pozo, con algo de azar (los faroles usan el mismo tamaño para no delatarse). */
function sizeBet(view: PublicView, pp: ProfileParams, rng: Rng, min: number, max: number): number {
  const target = view.currentBet + Math.max(1, Math.round(view.pot * pp.potFrac * (0.5 + rng.next())));
  return Math.max(min, Math.min(max, target));
}

export function decideBot(view: PublicView, profile: BotProfile, rng: Rng): BotDecision {
  const L = view.legal;
  const pp = PROFILES[profile];
  const p = winEstimate(view);
  const bluff = rng.next() < pp.bluff;

  if (L.anunciar) {
    let amt = L.anunciar.min;
    if (p > pp.raiseAt || bluff) amt = Math.max(amt, Math.min(L.anunciar.max, view.casa + 1 + Math.round(view.pot * pp.potFrac * rng.next())));
    amt = Math.max(L.anunciar.min, Math.min(L.anunciar.max, amt));
    return { action: { type: 'anunciar', amount: amt }, reason: `${bluff ? 'farol ' : ''}anuncio p=${p.toFixed(2)}`, estimate: p };
  }

  if (L.abrir) {
    // Hay que abrir: apostar (fuerza o farol) o retirarse; no existe pasar.
    if (L.resto !== null && p >= pp.restoAt) return { action: { type: 'resto' }, reason: `resto p=${p.toFixed(2)}`, estimate: p };
    if (p >= pp.raiseAt - 0.25 || bluff || rng.next() < 0.5) {
      const amount = sizeBet(view, pp, rng, L.subir!.min, L.subir!.max);
      return { action: { type: 'subir', amount }, reason: `${p >= pp.raiseAt - 0.25 ? 'fuerza' : 'farol'} abre p=${p.toFixed(2)}`, estimate: p };
    }
    return { action: { type: 'noVoy' }, reason: `no abre p=${p.toFixed(2)}`, estimate: p };
  }
  // Ante una apuesta grande, las manos medias se retiran casi siempre y el farol se frena.
  const pressure = L.toCall / Math.max(1, view.pot);
  const big = pressure > 0.5;
  const bluffNow = bluff && (!big || rng.next() < 0.25);
  if (L.resto !== null && p >= pp.restoAt && view.myCards.length === 3) {
    return { action: { type: 'resto' }, reason: `resto p=${p.toFixed(2)}`, estimate: p };
  }
  if (L.subir && (p >= (big ? pp.raiseAt + 0.15 : pp.raiseAt) || bluffNow)) {
    const amount = sizeBet(view, pp, rng, L.subir.min, L.subir.max);
    return { action: { type: 'subir', amount }, reason: `${p >= pp.raiseAt ? 'fuerza' : 'farol'} p=${p.toFixed(2)}`, estimate: p };
  }

  if (L.toCall <= 0) return { action: { type: 'voy' }, reason: 'va sin coste', estimate: p };
  const needed = L.toCall / (view.pot + L.toCall) + pp.callMargin;
  // Una apuesta grande se respeta: hace falta bastante más que las probabilidades del pozo.
  const respect = big ? 0.12 + 0.15 * Math.min(1, pressure) : 0;
  if (p >= needed + respect || rng.next() < (big ? pp.bluffCall * 0.25 : pp.bluffCall)) return { action: { type: 'voy' }, reason: `p=${p.toFixed(2)} vs ${needed.toFixed(2)}`, estimate: p };
  return { action: { type: 'noVoy' }, reason: `p=${p.toFixed(2)} < ${needed.toFixed(2)}`, estimate: p };
}
