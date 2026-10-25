/**
 * Motor de reglas del 21 Venezolano. Módulo puro: no toca la interfaz ni el almacenamiento.
 * Todas las funciones devuelven un estado nuevo (no mutan la entrada).
 * Pensado para ejecutarse igual en el cliente (modo bots) o en un servidor (futuro backend Supabase/Edge).
 *
 * Apuestas sin tope de mesa: cada jugador puede apostar hasta todo su saldo. Quien no alcanza a igualar
 * va «con todo» (all-in) y solo compite por la parte del pozo que cubrió (botes secundarios).
 */
import { createDeck, handScore, isBust, shuffle, cardName } from './cards';
import { Rng } from './rng';
import type {
  Action, HandResult, HandState, PlayerState, RuleConfig, TableState, WinReason,
} from './types';

export class RuleError extends Error {}

const clone = <T>(x: T): T => structuredClone(x);

function log(s: HandState, seat: number | null, text: string) {
  s.log.push({ n: s.log.length + 1, seat, text });
}

export function isActive(p: PlayerState): boolean {
  return !p.folded && !p.sittingOut;
}
/** Activo y con saldo para seguir actuando (no está all-in). */
function canAct(p: PlayerState): boolean {
  return isActive(p) && p.credits > 0;
}

export function activeSeats(s: HandState): number[] {
  return s.players.filter(isActive).map((p) => p.seat);
}

/** Asientos activos en sentido horario empezando en `from` (incluido si includeFrom). */
export function clockwise(s: HandState, from: number, includeFrom: boolean, pred: (p: PlayerState) => boolean = isActive): number[] {
  const n = s.players.length;
  const out: number[] = [];
  for (let k = includeFrom ? 0 : 1; k < n; k++) {
    const seat = (from + k) % n;
    if (pred(s.players[seat])) out.push(seat);
  }
  return out;
}

export function minAnnounce(cfg: RuleConfig): number {
  return cfg.anuncioMinimo ?? cfg.casa + 1;
}

/** Máximo que puede apostar un jugador: todo lo suyo (aporte + saldo). Sin tope de mesa. */
export function stackOf(s: HandState, seat: number): number {
  const p = s.players[seat];
  return p.contributed + p.credits;
}

/** Pone hasta `total` (o todo lo que tenga si no alcanza: all-in). */
function put(s: HandState, seat: number, total: number) {
  const p = s.players[seat];
  const extra = Math.min(total - p.contributed, p.credits);
  if (extra <= 0) return;
  p.credits -= extra;
  p.contributed += extra;
  s.pot += extra;
}

export interface Legal {
  isTurn: boolean;
  phase: HandState['phase'];
  /** Lo que falta para igualar (limitado a su saldo: si no alcanza, va con todo). */
  toCall: number;
  allInCall: boolean;
  anunciar: { min: number; max: number } | null;
  /** true si hay que abrir la apuesta (ronda 2): no se puede pasar. */
  abrir: boolean;
  voy: boolean;
  noVoy: boolean;
  subir: { min: number; max: number } | null;
  resto: number | null;
}

/** Tope de la ronda 1: nadie puede quedar con todo antes de la tercera carta,
 *  así a todos los que siguen les queda saldo para la ronda final de apuestas. */
export function minStackToPlay(cfg: RuleConfig): number {
  return minAnnounce(cfg) + 1;
}

export function round1Cap(s: HandState): number {
  const stacks = activeSeats(s).map((x) => stackOf(s, x));
  return Math.max(0, Math.min(...stacks) - 1);
}

