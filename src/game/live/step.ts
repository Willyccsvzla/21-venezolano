import {
  applyAction, decideBot, legalActions, minStackToPlay, nextTable, publicView, startHand, DEFAULT_RULES, Rng, RuleError,
  type Action, type HandState, type PublicView, type TableState,
} from "../engine";
import { botStack } from "../packs";
import { BOT_CAST, type PublicRoom } from "./rooms";

export type LiveSeat = {
  id: string;
  userId: string | null;
  name: string;
  avatar: string;
  isBot: boolean;
  credits: number;
  leaving?: boolean;
  seen?: number;
};

export type QueueItem = { userId: string; nick: string; avatar: string; ref: string };

export type LiveRow = {
  id: string;
  name: string;
  casa: number;
  entrada: number;
  code: string | null;
  private: boolean;
  seats: LiveSeat[];
  table: TableState;
  hand: HandState | null;
  queue: QueueItem[];
  actAt: number;
};

const BOT_MS = 1100;
const REVEAL_MS = 2800;
const AFK_MS = 50000;

export type Cashout = { userId: string; amount: number; ref: string };

export function botAt(tableId: string, n: number, used: string[] = []): LiveSeat {
  const free = BOT_CAST.find((b) => !used.includes(b.name)) ?? BOT_CAST[n % BOT_CAST.length];
  const name = used.includes(free.name) ? `${free.name} ${n}` : free.name;
  return { id: `bot-${tableId}-${n}`, userId: null, name, avatar: free.avatar, isBot: true, credits: 0 };
}

export function openTable(spec: PublicRoom, seed: number): LiveRow {
  const seats: LiveSeat[] = [];
  for (let i = 0; i < spec.seats; i++) {
    seats.push({ ...botAt(spec.id, i, seats.map((s) => s.name)), credits: botStack(spec.casa) });
  }
  return {
    id: spec.id,
    name: spec.name,
    casa: spec.casa,
    entrada: spec.entrada,
    code: null,
    private: false,
    seats,
    table: { players: seats.map(seatPlayer), nextMano: 0, handNumber: 1, carry: null, seed },
    hand: null,
    queue: [],
    actAt: 0,
  };
}

function seatPlayer(s: LiveSeat) {
  return { id: s.id, name: s.name, avatar: s.avatar, isBot: s.isBot, profile: "agresivo" as const, credits: s.credits };
}

function syncCredits(seats: LiveSeat[], hand: HandState): LiveSeat[] {
  return seats.map((s, i) => ({ ...s, credits: hand.players[i]?.credits ?? s.credits }));
}

function autoAction(hand: HandState, seat: number, leaving: boolean): Action {
  const L = legalActions(hand, seat);
  if (leaving) {
    if (L.noVoy) return { type: "noVoy" };
    if (L.voy) return { type: "voy" };
    if (L.anunciar) return { type: "anunciar", amount: L.anunciar.min };
    if (L.resto !== null) return { type: "resto" };
    if (L.subir) return { type: "subir", amount: L.subir.min };
  }
  const rng = new Rng((hand.rngState ^ Math.imul((hand.log?.length ?? 0) + 3, 0x9e3779b1) ^ (seat + 1)) >>> 0);
  return decideBot(publicView(hand, seat), "agresivo", rng).action;
}

function play(hand: HandState, seat: number, action: Action): HandState {
  try {
    return applyAction(hand, seat, action);
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    const L = legalActions(hand, seat);
    const fallback: Action | null = L.noVoy
      ? { type: "noVoy" }
      : L.voy
        ? { type: "voy" }
        : L.anunciar
          ? { type: "anunciar", amount: L.anunciar.min }
          : null;
    if (!fallback || fallback.type === action.type) throw e;
    return applyAction(hand, seat, fallback);
  }
}

