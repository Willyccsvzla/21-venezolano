import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { BONO_INICIAL, TOPE_BOTS } from "@/game/packs";

export type LedgerKind = "entrada_mesa" | "salida_mesa";

export type PlayerProfile = {
  nick: string;
  avatar: string;
  testMode: boolean;
  balance: number;
};

const KINDS: LedgerKind[] = ["entrada_mesa", "salida_mesa"];

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function balanceOf(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ balance: number }>`
    select balance from ledger where user_id = ${userId} order by seq desc limit 1
  `;
  return num(rows[0]?.balance);
}

async function credit(userId: string, kind: string, amount: number, ref: string | null): Promise<number> {
  const sql = await getSql();
  const id = crypto.randomUUID();
  const rows = await sql<{ balance: number }>`
    with prev as (
      select coalesce((
        select balance from ledger where user_id = ${userId} order by seq desc limit 1
      ), 0) as balance
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

export const getPlayer = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PlayerProfile | null> => {
    const sql = await getSql();
    const rows = await sql<{ nick: string; avatar: string; test_mode: boolean }>`
      select nick, avatar, test_mode from players where user_id = ${context.userId}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      nick: row.nick,
      avatar: row.avatar,
      testMode: Boolean(row.test_mode),
      balance: await balanceOf(context.userId),
    };
  });

export const savePlayer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { nick: string; avatar: string; testMode: boolean }) => {
    const nick = String(input?.nick ?? "").trim().slice(0, 16);
    const avatar = String(input?.avatar ?? "").slice(0, 8);
    if (!nick) throw new Error("Escribe un apodo");
    if (!avatar) throw new Error("Elige un avatar");
    return { nick, avatar, testMode: Boolean(input?.testMode) };
  })
  .handler(async ({ context, data }): Promise<PlayerProfile> => {
    const sql = await getSql();
    const userId = context.userId;
    await sql`
      insert into players (user_id, nick, avatar, test_mode)
      values (${userId}, ${data.nick}, ${data.avatar}, ${data.testMode})
      on conflict (user_id) do update
        set nick = excluded.nick, avatar = excluded.avatar, test_mode = excluded.test_mode
    `;
    const id = crypto.randomUUID();
    await sql`
      insert into ledger (id, user_id, kind, amount, balance, ref)
      select ${id}, ${userId}, 'bono_inicial', ${BONO_INICIAL}, ${BONO_INICIAL}, 'alta'
      where not exists (select 1 from ledger where user_id = ${userId})
    `;
    return {
      nick: data.nick,
      avatar: data.avatar,
      testMode: data.testMode,
      balance: await balanceOf(userId),
    };
  });

export const applyLedger = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { kind: LedgerKind; amount: number; ref?: string }) => {
    const kind = input?.kind;
    const amount = Math.trunc(Number(input?.amount));
    if (!KINDS.includes(kind)) throw new Error("Movimiento inválido");
    if (!Number.isFinite(amount) || amount === 0) throw new Error("Monto inválido");
    if (Math.abs(amount) > 200_000) throw new Error("Monto fuera de rango");
    if (kind === "entrada_mesa" && amount >= 0) throw new Error("La entrada se descuenta");
    if (kind === "salida_mesa" && amount <= 0) throw new Error("La salida devuelve créditos");
    return { kind, amount, ref: input.ref ? String(input.ref).slice(0, 80) : undefined };
  })
  .handler(async ({ context, data }): Promise<number> => {
    const sql = await getSql();
    const owns = await sql<{ user_id: string }>`
      select user_id from players where user_id = ${context.userId}
    `;
    if (!owns[0]) throw new Error("Primero elige tu apodo");
    if (data.kind === "entrada_mesa") {
      const stake = -data.amount;
      const next = await credit(context.userId, data.kind, data.amount, data.ref ?? null);
      await sql`
        insert into open_seats (user_id, staked, ceiling)
        values (${context.userId}, ${stake}, ${stake + TOPE_BOTS})
        on conflict (user_id) do update
          set staked = open_seats.staked + ${stake},
              ceiling = open_seats.ceiling + ${stake}
      `;
      return next;
    }
    const open = await sql<{ ceiling: number }>`
      select ceiling from open_seats where user_id = ${context.userId}
    `;
    if (!open[0]) throw new Error("No hay una mesa abierta");
    const pay = Math.min(data.amount, num(open[0].ceiling));
    const next = await credit(context.userId, data.kind, pay, data.ref ?? null);
    await sql`delete from open_seats where user_id = ${context.userId}`;
    return next;
  });

export const closeSeat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<boolean> => {
    const sql = await getSql();
    await sql`delete from open_seats where user_id = ${context.userId}`;
    return true;
  });