export function legalActions(s: HandState, seat: number): Legal {
  const p = s.players[seat];
  const isTurn = s.phase !== 'terminada' && s.pending[0] === seat;
  const none: Legal = { isTurn, phase: s.phase, toCall: 0, allInCall: false, anunciar: null, abrir: false, voy: false, noVoy: false, subir: null, resto: null };
  if (!isTurn || !p || !canAct(p)) return { ...none, isTurn: false };
  const stack = stackOf(s, seat);
  if (s.phase === 'anuncio') {
    const min = Math.min(minAnnounce(s.config), stack);
    return { ...none, anunciar: { min, max: Math.max(min, Math.min(stack, round1Cap(s))) } };
  }
  if (s.mustOpen) {
    const canOpen = stack > s.currentBet && clockwise(s, seat, false, canAct).length > 0;
    if (canOpen) return { ...none, abrir: true, noVoy: true, subir: { min: s.currentBet + 1, max: stack }, resto: s.config.restoHabilitado ? stack : null };
    // Sin saldo para apostar más: solo puede quedarse (ya igualó la apuesta anterior) o retirarse.
    return { ...none, voy: true, noVoy: true };
  }
  const need = s.currentBet - p.contributed;
  const toCall = Math.min(need, p.credits);
  // Subir solo tiene sentido si queda algún rival que pueda responder.
  const someoneCanAnswer = clockwise(s, seat, false, canAct).length > 0;
  const maxBet = s.phase === 'ronda1' ? Math.min(stack, round1Cap(s)) : stack;
  const canRaise = maxBet > s.currentBet && (s.config.maxSubidas == null || s.raisesUsed < s.config.maxSubidas) && stack > s.currentBet && someoneCanAnswer;
  return {
    ...none,
    toCall,
    allInCall: need > 0 && need >= p.credits,
    voy: true,
    noVoy: need > 0,
    subir: canRaise ? { min: s.currentBet + 1, max: maxBet } : null,
    // El resto (todo el saldo) es de la ronda final.
    resto: canRaise && s.phase === 'ronda2' && s.config.restoHabilitado ? stack : null,
  };
}

export function startHand(table: TableState, config: RuleConfig): HandState {
  const rng = new Rng((table.seed ^ Math.imul(table.handNumber + 1, 0x9e3779b1)) >>> 0);
  const n = table.players.length;
  const carry = table.carry;
  const players: PlayerState[] = table.players.map((sp, seat) => {
    const prepaid = carry && carry.playerId === sp.id ? carry.amount : 0;
    // Para jugar hace falta la casa + 1 para el anuncio mínimo + 1 para la ronda final,
    // así nadie entra (ni queda) con todo antes de la tercera carta.
    const eligible = sp.credits + (prepaid >= config.casa ? config.casa : 0) >= minStackToPlay(config);
    return {
      ...clone(sp), seat, contributed: 0, folded: false, sittingOut: !eligible, cards: [], lastAction: eligible ? undefined : 'Sin créditos',
    };
  });
  if (players.filter((p) => !p.sittingOut).length < 2) throw new RuleError('Se necesitan al menos 2 jugadores con créditos para la casa');

  const s: HandState = {
    handNumber: table.handNumber,
    config: clone(config),
    phase: 'anuncio',
    players,
    deck: [],
    dealOrder: [],
    originalMano: 0,
    mano: 0,
    pot: 0,
    currentBet: config.casa,
    raisesUsed: 0,
    mustOpen: false,
    lastRaiser: null,
    lastRaiserWasMano: false,
    pending: [],
    log: [],
    result: null,
    rngState: 0,
  };
  let mano = ((table.nextMano % n) + n) % n;
  for (let k = 0; k < n && players[mano].sittingOut; k++) mano = (mano + 1) % n;
  s.mano = s.originalMano = mano;

  for (const p of players) {
    if (p.sittingOut) continue;
    if (carry && carry.playerId === p.id) {
      // Su casa ya estaba en el pozo (la dejó al ganar por retirada siendo mano).
      p.contributed = Math.min(carry.amount, config.casa);
      s.pot += carry.amount;
    }
    put(s, p.seat, config.casa);
  }
  if (carry && !players.some((p) => !p.sittingOut && p.id === carry.playerId)) s.pot += carry.amount;
  log(s, null, `Mano ${s.handNumber}: todos ponen la casa (${config.casa}). Pozo ${s.pot}.`);

  s.deck = shuffle(createDeck(), rng);
  s.dealOrder = clockwise(s, mano, true);
  for (let r = 0; r < 2; r++) for (const seat of s.dealOrder) s.players[seat].cards.push(s.deck.shift()!);
  log(s, null, `Se reparten 2 cartas. Es mano ${players[mano].name}.`);
  s.pending = canAct(players[mano]) ? [mano] : [];
  s.rngState = rng.state;
  if (s.pending.length === 0) {
    s.phase = 'ronda1';
    return advance(s);
  }
  return s;
}

