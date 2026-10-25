export type PublicRoom = {
  id: string;
  name: string;
  casa: number;
  entrada: number;
  seats: number;
};

export const PUBLIC_ROOMS: PublicRoom[] = [
  { id: "r1", name: "Mesa de práctica", casa: 1, entrada: 20, seats: 3 },
  { id: "r2", name: "El Rincón Llanero", casa: 1, entrada: 30, seats: 4 },
  { id: "r3", name: "Bodegón Caracas", casa: 2, entrada: 60, seats: 4 },
  { id: "r4", name: "La Gallera", casa: 5, entrada: 150, seats: 5 },
  { id: "r5", name: "Club Maracaibo", casa: 10, entrada: 300, seats: 6 },
];

export const BOT_CAST = [
  { name: "Don Chepe", avatar: "🧔" },
  { name: "La Negra", avatar: "👩🏽" },
  { name: "El Catire", avatar: "👱🏻‍♂️" },
  { name: "Doña Rosa", avatar: "👵" },
  { name: "Pancho", avatar: "🧑" },
  { name: "Maite", avatar: "👩" },
  { name: "El Gocho", avatar: "🤠" },
  { name: "Yoli", avatar: "👩" },
] as const;
