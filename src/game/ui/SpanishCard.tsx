/*
 * Baraja española clásica: naipes de Heraclio Fournier, 1878 (diseño de Ignacio Díaz Olano y Emilio Soubrier),
 * escaneos del Museo Fournier de Naipes (Bibat, Vitoria-Gasteiz) publicados en Wikimedia Commons como DOMINIO PÚBLICO.
 * Ver src/assets/cards/LICENSES.json y CREDITOS.md. Recortados, limpiados y convertidos a WebP.
 */
import type { CSSProperties } from "react";
import type { Card } from "../engine";
import { cardName } from "../engine";

const files = import.meta.glob('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const url = (k: string) => files[`../assets/cards/${k}.webp`];

export const CARD_RATIO = 440 / 695;

export function SpanishCard({ card, className, style }: { card: Card; className?: string; style?: CSSProperties }) {
  return (
    <img className={`naipe ${className ?? ''}`} style={style} src={url(`${card.rank}-${card.suit}`)} alt={cardName(card)}
      data-card={card.id} draggable={false} decoding="async" />
  );
}

export function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return <img className={`naipe ${className ?? ''}`} style={style} src={url('back')} alt="" aria-hidden draggable={false} />;
}
