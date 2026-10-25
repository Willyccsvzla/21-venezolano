import { Rng } from './rng';

export type Suit = 'oros' | 'copas' | 'espadas' | 'bastos';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12;
export interface Card {
  suit: Suit;
  rank: Rank;
  id: string;
}

export const SUITS: Suit[] = ['oros', 'copas', 'espadas', 'bastos'];
/** Baraja española sin ochos ni nueves: As–7 y Sota(10), Caballo(11), Rey(12). */
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export const RANK_NAME: Record<Rank, string> = {
  1: 'As', 2: 'Dos', 3: 'Tres', 4: 'Cuatro', 5: 'Cinco', 6: 'Seis', 7: 'Siete',
  10: 'Sota', 11: 'Caballo', 12: 'Rey',
};
export const SUIT_NAME: Record<Suit, string> = {
  oros: 'Oros', copas: 'Copas', espadas: 'Espadas', bastos: 'Bastos',
};

export function cardName(c: Card): string {
  return `${RANK_NAME[c.rank]} de ${SUIT_NAME[c.suit]}`;
}

/** 4 palos × 10 cartas = 40 cartas (la baraja de 48 sin 8 y 9). */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank, id: `${rank}-${suit}` });
  return deck;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** As = 1, 2–7 = su número, Sota/Caballo/Rey = 0. */
export function cardValue(c: Card): number {
  return c.rank >= 10 ? 0 : c.rank;
}

/** Suma ordinaria. Tres ases = 3 (no es victoria automática). */
export function handScore(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardValue(c), 0);
}

export function isBust(cards: Card[]): boolean {
  return handScore(cards) > 21;
}

export function isTresSietes(cards: Card[]): boolean {
  return cards.length === 3 && cards.every((c) => c.rank === 7);
}
export function isTresAses(cards: Card[]): boolean {
  return cards.length === 3 && cards.every((c) => c.rank === 1);
}
