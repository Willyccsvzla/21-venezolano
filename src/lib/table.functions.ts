import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { TOPE_BOTS } from "@/game/packs";
import { PUBLIC_ROOMS } from "@/game/live/rooms";
import {
  markLeave, openTable, pump, seatIndex, snapOf, takeSeat, touch,
  type LiveRow, type LiveSeat, type QueueItem, type Snap,
} from "@/game/live/step";
import type { Action, HandState, TableState } from "@/game/engine";

type RoomCard = {
  id: string;
  name: string;
  casa: number;
  entrada: number;
  seats: number;
  occupied: number;
  humans: number;
  private: boolean;
  code?: string;
  bots: { name: string; avatar: string; profile: "agresivo" }[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parse<T>(v: unknown, fallback: T): T {
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  if (v && typeof v === "object") return v as T;
  return fallback;
}

type DbRow = {
  id: string; name: string; casa: number; entrada: number; code: string | null; private: boolean;
  seats: unknown; table_state: unknown; hand: unknown; queue: unknown; version: number; act_at: number;
};

function toLive(r: DbRow): LiveRow {
  return {
    id: r.id,
    name: r.name,
    casa: num(r.casa),
    entrada: num(r.entrada),
    code: r.code,
    private: Boolean(r.private),
    seats: parse<LiveSeat[]>(r.seats, []),
    table: parse<TableState>(r.table_state, { players: [], nextMano: 0, handNumber: 1, carry: null, seed: 1 }),
    hand: r.hand ? parse<HandState | null>(r.hand, null) : null,
    queue: parse<QueueItem[]>(r.queue, []),
    actAt: num(r.act_at),
  };
}

async function load(id: string): Promise<{ row: LiveRow; version: number } | null> {
  const sql = await getSql();
  const rows = await sql<DbRow>`select * from live_tables where id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  return { row: toLive(r), version: num(r.version) };
}

async function save(row: LiveRow, version: number): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ version: number }>`
    update live_tables set
      seats = ${JSON.stringify(row.seats)},
      table_state = ${JSON.stringify(row.table)},
      hand = ${row.hand ? JSON.stringify(row.hand) : null},
      queue = ${JSON.stringify(row.queue)},
      act_at = ${row.actAt},
      version = ${version + 1}
    where id = ${row.id} and version = ${version}
    returning version
  `;
  return Boolean(rows[0]);
}

async function balanceOf(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ balance: number }>`
    select balance from ledger where user_id = ${userId} order by seq desc limit 1
  `;
  return num(rows[0]?.balance);
}

async function move(userId: string, kind: string, amount: number, ref: string): Promise<number> {
  if (amount === 0) return balanceOf(userId);
  const sql = await getSql();
  const dup = await sql<{ balance: number }>`
    select balance from ledger where user_id = ${userId} and ref = ${ref} order by seq desc limit 1
  `;
  if (dup[0]) return num(dup[0].balance);
  const id = crypto.randomUUID();
  const rows = await sql<{ balance: number }>`
    with prev as (
      select coalesce((select balance from ledger where user_id = ${userId} order by seq desc limit 1), 0) as balance
    ),
    ins as (
      insert into ledger (id, user_id, kind, amount, balance, ref)
      select ${id}, ${userId}, ${kind}, ${amount}, prev.balance + ${amount}, ${ref}
      from prev
      where prev.balance + ${amount} >= 0
      returning balance
    )
    select balance from ins
  `;
  if (!rows[0]) throw new Error("Saldo insuficiente");
  return num(rows[0].balance);
}

async function stake(userId: string, amount: number) {
  const sql = await getSql();
  await sql`
    insert into open_seats (user_id, staked, ceiling)
    values (${userId}, ${amount}, ${amount + TOPE_BOTS})
    on conflict (user_id) do update
      set staked = open_seats.staked + ${amount},
          ceiling = open_seats.ceiling + ${amount}
  `;
}

async function cash(userId: string, amount: number, ref: string): Promise<number> {
  const sql = await getSql();
  const open = await sql<{ ceiling: number }>`select ceiling from open_seats where user_id = ${userId}`;
  const pay = Math.min(Math.max(0, amount), open[0] ? num(open[0].ceiling) : amount);
  const bal = pay > 0 ? await move(userId, "salida_mesa", pay, ref) : await balanceOf(userId);
  await sql`delete from open_seats where user_id = ${userId}`;
  return bal;
}

async function profile(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ nick: string; avatar: string }>`
    select nick, avatar from players where user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Primero elige tu apodo");
  return rows[0];
}

async function findMine(userId: string): Promise<{ row: LiveRow; version: number } | null> {
  const sql = await getSql();
  const needle = `%${userId}%`;
  const rows = await sql<DbRow>`
    select * from live_tables where seats like ${needle} or queue like ${needle} limit 1
  `;
  if (!rows[0]) return null;
  return { row: toLive(rows[0]), version: num(rows[0].version) };
}

async function ensure(id: string): Promise<{ row: LiveRow; version: number }> {
  const spec = PUBLIC_ROOMS.find((r) => r.id === id);
  if (!spec) throw new Error("Esa sala no existe");
  const have = await load(id);
  if (have) return have;
  const sql = await getSql();
  const fresh = openTable(spec, spec.id.split("").reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 7));
  await sql`
    insert into live_tables (id, name, casa, entrada, seats_n, code, private, seats, table_state, hand, queue, version, act_at)
    values (${fresh.id}, ${fresh.name}, ${fresh.casa}, ${fresh.entrada}, ${fresh.seats.length}, ${null}, ${false},
      ${JSON.stringify(fresh.seats)}, ${JSON.stringify(fresh.table)}, ${null}, ${"[]"}, ${1}, ${0})
    on conflict (id) do nothing
  `;
  const again = await load(id);
  if (!again) throw new Error("No se pudo abrir la mesa");
  return again;
}

async function commit(row: LiveRow, version: number, now: number): Promise<{ row: LiveRow; version: number }> {
  let current = row;
  let ver = version;
  for (let i = 0; i < 5; i++) {
    const before = JSON.stringify(current);
    const stepped = pump(current, now);
    for (const c of stepped.cashouts) {
      if (c.amount > 0) await cash(c.userId, c.amount, c.ref);
      else {
        const sql = await getSql();
        await sql`delete from open_seats where user_id = ${c.userId}`;
      }
    }
    const next = stepped.row;
    const changed = JSON.stringify(next) !== before || stepped.cashouts.length > 0;
    if (!changed) return { row: current, version: ver };
    const ok = await save(next, ver);
    if (ok) return { row: next, version: ver + 1 };
    const re = await load(row.id);
    if (!re) throw new Error("La mesa se cerró");
    current = re.row;
    ver = re.version;
    now = Date.now();
  }
  return { row: current, version: ver };
}

async function chats(tableId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; body: string; user_id: string | null }>`
    select id, name, body, user_id from table_chat where table_id = ${tableId} order by at desc limit 30
  `;
  return rows.reverse().map((m) => ({ id: m.id, name: m.name, text: m.body, mine: m.user_id === userId }));
}