export function applyAction(state: HandState, seat: number, action: Action): HandState {
  if (state.phase === 'terminada') throw new RuleError('La mano ya terminó');
  if (state.pending[0] !== seat) throw new RuleError('Acción fuera de turno');
  const s = clone(state);
  const p = s.players[seat];
  const legal = legalActions(s, seat);

  switch (action.type) {
    case 'anunciar': {
      if (!legal.anunciar) throw new RuleError('Solo la mano anuncia, al inicio');
      const a = Math.floor(action.amount);
      if (a < legal.anunciar.min || a > legal.anunciar.max) throw new RuleError(`Anuncio fuera de rango (${legal.anunciar.min}–${legal.anunciar.max})`);
      put(s, seat, a);
      s.currentBet = a;
      s.lastRaiser = seat;
      s.lastRaiserWasMano = true;
      s.phase = 'ronda1';
      p.lastAction = `Anuncia ${a}`;
      log(s, seat, `${p.name} (mano) anuncia ${a}.`);
      s.pending = clockwise(s, seat, false, canAct);
      break;
    }
    case 'voy': {
      if (!legal.voy) throw new RuleError('No puedes ir ahora');
      put(s, seat, s.currentBet);
      const allIn = p.credits === 0 && p.contributed < s.currentBet;
      p.lastAction = allIn ? `Va con todo (${p.contributed})` : legal.toCall > 0 ? `Va ${s.currentBet}` : 'Va';
      log(s, seat, allIn ? `${p.name} va con todo (${p.contributed}).` : legal.toCall > 0 ? `${p.name} va (${s.currentBet}).` : `${p.name} va sin subir.`);
      s.pending.shift();
      break;
    }
    case 'noVoy': {
      if (!legal.noVoy) throw new RuleError('No hay apuesta que rechazar');
      p.folded = true;
      p.lastAction = 'No va';
      log(s, seat, `${p.name} no va y pierde lo aportado (${p.contributed}).`);
      s.pending.shift();
      if (seat === s.mano) {
        const next = clockwise(s, seat, false)[0];
        if (next !== undefined) {
          s.mano = next;
          log(s, null, `La mano pasa a ${s.players[next].name} en esta partida.`);
        }
      }
      break;
    }
    case 'subir':
    case 'resto': {
      const isResto = action.type === 'resto';
      if (isResto ? legal.resto === null : !legal.subir) throw new RuleError('No quedan subidas disponibles');
      const amount = isResto ? legal.resto! : Math.floor(action.amount);
      if (!isResto && (amount < legal.subir!.min || amount > legal.subir!.max)) throw new RuleError(`Subida fuera de rango (${legal.subir!.min}–${legal.subir!.max})`);
      put(s, seat, amount);
      s.currentBet = amount;
      const opening = s.mustOpen;
      if (!opening && (!isResto || s.config.restoCuentaComoSubida)) s.raisesUsed++;
      s.mustOpen = false;
      s.lastRaiser = seat;
      s.lastRaiserWasMano = seat === s.mano;
      p.lastAction = isResto ? `¡Resto! (${amount})` : `Sube a ${amount}`;
      log(s, seat, isResto ? `${p.name} canta «mi resto contra tu resto»: ${amount}.` : opening ? `${p.name} apuesta ${amount}.` : `${p.name} sube a ${amount}.`);
      if (opening) p.lastAction = isResto ? `¡Resto! (${amount})` : `Apuesta ${amount}`;
      s.pending = clockwise(s, seat, false, canAct);
      break;
    }
    default:
      throw new RuleError('Acción desconocida');
  }
  return advance(s);
}


