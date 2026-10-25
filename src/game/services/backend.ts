/**
 * Capa de servicios. La versión 1 usa almacenamiento local (sin servidor).
 * Para el multijugador real (Fase 3) se implementarán estas mismas interfaces con Supabase:
 *  - AuthService  -> supabase.auth (login anónimo / email)
 *  - WalletService -> tabla `ledger` + función RPC `apply_ledger` (el servidor es la única autoridad del saldo)
 *  - RoomService  -> tablas `rooms`, `room_players` + Realtime channels
 *  - El motor (src/engine) se ejecuta en una Edge Function; el cliente solo recibe `publicView`.
 * Nada de esto toca dinero real: los créditos son virtuales y sin valor.
 */
export interface Profile {
  id: string;
  nick: string;
  avatar: string;
  testMode: boolean;
  createdAt: number;
}

export type LedgerKind = 'bono_inicial' | 'compra_simulada' | 'entrada_mesa' | 'salida_mesa' | 'reinicio_prueba';
export interface LedgerEntry {
  id: string;
  at: number;
  kind: LedgerKind;
  amount: number;
  balance: number;
  ref?: string;
}

export interface Room {
  id: string;
  name: string;
  casa: number;
  entrada: number;
  seats: number;
  bots: { name: string; avatar: string; profile: 'conservador' | 'equilibrado' | 'agresivo' }[];
  private: boolean;
  code?: string;
  /** Jugadores "conectados" simulados (solo decorativo en v1). */
  occupied: number;
}

export interface AuthService {
  current(): Profile | null;
  login(nick: string, avatar: string, testMode: boolean): Profile;
  logout(): void;
}
export interface WalletService {
  balance(): number;
  ledger(): LedgerEntry[];
  apply(kind: LedgerKind, amount: number, ref?: string): number;
  reset(): void;
}
export interface RoomService {
  list(): Room[];
  createPrivate(name: string, casa: number, bots: number): Room;
  findByCode(code: string): Room | null;
}