async function pack(row: LiveRow, userId: string, version: number): Promise<Snap & { balance: number; version: number; chat: { id: string; name: string; text: string; mine: boolean }[] }> {
  const snap = snapOf(row, userId);
  if (!snap) throw new Error("No estás en esta mesa");
  return { ...snap, balance: await balanceOf(userId), version, chat: await chats(row.id, userId) };
}

export const listTables = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<RoomCard[]> => {
    for (const spec of PUBLIC_ROOMS) await ensure(spec.id);
    const sql = await getSql();
    const rows = await sql<DbRow>`select id, seats, queue from live_tables where private = false`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return PUBLIC_ROOMS.map((spec) => {
      const live = byId.get(spec.id);
      const seats = live ? parse<LiveSeat[]>(live.seats, []) : [];
      const queue = live ? parse<QueueItem[]>(live.queue, []) : [];
      const humans = seats.filter((s) => s.userId).length + queue.length;
      const shown = seats.length ? seats : Array.from({ length: spec.seats }, (_, i) => ({ name: "Bot", avatar: "🃏", isBot: true }));
      return {
        id: spec.id,
        name: spec.name,
        casa: spec.casa,
        entrada: spec.entrada,
        seats: spec.seats,
        occupied: humans,
        humans,
        private: false,
        bots: shown.map((s) => ({ name: s.name, avatar: s.avatar, profile: "agresivo" as const })),
      };
    });
  });

export const whereAmI = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ tableId: string; code: string | null } | null> => {
    const mine = await findMine(context.userId);
    if (!mine) return null;
    const seat = mine.row.seats.find((s) => s.userId === context.userId);
    if (seat?.leaving) return null;
    return { tableId: mine.row.id, code: mine.row.code };
  });

export const snapshot = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const mine = await findMine(context.userId);
    if (!mine) throw new Error("No estás en una mesa");
    const now = Date.now();
    const touched = touch(mine.row, context.userId, now);
    let version = mine.version;
    let row = mine.row;
    if (JSON.stringify(touched.seats) !== JSON.stringify(mine.row.seats)) {
      const ok = await save(touched, version);
      if (ok) {
        row = touched;
        version += 1;
      }
    }
    const done = await commit(row, version, now);
    return pack(done.row, context.userId, done.version);
  });

