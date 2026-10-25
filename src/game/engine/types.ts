import type { Card } from './cards';

export type BotProfile = 'conservador' | 'equilibrado' | 'agresivo';

export interface RuleConfig {
  /** Casa o apuesta base que pone cada jugador antes de repartir. */
  casa: number;
  /** Máximo de subidas por mano (transcripción: "Solo dos veces se sube la apuesta"). El anuncio inicial de la mano no cuenta. */
  /** Límite de subidas por mano; null = sin límite (regla de Willy: «no hay límite»). */
  maxSubidas: number | null;
  /** Anuncio mínimo de la mano (total). Por defecto casa + 1 ("dos" con casa 1). PENDIENTE: ¿se puede anunciar solo la casa? */
  anuncioMinimo?: number;
  /** "la mano agarra todo del pozo y deja solo su casa": si la mano gana por retirada, su casa queda en el pozo de la siguiente mano. */
  manoDejaCasa: boolean;
  /** Permitir "mi resto contra tu resto". */
  restoHabilitado: boolean;
  /** PENDIENTE: el resto cuenta como una de las subidas. */
  restoCuentaComoSubida: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  casa: 1,
  maxSubidas: null,
  manoDejaCasa: true,
  restoHabilitado: true,
  restoCuentaComoSubida: true,
};

export interface SeatPlayer {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  profile?: BotProfile;
  credits: number;
}

export interface PlayerState extends SeatPlayer {
  seat: number;
  /** Total aportado a esta mano (incluye la casa). */
  contributed: number;
  folded: boolean;
  /** No participa (no pudo cubrir la casa). */
  sittingOut: boolean;
  cards: Card[];
  lastAction?: string;
}

export type Phase = 'anuncio' | 'ronda1' | 'ronda2' | 'terminada';

export type Action =
  | { type: 'anunciar'; amount: number }
  | { type: 'voy' }
  | { type: 'noVoy' }
  | { type: 'subir'; amount: number }
  | { type: 'resto' };

export type WinReason = 'retirada' | 'puntuacion';

export interface HandResult {
  winnerSeat: number;
  reason: WinReason;
  pot: number;
  /** Lo que recibe el ganador. */
  won: number;
  /** Lo que queda en el pozo para la siguiente mano (casa de la mano). */
  carryOver: number;
  /** Solo en comparación (alguien fue a ver). En victoria por retirada queda vacío: no se revelan puntos. */
  scores: { seat: number; score: number; bust: boolean }[];
  /** Reparto por asiento (incluye botes secundarios por all-in). */
  payouts: Record<number, number>;
  tie: boolean;
}

export interface LogEntry {
  n: number;
  seat: number | null;
  text: string;
}

export interface Carry {
  /** Jugador cuya casa ya está puesta en el pozo para la siguiente mano. */
  playerId: string;
  amount: number;
}

export interface HandState {
  handNumber: number;
  config: RuleConfig;
  phase: Phase;
  players: PlayerState[];
  deck: Card[];
  /** Asientos en orden de reparto (empieza por la mano). */
  dealOrder: number[];
  originalMano: number;
  mano: number;
  pot: number;
  currentBet: number;
  raisesUsed: number;
  lastRaiser: number | null;
  /** Si quien hizo la última apuesta/subida era la mano en ese momento. */
  lastRaiserWasMano: boolean;
  /** Ronda 2 sin apuesta todavía: el que habla debe apostar (o no ir). No hay comparación sin apuesta igualada. */
  mustOpen: boolean;
  /** Jugadores que aún deben actuar en la ronda actual, en orden horario. */
  pending: number[];
  log: LogEntry[];
  result: HandResult | null;
  rngState: number;
}

export interface TableState {
  players: SeatPlayer[];
  nextMano: number;
  handNumber: number;
  carry: Carry | null;
  seed: number;
}
