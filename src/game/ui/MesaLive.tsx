import { useEffect, useRef, useState } from "react";
import { handScore, type Action } from "../engine";
import type { Profile } from "../services/backend";
import { leaveLive, play, rebuy, say, snapshot } from "@/lib/table.functions";
import { CardBack, SpanishCard } from "./SpanishCard";
import { inviteUrl } from "./invite";
import { isMuted, playDeal, playShuffle, setMuted, unlockAudio } from "./sound";
import { useViewport } from "./useViewport";

type Snap = Awaited<ReturnType<typeof snapshot>>;

export function MesaLive({ profile, onLeave, onBalance }: {
  profile: Profile;
  onLeave: (balance: number) => void;
  onBalance: (n: number) => void;
}) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState<number | null>(null);
  const [pickMode, setPickMode] = useState<"anunciar" | "subir">("subir");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mute, setMute] = useState(isMuted());
  const [inviteOpen, setInviteOpen] = useState(false);
  const heard = useRef("");
  const { w: vw, h: vh } = useViewport();
  const landscape = vw > vh;

  useEffect(() => {
    let stop = false;
    let flying = false;
    const tick = async () => {
      if (flying || (typeof document !== "undefined" && document.hidden)) return;
      flying = true;
      try {
        const s = await snapshot();
        if (stop) return;
        // nunca retroceder: una respuesta vieja no pisa una mano más nueva
        setSnap((cur) => (cur && cur.tableId === s.tableId && (cur.version ?? 0) > (s.version ?? 0) ? cur : s));
        onBalance(s.balance);
        setErr("");
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : "Se perdió la mesa");
      } finally {
        flying = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 800);
    const vis = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [onBalance]);

  useEffect(() => {
    if (!snap?.you || snap.waiting) return;
    const ids = (snap.you.cards ?? []).map((c) => c.id).join(",");
    const key = `${snap.tableId}:${snap.handNumber}:${ids}`;
    if (heard.current === key) return;
    const prev = heard.current;
    heard.current = key;
    const prevIds = prev.split(":").slice(2).join(":");
    const freshHand = !prev || prev.split(":")[0] !== snap.tableId || prev.split(":")[1] !== String(snap.handNumber) || (prevIds !== ids && !ids.startsWith(prevIds));
    if (freshHand) {
      unlockAudio();
      playShuffle();
      if (ids) ids.split(",").forEach((_, i) => setTimeout(() => playDeal(), 1900 + i * 330));
      return;
    }
    if (ids.length > prevIds.length) playDeal();
  }, [snap]);

  async function act(action: Action) {
    setBusy(true);
    setPicker(null);
    try {
      const s = await play({ data: { action } });
      setSnap(s);
      onBalance(s.balance);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo jugar");
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const body = text.trim();
    if (!body) return;
    setDraft("");
    try {
      const s = await say({ data: { text: body } });
      setSnap(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se envió");
    }
  }

  async function exit() {
    const s = await leaveLive();
    onLeave(s.balance);
  }

  if (!snap || !snap.you) {
    return (
      <div className="screen mesa">
        <p className="tag">{err || "Sentándote…"}</p>
      </div>
    );
  }

  const legal = snap.legal;
  const myCards = snap.you.cards ?? [];
  const opponents = snap.opponents ?? [];
  const chat = snap.chat ?? [];
  const waitingNames = snap.waitingNames ?? [];
  const points = myCards.length ? handScore(myCards) : null;
  const link = inviteUrl(snap.code, snap.tableId);
  const range = picker !== null && legal
    ? (pickMode === "anunciar" ? legal.anunciar : legal.subir)
    : null;
  const clampAmt = (v: number) => (range ? Math.max(range.min, Math.min(range.max, Math.round(v))) : v);
  const iWon = snap.result?.winnerSeat === snap.seat;
  const waitingTurn = snap.turnSeat === snap.seat;
  const status = snap.waiting
    ? "Estás en la puerta. Entras en la próxima mano."
    : !snap.legal
      ? "Repartiendo…"
      : waitingNames.length
        ? `${waitingNames.join(", ")} espera esta mano para sentarse`
        : waitingTurn
        ? (snap.phase === "anuncio" ? "Eres mano: anuncia la apuesta" : legal?.abrir ? "Te toca apostar" : legal && legal.toCall > 0 ? `Para ir pon ${legal.toCall}` : "Tu turno")
        : snap.turnSeat >= 0
          ? `Turno de ${opponents.find((o) => o.seat === snap.turnSeat)?.name ?? "la mesa"}…`
          : "";

  const oppEl = (p: Snap["opponents"][number]) => (
    <div key={p.seat} className={`opp${p.isBot ? "" : " human"}${snap.turnSeat === p.seat ? " turn" : ""}${p.folded || p.sittingOut ? " out" : ""}${snap.result?.winnerSeat === p.seat ? " win" : ""}`}>
      <div className="opp-av">
        {p.avatar}
        {snap.mano === p.seat && <span className="mano-badge">M</span>}
        {p.revealed && p.revealed.length > 0 ? (
          <span className="opp-cards show">{p.revealed.map((c) => <SpanishCard key={c.id} card={c} className="mini-face" />)}</span>
        ) : !p.folded && !p.sittingOut && p.cardCount > 0 && (
          <span className="opp-cards">{Array.from({ length: p.cardCount }, (_, i) => <CardBack key={i} className="mini-back" />)}</span>
        )}
      </div>
      <div className="opp-name">{p.name}{p.isBot ? "" : " · amigo"}</div>
      <div className="opp-cr">🪙 {p.credits}{p.contributed ? <span className="put"> · {p.contributed}</span> : null}</div>
      <div className={`opp-st${p.folded ? " no" : ""}`}>{p.sittingOut ? "Fuera" : p.folded ? "No va" : snap.turnSeat === p.seat ? "Pensando…" : p.lastAction ?? "En mesa"}</div>
    </div>
  );

  const resultText = snap.result
    ? `${iWon ? "¡Ganas" : `${opponents.find((o) => o.seat === snap.result?.winnerSeat)?.name ?? snap.you.name} gana`} ${snap.result.won}${snap.result.reason === "retirada" ? " sin mostrar" : ""}${iWon ? "!" : ""}`
    : "";

  return (
    <div className={`screen mesa ${landscape ? "land" : "port"}`} onPointerDown={() => unlockAudio()}>
      <header className="mesa-top">
        <button className="btn ghost sm" onClick={() => setConfirmLeave(true)} aria-label="Salir">✕</button>
        <div className="chips">
          <span className="chip score" data-testid="puntos">Puntos <b>{points ?? "—"}</b></span>
          <span className="chip pot">Pozo <b>{snap.pot}</b></span>
          <span className="chip">Ap <b>{snap.currentBet}</b></span>
          <span className="chip">Casa <b>{snap.casa}</b></span>
          {snap.humans > 1 && <span className="chip">{snap.humans} en mesa</span>}
        </div>
        <div className="top-btns">
          <button className="btn ghost sm" aria-label={mute ? "Activar sonido" : "Silenciar"} onClick={() => { const next = !mute; setMute(next); setMuted(next); if (!next) { unlockAudio(); playShuffle(); } }}>{mute ? "🔇" : "🔊"}</button>
          <button className="btn ghost sm" aria-label="Invitar amigo" onClick={() => { setInviteOpen(true); unlockAudio(); void navigator.clipboard?.writeText(link).catch(() => undefined); }}>Invitar</button>
          <button className="btn ghost sm chat-btn" aria-label="Chat" onClick={() => setChatOpen((v) => !v)}>💬</button>
        </div>
      </header>

      {!landscape && <div className="opps-strip">{opponents.map(oppEl)}</div>}
      {landscape && <div className="opps-side left">{opponents.slice(0, Math.ceil(opponents.length / 2)).map(oppEl)}</div>}
      {landscape && <div className="opps-side right">{opponents.slice(Math.ceil(opponents.length / 2)).map(oppEl)}</div>}

      <div className="hand-zone">
        <div className="scoreboard" aria-live="polite">
          <span>Puntos</span>
          <b>{points ?? "—"}</b>
        </div>
        <div className="fan" style={{ ["--n" as string]: Math.max(myCards.length, 2) }} data-testid="my-cards">
          {(myCards.length ? myCards : [null, null]).map((c, i) => (
            <div key={c?.id ?? `back-${i}`} className={`my-card${snap.you.folded ? " folded" : ""}${iWon ? " won" : ""}`} style={{ ["--i" as string]: i }}>
              {c ? <SpanishCard card={c} className="card-svg" /> : <CardBack className="card-svg" />}
            </div>
          ))}
        </div>
        <div className={`me-chip${waitingTurn ? " turn" : ""}`}>
          <span className="av-sm">{profile.avatar}</span>
          <span className="pts"><b>{points ?? "—"}</b> pts</span>
          <span className="sub">{snap.mano === snap.seat && <span className="mano-badge inline">MANO</span>}<span className="cr">🪙 {snap.you.credits}{snap.you.contributed ? ` · ${snap.you.contributed}` : ""}</span></span>
        </div>
        {chatOpen && (
          <div className="chat" onClick={(e) => e.stopPropagation()}>
            <div className="chat-list">
              {chat.length === 0 && <div className="chat-empty">La mesa te oye. Si hay gente, también.</div>}
              {chat.map((m) => <div key={m.id} className={m.mine ? "mine" : ""}><b>{m.name}:</b> {m.text}</div>)}
            </div>
            <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
              <input value={draft} maxLength={120} placeholder="Escribe a la mesa…" onChange={(e) => setDraft(e.target.value)} />
              <button className="btn gold sm">Enviar</button>
            </form>
          </div>
        )}
      </div>

      <div className="actions">
        {err && <div className="err" onClick={() => setErr("")}>{err}</div>}
        {snap.waiting ? (
          <div className="act-row"><div className="status">{status}</div></div>
        ) : snap.result ? (
          <div className="act-row">
            <div className={`status res${iWon ? " good" : ""}`}>{resultText}</div>
          </div>
        ) : legal?.anunciar && waitingTurn ? (
          <div className="act-row">
            <button className="btn gold" disabled={busy} onClick={() => void act({ type: "anunciar", amount: legal.anunciar!.min })}>Anunciar {legal.anunciar.min}</button>
            <button className="btn ghost" onClick={() => { setPickMode("anunciar"); setPicker(legal.anunciar!.min); }}>Otro monto…</button>
          </div>
        ) : legal?.isTurn ? (
          <div className="act-row four">
            <button className="btn go" disabled={!legal.voy || busy} onClick={() => void act({ type: "voy" })}>{legal.toCall > 0 ? `Voy +${legal.toCall}` : "Voy"}</button>
            <button className="btn no" disabled={!legal.noVoy || busy} onClick={() => void act({ type: "noVoy" })}>No voy</button>
            <button className="btn gold" disabled={!legal.subir || busy} onClick={() => { setPickMode("subir"); setPicker(legal.subir!.min); }}>{legal.abrir ? "Apostar" : "Subir"}</button>
            <button className="btn resto" disabled={legal.resto === null || busy} onClick={() => void act({ type: "resto" })}>Resto</button>
          </div>
        ) : (
          <div className="act-row"><div className="status">{status || snap.name}</div></div>
        )}
        {snap.you.credits < snap.casa + 2 && !snap.waiting && (
          <button className="btn ghost sm" onClick={() => void rebuy().then((s) => { setSnap(s); onBalance(s.balance); }).catch((e: unknown) => setErr(e instanceof Error ? e.message : "Sin saldo"))}>
            Recargar {snap.entrada}
          </button>
        )}
      </div>

      {picker !== null && range && (
        <div className="picker">
          <div className="picker-title">{pickMode === "anunciar" ? "Anunciar" : "Subir a"} · máx {range.max}</div>
          <div className="stepper">
            <button className="btn ghost" onClick={() => setPicker(clampAmt(picker - 1))}>−</button>
            <input className="amt-input" type="number" value={picker} onChange={(e) => setPicker(Number(e.target.value) || range.min)} />
            <button className="btn ghost" onClick={() => setPicker(clampAmt(picker + 1))}>+</button>
          </div>
          <div className="act-row">
            <button className="btn ghost" onClick={() => setPicker(null)}>Cancelar</button>
            <button className="btn gold" disabled={busy} onClick={() => void act(pickMode === "anunciar" ? { type: "anunciar", amount: clampAmt(picker) } : { type: "subir", amount: clampAmt(picker) })}>
              {clampAmt(picker)}
            </button>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="modal" onClick={() => setInviteOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Jugar con un amigo</h2>
            <p className="note">Tu amigo abre este enlace, entra con su correo y se sienta en esta misma mesa. Si no hay nadie, el puesto lo ocupa un bot.</p>
            {snap.code && <div className="bigcode" data-testid="code">{snap.code}</div>}
            <input className="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn gold" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setErr("Enlace copiado")).catch(() => setErr(link)); }}>Copiar enlace</button>
            <button className="btn ghost" onClick={() => setInviteOpen(false)}>Seguir jugando</button>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className="modal" onClick={() => setConfirmLeave(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>¿Salir de la mesa?</h2>
            <p className="note">Tu puesto lo ocupa un bot. Si la mano sigue, el saldo vuelve al cerrarla.</p>
            <div className="act-row">
              <button className="btn ghost" onClick={() => setConfirmLeave(false)}>Seguir</button>
              <button className="btn no" onClick={() => void exit()}>Salir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