export const joinTable = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; code?: string }) => ({
    id: input?.id ? String(input.id).slice(0, 40) : "",
    code: input?.code ? String(input.code).trim().toUpperCase().slice(0, 8) : "",
  }))
  .handler(async ({ context, data }) => {
    const me = await profile(context.userId);
    const already = await findMine(context.userId);
    if (already) {
      const same = data.code
        ? already.row.code === data.code
        : data.id
          ? already.row.id === data.id
          : true;
      if (!same) await exitLive(context.userId);
      const mine = same ? already : await findMine(context.userId);
      if (mine && (same || (data.code ? mine.row.code === data.code : mine.row.id === data.id))) {
        const done = await commit(touch(mine.row, context.userId, Date.now()), mine.version, Date.now());
        return pack(done.row, context.userId, done.version);
      }
      if (mine) throw new Error("Cierra la mano en tu mesa para sentarte con tu amigo");
    }
    let found = data.code
      ? await (async () => {
        const sql = await getSql();
        const rows = await sql<DbRow>`select id from live_tables where code = ${data.code}`;
        if (!rows[0]) throw new Error("Código no encontrado");
        return load(rows[0].id);
      })()
      : await ensure(data.id);
    if (!found) throw new Error("Mesa no encontrada");
    const ref = `entrada:${found.row.id}:${context.userId}:${crypto.randomUUID()}`;
    await move(context.userId, "entrada_mesa", -found.row.entrada, ref);
    await stake(context.userId, found.row.entrada);
    let placed = false;
    for (let i = 0; i < 5 && !placed; i++) {
      const cur = await load(found.row.id);
      if (!cur) break;
      try {
        const next = takeSeat(cur.row, { userId: context.userId, nick: me.nick, avatar: me.avatar, ref }, Date.now());
        const ok = await save(next, cur.version);
        if (ok) {
          found = { row: next, version: cur.version + 1 };
          placed = true;
        }
      } catch (e) {
        await move(context.userId, "salida_mesa", found.row.entrada, `devuelve:${ref}`);
        const sql = await getSql();
        await sql`delete from open_seats where user_id = ${context.userId}`;
        throw e;
      }
    }
    if (!placed) {
      await move(context.userId, "salida_mesa", found.row.entrada, `devuelve:${ref}`);
      const sql = await getSql();
      await sql`delete from open_seats where user_id = ${context.userId}`;
      throw new Error("No se pudo sentar. Intenta de nuevo");
    }
    const done = await commit(found.row, found.version, Date.now());
    return pack(done.row, context.userId, done.version);
  });

export const createTable = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string; casa?: number; bots?: number }) => {
    const casa = [1, 2, 5, 10].includes(Number(input?.casa)) ? Number(input.casa) : 1;
    const bots = Math.min(5, Math.max(1, Math.trunc(Number(input?.bots) || 2)));
    const name = String(input?.name ?? "Mesa privada").trim().slice(0, 22) || "Mesa privada";
    return { name, casa, bots };
  })
  .handler(async ({ context, data }) => {
    const me = await profile(context.userId);
    if (await findMine(context.userId)) throw new Error("Ya estás en una mesa");
    const code = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const id = `p-${code}`;
    const entrada = data.casa * 30;
    const spec = { id, name: data.name, casa: data.casa, entrada, seats: data.bots + 1 };
    let row = openTable(spec, Date.now() % 1_000_000_000);
    row.code = code;
    row.private = true;
    const ref = `entrada:${id}:${context.userId}:${crypto.randomUUID()}`;
    await move(context.userId, "entrada_mesa", -entrada, ref);
    await stake(context.userId, entrada);
    row = takeSeat(row, { userId: context.userId, nick: me.nick, avatar: me.avatar, ref }, Date.now());
    const sql = await getSql();
    await sql`
      insert into live_tables (id, name, casa, entrada, seats_n, code, private, seats, table_state, hand, queue, version, act_at)
      values (${row.id}, ${row.name}, ${row.casa}, ${row.entrada}, ${row.seats.length}, ${code}, ${true},
        ${JSON.stringify(row.seats)}, ${JSON.stringify(row.table)}, ${null}, ${JSON.stringify(row.queue)}, ${1}, ${0})
    `;
    const done = await commit(row, 1, Date.now());
    return pack(done.row, context.userId, done.version);
  });