function advance(s: HandState): HandState {
  const act = activeSeats(s);
  if (act.length === 1) return finish(s, act[0], 'retirada');
  if (s.pending.length > 0) return s;
  if (s.phase === 'ronda1') {
    for (const seat of s.dealOrder) if (isActive(s.players[seat])) s.players[seat].cards.push(s.deck.shift()!);
    s.phase = 'ronda2';
    log(s, null, 'Tercera carta para quienes van.');
    // Sin final automático: alguien tiene que apostar y otro igualar para ver cartas.
    // La apuesta de apertura no cuenta como subida, aunque se hayan agotado.
    if (s.players.filter(canAct).length >= 2) {
      s.mustOpen = true;
      for (const x of s.players) if (isActive(x)) x.lastAction = undefined;
      s.pending = clockwise(s, s.mano, true, canAct);
      log(s, null, 'Hay que apostar: habla la mano.');
      return s;
    }
    // Todos menos uno están con todo: la apuesta anterior ya fue igualada.
    log(s, null, 'Apuesta igualada con todo: se voltean las cartas.');
    return showdown(s);
  }
  // Ronda 2: solo se llega aquí con una apuesta igualada (o nadie pudo apostar más tras igualar).
  return showdown(s);
}

/** Orden de prioridad para desempate: la mano primero y luego en sentido horario. */
export function priorityOrder(s: HandState): number[] {
  return clockwise(s, s.mano, true);
}

function bestOf(s: HandState, seats: number[]): { seat: number; tie: boolean } {
  const order = priorityOrder(s).filter((x) => seats.includes(x));
  const sc = order.map((seat) => ({ seat, score: handScore(s.players[seat].cards), bust: isBust(s.players[seat].cards) }));
  const valid = sc.filter((x) => !x.bust);
  if (valid.length === 0) return { seat: order[0], tie: false };
  const best = Math.max(...valid.map((x) => x.score));
  const top = valid.filter((x) => x.score === best);
  return { seat: top[0].seat, tie: top.length > 1 };
}

export function rankShowdown(s: HandState): { winner: number; tie: boolean; scores: HandResult['scores'] } {
  const order = priorityOrder(s);
  const scores = order.map((seat) => ({ seat, score: handScore(s.players[seat].cards), bust: isBust(s.players[seat].cards) }));
  const b = bestOf(s, order);
  return { winner: b.seat, tie: b.tie, scores };
}

/** Reparto con botes secundarios: cada nivel de aporte lo gana el mejor jugador que lo cubrió. */
export function splitPots(s: HandState): Record<number, number> {
  const live = activeSeats(s);
  const levels = [...new Set(live.map((seat) => s.players[seat].contributed))].sort((a, b) => a - b);
  const payouts: Record<number, number> = {};
  let prev = 0;
  let distributed = 0;
  for (const lvl of levels) {
    const part = s.players.reduce((a, p) => a + Math.max(0, Math.min(p.contributed, lvl) - Math.min(p.contributed, prev)), 0);
    const eligible = live.filter((seat) => s.players[seat].contributed >= lvl);
    const w = bestOf(s, eligible).seat;
    payouts[w] = (payouts[w] ?? 0) + part;
    distributed += part;
    prev = lvl;
  }
  const rest = s.pot - distributed; // pozo arrastrado y aportes de retirados por encima del último nivel
  if (rest > 0) {
    const w = bestOf(s, live).seat;
    payouts[w] = (payouts[w] ?? 0) + rest;
  }
  return payouts;
}

function showdown(s: HandState): HandState {
  const r = rankShowdown(s);
  for (const x of r.scores) log(s, x.seat, `${s.players[x.seat].name}: ${s.players[x.seat].cards.map(cardName).join(', ')} = ${x.score}${x.bust ? ' (se pasa)' : ''}.`);
  return finish(s, r.winner, 'puntuacion', r);
}