/** Un paso: o reparte, o un bot actúa, o cierra la mano. No adelanta el turno de una persona. */
export function pump(row: LiveRow, now: number): { row: LiveRow; cashouts: Cashout[] } {
  if (row.queue.length > 0 && !row.seats.some((s) => s.userId && !s.leaving)) {
    row = seatWaiting(row, now);
  }
  if (now < row.actAt) return { row, cashouts: [] };
  if (!row.hand) {
    if (!row.seats.some((s) => s.userId)) return { row, cashouts: [] };
    try {
      const hand = startHand(row.table, { ...DEFAULT_RULES, casa: row.casa });
      return { row: { ...row, hand, actAt: now + 400 }, cashouts: [] };
    } catch {
      return { row: { ...row, actAt: now + 1500 }, cashouts: [] };
    }
  }
  if (row.hand.phase === "terminada") return settle(row, now);

  let seats = row.seats.map((s) => ({ ...s }));
  const turn = row.hand.pending?.[0];
  if (turn === undefined) return { row, cashouts: [] };
  const who = seats[turn];
  if (!who) return { row, cashouts: [] };
  if (!who.isBot && !who.leaving) {
    if (who.seen && now - who.seen > AFK_MS) seats[turn] = { ...who, leaving: true };
    else return { row, cashouts: [] };
  }
  const actor = seats[turn];
  const hand = play(row.hand, turn, autoAction(row.hand, turn, Boolean(actor.leaving && !actor.isBot)));
  seats = syncCredits(seats, hand);
  return {
    row: { ...row, hand, seats, actAt: now + (hand.phase === "terminada" ? REVEAL_MS : BOT_MS) },
    cashouts: [],
  };
}

function settle(row: LiveRow, now: number): { row: LiveRow; cashouts: Cashout[] } {
  const hand = row.hand!;
  let table = nextTable(row.table, hand);
  let seats = row.seats.map((s, i) => ({ ...s, credits: table.players[i].credits }));
  const cashouts: Cashout[] = [];
  seats = seats.map((s, i) => {
    if (!s.userId || !s.leaving) return s;
    cashouts.push({ userId: s.userId, amount: Math.max(0, s.credits), ref: `sale:${row.id}:${hand.handNumber}:${s.userId}` });
    const bot = { ...botAt(row.id, i + hand.handNumber * 10, seats.filter((_, n) => n !== i).map((s) => s.name)), credits: botStack(row.casa) };
    return bot;
  });
  let queue = [...row.queue];
  while (queue.length) {
    const idx = seats.findIndex((s) => s.isBot);
    if (idx < 0) break;
    const q = queue.shift()!;
    seats[idx] = {
      id: q.userId,
      userId: q.userId,
      name: q.nick,
      avatar: q.avatar,
      isBot: false,
      credits: row.entrada,
      seen: now,
    };
  }
  const need = minStackToPlay({ ...DEFAULT_RULES, casa: row.casa });
  seats = seats.map((s) => (s.isBot && s.credits < need ? { ...s, credits: botStack(row.casa) } : s));
  table = { ...table, players: seats.map(seatPlayer) };
  const someone = seats.some((s) => s.userId);
  let next: HandState | null = null;
  if (someone) {
    try {
      next = startHand(table, { ...DEFAULT_RULES, casa: row.casa });
    } catch {
      next = null;
    }
  }
  return { row: { ...row, seats, table, queue, hand: next, actAt: now + 600 }, cashouts };
}

function seatWaiting(row: LiveRow, now: number): LiveRow {
  let seats = row.seats.map((s) => ({ ...s }));
  let queue = [...row.queue];
  while (queue.length) {
    const idx = seats.findIndex((s) => s.isBot);
    if (idx < 0) break;
    const q = queue.shift()!;
    seats[idx] = {
      id: q.userId, userId: q.userId, name: q.nick, avatar: q.avatar, isBot: false, credits: row.entrada, seen: now,
    };
  }
  const table = { ...row.table, players: seats.map(seatPlayer) };
  return { ...row, seats, queue, table, hand: null, actAt: 0 };
}

export function seatIndex(row: LiveRow, userId: string): number {
  return row.seats.findIndex((s) => s.userId === userId);
}

/** Mete a la persona en un puesto de bot. Si la mano apenas empieza, se reparte de nuevo con todos. */
export function takeSeat(row: LiveRow, user: { userId: string; nick: string; avatar: string; ref: string }, now: number): LiveRow {
  if (seatIndex(row, user.userId) >= 0) return touch(row, user.userId, now);
  if (row.queue.some((q) => q.userId === user.userId)) return row;
  const free = row.seats.findIndex((s) => s.isBot);
  if (free < 0) throw new Error("La mesa está llena");
  const humanBusy = Boolean(row.hand && row.hand.phase !== "terminada" && row.hand.phase !== "anuncio" && row.seats.some((s) => s.userId && !s.leaving));
  if (humanBusy) return { ...row, queue: [...row.queue, user] };
  let seats = row.seats.map((s, i) => {
    const hp = row.hand?.players[i];
    const credits = (hp?.credits ?? s.credits) + (hp?.contributed ?? 0);
    return { ...s, credits };
  });
  seats = seats.map((s, i) => i === free
    ? { id: user.userId, userId: user.userId, name: user.nick, avatar: user.avatar, isBot: false, credits: row.entrada, seen: now }
    : s);
  const table = { ...row.table, players: seats.map(seatPlayer) };
  return { ...row, seats, table, hand: null, actAt: 0 };
}