export const play = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { action?: Action }) => {
    const a = input?.action;
    if (!a || typeof a !== "object") throw new Error("Acción inválida");
    if (a.type === "voy" || a.type === "noVoy" || a.type === "resto") return { action: { type: a.type } as Action };
    if ((a.type === "anunciar" || a.type === "subir") && Number.isFinite(a.amount)) {
      return { action: { type: a.type, amount: Math.trunc(a.amount) } as Action };
    }
    throw new Error("Acción inválida");
  })
  .handler(async ({ context, data }) => {
    const mine = await findMine(context.userId);
    if (!mine?.row.hand) throw new Error("No hay mano");
    const seat = seatIndex(mine.row, context.userId);
    if (seat < 0) throw new Error("Entras en la próxima mano");
    if (mine.row.hand.pending[0] !== seat) throw new Error("No es tu turno");
    let hand;
    try {
      hand = (await import("@/game/engine")).applyAction(mine.row.hand, seat, data.action);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "No se pudo jugar");
    }
    const seats = mine.row.seats.map((s, i) => ({ ...s, credits: hand.players[i].credits, seen: s.userId === context.userId ? Date.now() : s.seen }));
    const next: LiveRow = {
      ...mine.row,
      hand,
      seats,
      actAt: Date.now() + (hand.phase === "terminada" ? 2800 : 1100),
    };
    const ok = await save(next, mine.version);
    if (!ok) throw new Error("Alguien se adelantó. Intenta otra vez");
    const done = await commit(next, mine.version + 1, Date.now());
    return pack(done.row, context.userId, done.version);
  });

export const say = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text?: string }) => {
    const text = String(input?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text) throw new Error("Escribe algo");
    return { text };
  })
  .handler(async ({ context, data }) => {
    const mine = await findMine(context.userId);
    if (!mine) throw new Error("No estás en una mesa");
    const seat = seatIndex(mine.row, context.userId);
    const q = mine.row.queue.find((x) => x.userId === context.userId);
    const name = seat >= 0 ? mine.row.seats[seat].name : q?.nick;
    if (!name) throw new Error("No estás en una mesa");
    const sql = await getSql();
    await sql`
      insert into table_chat (id, table_id, user_id, name, body, at)
      values (${crypto.randomUUID()}, ${mine.row.id}, ${context.userId}, ${name}, ${data.text}, ${Date.now()})
    `;
    return pack(mine.row, context.userId, mine.version);
  });

export const rebuy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const mine = await findMine(context.userId);
    if (!mine) throw new Error("No estás en una mesa");
    const seat = seatIndex(mine.row, context.userId);
    if (seat < 0) throw new Error("Aún no te sentaste");
    const amount = mine.row.entrada;
    const ref = `recarga:${mine.row.id}:${context.userId}:${crypto.randomUUID()}`;
    await move(context.userId, "entrada_mesa", -amount, ref);
    await stake(context.userId, amount);
    const seats = mine.row.seats.map((s, i) => i === seat ? { ...s, credits: s.credits + amount } : s);
    let hand = mine.row.hand;
    if (hand) {
      hand = { ...hand, players: hand.players.map((p, i) => i === seat ? { ...p, credits: p.credits + amount } : p) };
    }
    const table = { ...mine.row.table, players: mine.row.table.players.map((p, i) => i === seat ? { ...p, credits: seats[i].credits } : p) };
    const next = { ...mine.row, seats, hand, table };
    const ok = await save(next, mine.version);
    if (!ok) {
      await move(context.userId, "salida_mesa", amount, `devuelve:${ref}`);
      throw new Error("No se pudo recargar");
    }
    return pack(next, context.userId, mine.version + 1);
  });

async function exitLive(userId: string) {
  const mine = await findMine(userId);
  if (!mine) return;
  const marked = markLeave(mine.row, userId);
  if (marked.refund) {
    await move(userId, "salida_mesa", marked.row.entrada, `devuelve:${marked.refund.ref}`);
    const sql = await getSql();
    await sql`delete from open_seats where user_id = ${userId}`;
  }
  const ok = await save(marked.row, mine.version);
  if (!ok) throw new Error("No se pudo salir. Intenta otra vez");
  let done = await commit(marked.row, mine.version + 1, Date.now());
  for (let i = 0; i < 14; i++) {
    const stillSeat = done.row.seats.find((s) => s.userId === userId);
    if (!stillSeat) break;
    const hand = done.row.hand;
    const turn = hand && hand.phase !== "terminada" ? hand.pending[0] : -1;
    const who = turn >= 0 ? done.row.seats[turn] : undefined;
    const blocked = who && !who.isBot && who.userId !== userId && !who.leaving;
    if (blocked) break;
    done = await commit({ ...done.row, actAt: 0 }, done.version, Date.now());
  }
}

export const leaveLive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await exitLive(context.userId);
    return { balance: await balanceOf(context.userId) };
  });
