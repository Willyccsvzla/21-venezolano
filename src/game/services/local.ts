import type { Room, RoomService } from "./backend";

const roomsKey = (userId: string) => `v21.rooms.${userId}`;

const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

const BOT_NAMES: Room["bots"] = [
  { name: "Don Chepe", avatar: "🧔", profile: "agresivo" },
  { name: "La Negra", avatar: "👩🏽", profile: "agresivo" },
  { name: "El Catire", avatar: "👱🏻‍♂️", profile: "agresivo" },
  { name: "Doña Rosa", avatar: "👵🏽", profile: "agresivo" },
  { name: "Pancho", avatar: "🧑🏾", profile: "agresivo" },
  { name: "Maite", avatar: "👩🏻‍🦱", profile: "agresivo" },
  { name: "El Gocho", avatar: "🤠", profile: "agresivo" },
  { name: "Yoli", avatar: "👩🏾‍🦰", profile: "agresivo" },
];
const pick = (start: number, n: number) => Array.from({ length: n }, (_, i) => BOT_NAMES[(start + i) % BOT_NAMES.length]);

const PUBLIC_ROOMS: Room[] = [
  { id: "r1", name: "Mesa de práctica", casa: 1, entrada: 20, seats: 3, bots: pick(0, 2), private: false, occupied: 2 },
  { id: "r2", name: "El Rincón Llanero", casa: 1, entrada: 30, seats: 4, bots: pick(1, 3), private: false, occupied: 3 },
  { id: "r3", name: "Bodegón Caracas", casa: 2, entrada: 60, seats: 4, bots: pick(3, 3), private: false, occupied: 3 },
  { id: "r4", name: "La Gallera", casa: 5, entrada: 150, seats: 5, bots: pick(2, 4), private: false, occupied: 4 },
  { id: "r5", name: "Club Maracaibo", casa: 10, entrada: 300, seats: 6, bots: pick(4, 5), private: false, occupied: 5 },
];

export function roomsFor(userId: string): RoomService {
  const key = roomsKey(userId);
  return {
    list: () => [...PUBLIC_ROOMS, ...read<Room[]>(key, [])],
    createPrivate(name, casa, bots) {
      const code = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      const room: Room = {
        id: "p-" + code,
        name: name || "Mesa privada",
        casa,
        entrada: casa * 30,
        seats: bots + 1,
        bots: pick(Math.floor(Math.random() * 8), bots),
        private: true,
        code,
        occupied: bots,
      };
      const all = read<Room[]>(key, []);
      write(key, [...all.slice(-3), room]);
      return room;
    },
    findByCode(code) {
      return this.list().find((r) => r.code === code.trim().toUpperCase()) ?? null;
    },
  };
}