export function touch(row: LiveRow, userId: string, now: number): LiveRow {
  const i = seatIndex(row, userId);
  if (i < 0) return row;
  const seats = row.seats.map((s, n) => n === i ? { ...s, seen: now } : s);
  return { ...row, seats };
}

export function markLeave(row: LiveRow, userId: string): { row: LiveRow; refund: QueueItem | null } {
  const q = row.queue.find((x) => x.userId === userId);
  if (q) return { row: { ...row, queue: row.queue.filter((x) => x.userId !== userId) }, refund: q };
  const i = seatIndex(row, userId);
  if (i < 0) return { row, refund: null };
  if (!row.hand || row.hand.phase === "terminada") {
    const seats = row.seats.map((s, n) => n === i ? { ...s, leaving: true } : s);
    return { row: { ...row, seats, actAt: 0 }, refund: null };
  }
  const seats = row.seats.map((s, n) => n === i ? { ...s, leaving: true } : s);
  return { row: { ...row, seats }, refund: null };
}

export type Snap = {
  tableId: string;
  name: string;
  casa: number;
  entrada: number;
  code: string | null;
  waiting: boolean;
  seat: number;
  pot: number;
  currentBet: number;
  raisesUsed: number;
  phase: string;
  handNumber: number;
  mano: number;
  turnSeat: number;
  you: { name: string; avatar: string; credits: number; contributed: number; folded: boolean; cards: PublicView["myCards"] };
  opponents: {
    seat: number; name: string; avatar: string; isBot: boolean; credits: number; contributed: number;
    folded: boolean; sittingOut: boolean; lastAction?: string; cardCount: number; revealed: PublicView["myCards"];
  }[];
  legal: PublicView["legal"] | null;
  result: HandState["result"];
  log: string[];
  humans: number;
  waitingNames: string[];
};

export function snapOf(row: LiveRow, userId: string): Snap | null {
  const waiting = row.queue.some((q) => q.userId === userId);
  const seat = seatIndex(row, userId);
  if (seat < 0 && !waiting) return null;
  const hand = row.hand;
  const view = hand && seat >= 0 ? publicView(hand, seat) : null;
  const me = seat >= 0 ? row.seats[seat] : null;
  const opponents = row.seats.map((s, i) => ({ s, i })).filter((x) => x.i !== seat);
  return {
    tableId: row.id,
    name: row.name,
    casa: row.casa,
    entrada: row.entrada,
    code: row.code,
    waiting,
    seat,
    pot: hand?.pot ?? 0,
    currentBet: hand?.currentBet ?? row.casa,
    raisesUsed: hand?.raisesUsed ?? 0,
    phase: hand?.phase ?? "espera",
    handNumber: hand?.handNumber ?? row.table.handNumber,
    mano: hand?.mano ?? -1,
    turnSeat: hand && hand.phase !== "terminada" ? (hand.pending[0] ?? -1) : -1,
    you: {
      name: me?.name ?? row.queue.find((q) => q.userId === userId)?.nick ?? "",
      avatar: me?.avatar ?? row.queue.find((q) => q.userId === userId)?.avatar ?? "",
      credits: view?.myCredits ?? me?.credits ?? 0,
      contributed: hand && seat >= 0 ? hand.players[seat].contributed : 0,
      folded: hand && seat >= 0 ? hand.players[seat].folded : false,
      cards: view?.myCards ?? [],
    },
    opponents: opponents.map(({ s, i }) => {
      const hp = hand?.players[i];
      const cards = hp?.cards ?? [];
      return {
        seat: i,
        name: s.name,
        avatar: s.avatar,
        isBot: s.isBot,
        credits: hp?.credits ?? s.credits,
        contributed: hp?.contributed ?? 0,
        folded: hp?.folded ?? false,
        sittingOut: hp?.sittingOut ?? false,
        lastAction: hp?.lastAction,
        cardCount: cards.length,
        revealed: view?.revealed?.[i] ?? [],
      };
    }),
    legal: view && view.legal.isTurn ? view.legal : view ? { ...view.legal, isTurn: false } : null,
    result: hand?.phase === "terminada" ? hand.result : null,
    log: (hand?.log ?? []).slice(-20).map((e) => e.text),
    humans: row.seats.filter((s) => !s.isBot).length + row.queue.length,
    waitingNames: row.queue.map((q) => q.nick),
  };
}