function finish(s: HandState, winner: number, reason: WinReason, r?: ReturnType<typeof rankShowdown>): HandState {
  const pot = s.pot;
  let carryOver = 0;
  let payouts: Record<number, number>;
  if (reason === 'retirada') {
    // Farol permitido: nadie fue a ver, no se muestran cartas ni puntos de nadie.
    if (winner === s.lastRaiser && s.lastRaiserWasMano && s.config.manoDejaCasa && pot > s.config.casa) carryOver = s.config.casa;
    payouts = { [winner]: pot - carryOver };
  } else {
    payouts = splitPots(s);
  }
  for (const [seat, amt] of Object.entries(payouts)) s.players[Number(seat)].credits += amt;
  const won = payouts[winner] ?? 0;
  s.result = { winnerSeat: winner, reason, pot, won, carryOver, scores: r?.scores ?? [], tie: r?.tie ?? false, payouts };
  s.pending = [];
  s.phase = 'terminada';
  s.pot = carryOver;
  const w = s.players[winner];
  if (reason === 'retirada') {
    log(s, winner, `${w.name} gana ${won} sin mostrar cartas (nadie fue)${carryOver ? ` y deja su casa (${carryOver}) en el pozo` : ''}.`);
  } else {
    log(s, winner, `${w.name} gana ${won} con ${handScore(w.cards)} puntos${r?.tie ? ' (empate: gana quien es mano)' : ''}.`);
    for (const [seat, amt] of Object.entries(payouts)) if (Number(seat) !== winner) log(s, Number(seat), `${s.players[Number(seat)].name} gana un bote secundario de ${amt}.`);
  }
  return s;
}

/** Aplica el resultado a la mesa y prepara la siguiente mano. La mano rota siempre un asiento en sentido horario. */
export function nextTable(table: TableState, hand: HandState): TableState {
  if (hand.phase !== 'terminada' || !hand.result) throw new RuleError('La mano no ha terminado');
  const n = table.players.length;
  const players = table.players.map((sp, i) => ({ ...sp, credits: hand.players[i].credits }));
  const nextMano = (hand.originalMano + 1) % n;
  const carry = hand.result.carryOver > 0 ? { playerId: hand.players[hand.result.winnerSeat].id, amount: hand.result.carryOver } : null;
  return { ...table, players, nextMano, handNumber: table.handNumber + 1, carry };
}

/** Créditos totales en juego (saldos + pozo). Debe conservarse. */
export function totalCredits(s: HandState): number {
  return s.players.reduce((a, p) => a + p.credits, 0) + s.pot;
}

/** Vista pública para un asiento: oculta las cartas de los demás (lo que verían un bot o un cliente remoto). */
export interface PublicView {
  seat: number;
  myCards: HandState['players'][number]['cards'];
  phase: HandState['phase'];
  pot: number;
  currentBet: number;
  raisesUsed: number;
  maxSubidas: number | null;
  mano: number;
  casa: number;
  myCredits: number;
  legal: Legal;
  opponents: { seat: number; name: string; credits: number; contributed: number; folded: boolean; sittingOut: boolean; cardCount: number; lastAction?: string }[];
  /** Cartas visibles de rivales: solo tras una comparación (alguien fue a ver). Nunca en victoria por retirada. */
  revealed: Record<number, HandState['players'][number]['cards']>;
}

export function publicView(s: HandState, seat: number): PublicView {
  const revealed: PublicView['revealed'] = {};
  if (s.phase === 'terminada' && s.result?.reason === 'puntuacion') for (const x of s.result.scores) revealed[x.seat] = clone(s.players[x.seat].cards);
  return {
    seat,
    myCards: clone(s.players[seat]?.cards ?? []),
    phase: s.phase,
    pot: s.pot,
    currentBet: s.currentBet,
    raisesUsed: s.raisesUsed,
    maxSubidas: s.config.maxSubidas,
    mano: s.mano,
    casa: s.config.casa,
    myCredits: s.players[seat].credits,
    legal: legalActions(s, seat),
    opponents: s.players.filter((p) => p.seat !== seat).map((p) => ({
      seat: p.seat, name: p.name, credits: p.credits, contributed: p.contributed, folded: p.folded, sittingOut: p.sittingOut, cardCount: p.cards?.length ?? 0, lastAction: p.lastAction,
    })),
    revealed,
  };
}
/** Compatibilidad: tope previo eliminado. */
export const betCap = (s: HandState) => Math.max(...activeSeats(s).map((seat) => stackOf(s, seat)));
