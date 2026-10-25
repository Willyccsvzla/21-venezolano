import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyAction, decideBot, minStackToPlay, DEFAULT_RULES, handScore, legalActions, nextTable, publicView, Rng, startHand,
  type Action, type HandState, type PlayerState, type RuleConfig, type TableState,
} from '../engine';
import type { Profile, Room } from '../services/backend';
import { botStack } from '../packs';
import { computeHandLayout } from './layout';
import { CardBack, SpanishCard } from './SpanishCard';
import { useViewport } from './useViewport';
import { isMuted, playDeal, playShuffle, setMuted } from './sound';
import { line, type TalkKind } from './chat';

const search = typeof location !== "undefined" ? location.search : "";
const BOT_DELAY = Number(new URLSearchParams(search).get("botDelay") ?? 1300);
const DEAL_MS = Number(new URLSearchParams(search).get("dealMs") ?? 400);
const SHUFFLE_MS = DEAL_MS > 100 ? 1500 : 50;
interface ChatMsg { id: number; seat: number; name: string; text: string }

export function Mesa({ room, profile, buyIn, seed, userId, onLeave, onRebuy }: {
  room: Room; profile: Profile; buyIn: number; seed: number; userId: string;
  onLeave: (credits: number) => void; onRebuy: () => number | null;
}) {
  const rules: RuleConfig = useMemo(() => ({ ...DEFAULT_RULES, casa: room.casa }), [room.casa]);
  const [table, setTable] = useState<TableState>(() => ({
    players: [
      { id: profile.id, name: profile.nick, avatar: profile.avatar, isBot: false, credits: buyIn },
      ...room.bots.slice(0, room.seats - 1).map((b, i) => ({ id: `bot${i}`, name: b.name, avatar: b.avatar, isBot: true, profile: b.profile, credits: botStack(room.casa) })),
    ],
    nextMano: 0, handNumber: 1, carry: null, seed,
  }));
  const [hand, setHand] = useState<HandState | null>(null);
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [picker, setPicker] = useState<number | null>(null);
  const [pickMode, setPickMode] = useState<'subir' | 'anunciar'>('subir');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [broke, setBroke] = useState(false);
  const [dry, setDry] = useState(false);
  const [shown, setShown] = useState<Record<number, number>>({});
  const [shuffling, setShuffling] = useState(false);
  const [mute, setMute] = useState(isMuted());
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [bubbles, setBubbles] = useState<Record<number, string>>({});
  const chatId = useRef(0);
  const talkRng = useRef(new Rng(seed ^ 0x5eed));
  const rngRef = useRef(new Rng(seed ^ 0xabcdef));
  const audit = useRef<string[]>([]);
  const { w: vw, h: vh } = useViewport();
  const landscape = vw > vh;

  // Repartir una mano nueva.
  function deal(t: TableState) {
    const need = minStackToPlay(rules);
    const meIn = t.players[0].credits + (t.carry?.playerId === profile.id ? room.casa : 0) >= need;
    const botsIn = t.players.slice(1).filter((p) => p.credits >= need).length;
    if (!meIn) {
      setTable(t);
      setBroke(true);
      setDry(false);
      return;
    }
    if (botsIn < 1) {
      setTable(t);
      setDry(true);
      return;
    }
    try {
      const h = startHand(t, rules);
      setTable(t);
      setShown({});
      setShuffling(true);
      playShuffle();
      setTimeout(() => setShuffling(false), SHUFFLE_MS);
      setHand(h);
      setPicker(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    deal(table);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Reparto animado: una carta por vez, en sentido horario desde la mano.
  const n = hand?.players.length ?? 0;
  const order = hand ? Array.from({ length: n }, (_, i) => (hand.mano + i) % n) : [];
  let nextDealSeat = -1;
  if (hand && !shuffling) {
    let best = Infinity;
    for (const seat of order) {
      const have = shown[seat] ?? 0;
      if (have < hand.players[seat].cards.length && have < best) { best = have; nextDealSeat = seat; }
    }
  }
  const dealing = !!hand && (shuffling || nextDealSeat >= 0);
  useEffect(() => {
    if (nextDealSeat < 0) return;
    const id = setTimeout(() => {
      playDeal();
      setShown((s) => ({ ...s, [nextDealSeat]: (s[nextDealSeat] ?? 0) + 1 }));
    }, DEAL_MS);
    return () => clearTimeout(id);
  }, [nextDealSeat, shown, hand?.handNumber]);

  // Turno de los bots.
  useEffect(() => {
    if (!hand || hand.phase === 'terminada') return;
    const seat = hand.pending[0];
    const p = hand.players[seat];
    if (!p.isBot || dealing) return;
    const id = setTimeout(() => {
      const view = publicView(hand, seat); // el bot solo ve su vista pública
      const d = decideBot(view, p.profile ?? 'agresivo', rngRef.current);
      audit.current.push(`#${hand.handNumber} ${p.name}: ${d.action.type} (${d.reason})`);
      setHand(applyAction(hand, seat, d.action));
      const t = d.action.type;
      const kind: TalkKind = t === 'resto' ? 'resto' : t === 'subir' || t === 'anunciar' ? (d.reason.startsWith('farol') ? 'farol' : 'sube') : t === 'noVoy' ? 'noVoy' : 'voy';
      const chance = kind === 'voy' ? 0.15 : kind === 'noVoy' ? 0.45 : 0.55;
      if (talkRng.current.next() < chance) say(seat, line(kind, () => talkRng.current.next()));
    }, BOT_DELAY);
    return () => clearTimeout(id);
  }, [hand, dealing]);

  function say(seat: number, text: string) {
    const name = hand?.players[seat]?.name ?? table.players[seat]?.name ?? '?';
    setChat((c) => [...c.slice(-40), { id: ++chatId.current, seat, name, text }]);
    if (seat !== 0) {
      setBubbles((b) => ({ ...b, [seat]: text }));
      setTimeout(() => setBubbles((b) => { const x = { ...b }; if (x[seat] === text) delete x[seat]; return x; }), 2600);
      setUnread((u) => u + 1);
    }
  }
  function botReply(kind: TalkKind, prob: number) {
    if (!hand) return;
    const bots = hand.players.filter((p) => p.isBot && !p.folded && !p.sittingOut);
    if (!bots.length || talkRng.current.next() >= prob) return;
    const b = bots[Math.floor(talkRng.current.next() * bots.length)];
    setTimeout(() => say(b.seat, line(kind, () => talkRng.current.next())), 700 + talkRng.current.next() * 900);
  }
  // Comentarios al terminar la mano.
  useEffect(() => {
    const r = hand?.result;
    if (!r) return;
    const w = hand!.players[r.winnerSeat];
    if (w.isBot && talkRng.current.next() < 0.7) setTimeout(() => say(w.seat, line(r.reason === 'retirada' ? 'ganaFarol' : 'gana', () => talkRng.current.next())), 500);
    else if (!w.isBot) botReply('pierde', 0.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.result]);
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen, chat.length]);
  function sendChat() {
    const t = draft.trim().slice(0, 120);
    if (!t) return;
    say(0, t);
    setDraft('');
    botReply('responde', 0.5);
  }


  // Guardar créditos de mesa por si se cierra la app (se devuelven al saldo al volver).
  useEffect(() => {
    const stack = hand ? hand.players[0].credits : table.players[0].credits;
    const casa = hand?.result?.winnerSeat === 0 ? hand.result.carryOver : 0;
    localStorage.setItem('v21.seat', JSON.stringify({ room: room.id, credits: stack + casa, userId }));
  }, [hand, table, room.id, userId]);

  function act(a: Action) {
    if (!hand) return;
    try {
      setHand(applyAction(hand, 0, a));
      if (a.type === 'subir' || a.type === 'resto') botReply('responde', 0.6);
      setPicker(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function nextHand() {
    if (!hand) return;
    deal(nextTable(table, hand));
  }
  function myCreditsNow() {
    const stack = hand ? hand.players[0].credits : table.players[0].credits;
    const casa = hand?.result?.winnerSeat === 0 ? hand.result.carryOver : 0;
    return stack + casa;
  }

  // Zona de mano: medir para que las cartas ocupen ~3/4 de la pantalla.
  const zoneRef = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setZone({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setZone({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const me = hand?.players[0];
  const myCards = (me?.cards ?? []).slice(0, shown[0] ?? 0);
  const layout = computeHandLayout(zone.w, zone.h, Math.max(myCards.length, 1));
  const legal = hand ? legalActions(hand, 0) : null;
  const range = legal ? (pickMode === 'anunciar' ? legal.anunciar : legal.subir) : null;
  const clampAmt = (v: number) => (range ? Math.max(range.min, Math.min(range.max, Math.round(v))) : v);
  const result = hand?.result ?? null;
  const opps: PlayerState[] = (hand?.players ?? table.players.map((p, seat): PlayerState => ({ ...p, seat, folded: false, sittingOut: false, contributed: 0, cards: [] }))).slice(1);
  const iWon = result?.winnerSeat === 0;
  const turnSeat = hand && hand.phase !== 'terminada' ? hand.pending[0] : -1;

  const left = landscape ? opps.slice(0, Math.ceil(opps.length / 2)).reverse() : [];
  const right = landscape ? opps.slice(Math.ceil(opps.length / 2)) : [];

  const oppEl = (p: (typeof opps)[number]) => {
    const isTurn = turnSeat === p.seat;
    const isMano = hand?.mano === p.seat;
    const sc = result?.scores.find((x) => x.seat === p.seat);
    const status = p.sittingOut ? 'Fuera' : p.folded ? 'No va' : isTurn ? 'Pensando…' : p.lastAction ?? (hand?.phase === 'anuncio' ? 'Espera' : '');
    const revealed = result?.reason === 'puntuacion' ? hand?.players[p.seat]?.cards : undefined;
    return (
      <div key={p.seat} data-testid={`opp-${p.seat}`} className={`opp${isTurn ? ' turn' : ''}${p.folded || p.sittingOut ? ' out' : ''}${result?.winnerSeat === p.seat ? ' win' : ''}`}>
        <div className="opp-av">
          {p.avatar}
          {isMano && <span className="mano-badge">M</span>}
          {revealed && revealed.length > 0 ? (
            <span className="opp-cards show">{revealed.map((c) => <SpanishCard key={c.id} card={c} className="mini-face" />)}</span>
          ) : !p.folded && !p.sittingOut && (shown[p.seat] ?? 0) > 0 && (
            <span className="opp-cards">{Array.from({ length: shown[p.seat] ?? 0 }, (_, i) => <CardBack key={i} className="mini-back" />)}</span>
          )}
        </div>
        {bubbles[p.seat] && <div className="bubble" data-testid="bubble">{bubbles[p.seat]}</div>}
        <div className="opp-name">{p.name}</div>
        <div className="opp-cr">🪙 {p.credits}{p.contributed ? <span className="put"> · {p.contributed}</span> : null}</div>
        <div className={`opp-st${p.folded ? ' no' : status.startsWith('Va') ? ' si' : ''}`}>{sc ? `${sc.score} pts` : status}</div>
      </div>
    );
  };

  let statusText = '';
  if (hand && !result) {
    if (turnSeat === 0) statusText = hand.phase === 'anuncio' ? 'Eres mano: anuncia la apuesta' : legal!.abrir ? 'Te toca apostar (o no ir): sin apuesta no se ven cartas' : legal!.toCall > 0 ? `Para ir pon ${legal!.toCall}` : 'Tu turno: ¿subes o vas?';
    else if (turnSeat >= 0) statusText = `Turno de ${hand.players[turnSeat].name}…`;
    if (me?.folded) statusText = `No vas · ${statusText}`;
  }
  const resultText = result
    ? `${iWon ? '¡Ganas' : `${hand!.players[result.winnerSeat].name} gana`} ${result.won}${result.reason === 'retirada' ? ' sin mostrar cartas (nadie fue)' : ` con ${result.scores.find((s) => s.seat === result.winnerSeat)?.score} pts`}${result.tie ? ' (empate: mano)' : ''}${iWon ? '!' : ''}`
    : '';

  const meChip = hand ? (
    <div className={`me-chip${turnSeat === 0 ? ' turn' : ''}`} data-testid="my-points">
      <span className="av-sm">{profile.avatar}</span>
      <span className="pts"><b>{handScore(myCards)}</b> pts</span>
      <span className="sub">{hand.mano === 0 && <span className="mano-badge inline">MANO</span>}<span className="cr">🪙 {me?.credits}{me?.contributed ? ` · ${me.contributed}` : ''}</span></span>
    </div>
  ) : null;

  return (
    <div className={`screen mesa ${landscape ? 'land' : 'port'}`}>
      <header className="mesa-top">
        <button className="btn ghost sm" onClick={() => setConfirmLeave(true)} aria-label="Salir">✕</button>
        <div className="chips">
          <span className="chip pot" data-testid="pot">Pozo <b>{hand?.pot ?? 0}</b></span>
          <span className="chip">{landscape ? 'Apuesta ' : 'Ap '}<b>{hand?.currentBet ?? room.casa}</b></span>
          <span className="chip">{landscape ? 'Subidas ' : '↑'}<b>{hand?.raisesUsed ?? 0}{rules.maxSubidas != null ? `/${rules.maxSubidas}` : ''}</b></span>
          {landscape && <span className="chip">Casa <b>{room.casa}</b></span>}
        </div>
        <div className="top-btns">
          <button className="btn ghost sm" aria-label="Sonido" data-testid="mute" onClick={() => { setMuted(!mute); setMute(!mute); }}>{mute ? '🔇' : '🔊'}</button>
          <button className="btn ghost sm chat-btn" aria-label="Chat" data-testid="chat-btn" onClick={() => setChatOpen((v) => !v)}>💬{unread > 0 && !chatOpen && <span className="badge">{unread}</span>}</button>
          <button className="btn ghost sm" onClick={() => setLogOpen((v) => !v)} data-testid="log-btn">📜</button>
        </div>
      </header>

      {!landscape && <div className="opps-strip">{opps.map(oppEl)}</div>}
      {landscape && <div className="opps-side left">{left.map(oppEl)}</div>}
      {landscape && <div className="opps-side right">{right.map(oppEl)}</div>}

      <div className="hand-zone" ref={zoneRef} data-testid="hand-zone">
        {myCards.map((c, i) => {
          const pos = layout.pos[i] ?? { x: 0, y: 0, rot: 0 };
          return (
            <div key={c.id} className={`my-card${me?.folded ? ' folded' : ''}${iWon ? ' won' : ''}`} data-testid="my-card"
              style={{ width: layout.w, height: layout.h, transform: `translate(${pos.x}px, ${pos.y}px) rotate(${pos.rot}deg)`, zIndex: i + 1 }}>
              <SpanishCard card={c} className="card-svg" />
            </div>
          );
        })}
        {hand && !landscape && meChip}
        {me?.folded && <div className="stamp">No vas</div>}
        {chatOpen && (
          <div className="chat" data-testid="chat" onClick={(e) => e.stopPropagation()}>
            <div className="chat-list">
              {chat.length === 0 && <div className="chat-empty">Di algo a la mesa…</div>}
              {chat.slice(-30).reverse().map((m) => <div key={m.id} className={m.seat === 0 ? 'mine' : ''}><b>{m.name}:</b> {m.text}</div>)}
            </div>
            <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
              <input data-testid="chat-input" value={draft} maxLength={120} placeholder="Escribe…" onChange={(e) => setDraft(e.target.value)} />
              <button className="btn gold sm" data-testid="chat-send">Enviar</button>
            </form>
            <div className="quick">
              {['¡Epa!', 'No voy', 'Voy con todo', '¿Tienes o no tienes?'].map((q) => <button type="button" key={q} className="btn ghost sm" onClick={() => { say(0, q); botReply('responde', 0.5); }}>{q}</button>)}
            </div>
          </div>
        )}
        {logOpen && hand && (
          <div className="log" data-testid="log">
            {hand.log.slice(-40).reverse().map((e) => <div key={e.n} className={e.seat === 0 ? 'mine' : ''}>{e.text}</div>)}
          </div>
        )}
      </div>

      <div className="actions" data-testid="actions">
        {landscape && meChip}
        {error && <div className="err" onClick={() => setError('')}>{error}</div>}
        {result ? (
          <div className="act-row">
            <div className={`status res${iWon ? ' good' : ''}`} data-testid="result">{resultText}</div>
            <button className="btn gold" data-testid="next" onClick={nextHand}>Siguiente mano</button>
          </div>
        ) : dealing ? (
          <div className="act-row"><div className="status" data-testid="dealing">{shuffling ? 'Barajando…' : 'Repartiendo…'}</div></div>
        ) : legal?.anunciar ? (
          <div className="act-row">
            <button className="btn gold" data-testid="anunciar" onClick={() => act({ type: 'anunciar', amount: legal.anunciar!.min })}>Anunciar {legal.anunciar.min}</button>
            <button className="btn ghost" data-testid="anunciar-otro" onClick={() => { setPickMode('anunciar'); setPicker(Math.min(legal.anunciar!.max, legal.anunciar!.min + 2)); }}>Otro monto…</button>
          </div>
        ) : legal?.isTurn ? (
          <div className="act-row four">
            <button className="btn go" data-testid="voy" disabled={!legal.voy} onClick={() => act({ type: 'voy' })}>{legal.allInCall ? `Voy con todo (${legal.toCall})` : legal.toCall > 0 ? `Voy +${legal.toCall}` : 'Voy'}</button>
            <button className="btn no" data-testid="novoy" disabled={!legal.noVoy} onClick={() => act({ type: 'noVoy' })}>No voy</button>
            <button className="btn gold" data-testid="subir" disabled={!legal.subir} onClick={() => { setPickMode('subir'); setPicker(legal.subir!.min); }}>{legal.abrir ? 'Apostar' : 'Subir'}</button>
            <button className="btn resto" data-testid="resto" disabled={legal.resto === null} onClick={() => act({ type: 'resto' })}>Resto{legal.resto !== null ? ` ${legal.resto}` : ''}</button>
          </div>
        ) : (
          <div className="act-row"><div className="status" data-testid="status">{statusText || 'Repartiendo…'}</div></div>
        )}
        {legal?.isTurn && !result && !dealing && <div className="hint">{statusText}</div>}
      </div>

      {picker !== null && range && (
        <div className="picker" data-testid="picker">
          <div className="picker-title">{pickMode === 'anunciar' ? 'Anunciar (total)' : legal?.abrir ? 'Apostar (total)' : 'Subir a (total)'} · máx {range.max}</div>
          <div className="stepper">
            <button className="btn ghost" onClick={() => setPicker(clampAmt(picker - 1))}>−</button>
            <input className="amt-input" data-testid="amount-input" type="number" inputMode="numeric" min={range.min} max={range.max} value={picker}
              onChange={(e) => setPicker(Number(e.target.value) || 0)} onBlur={() => setPicker(clampAmt(picker))} />
            <button className="btn ghost" onClick={() => setPicker(clampAmt(picker + 1))}>+</button>
          </div>
          <input className="slider" type="range" min={range.min} max={range.max} value={clampAmt(picker)} onChange={(e) => setPicker(Number(e.target.value))} />
          <div className="quick">
            {[1, 5, 10, 25, 50].map((q) => (
              <button key={q} className="btn ghost sm" onClick={() => setPicker(clampAmt((pickMode === 'anunciar' ? 0 : hand!.currentBet) + q))}>{pickMode === 'anunciar' ? q : `+${q}`}</button>
            ))}
            <button className="btn ghost sm" onClick={() => setPicker(range.max)}>Todo</button>
          </div>
          <div className="act-row">
            <button className="btn ghost" onClick={() => setPicker(null)}>Cancelar</button>
            <button className="btn gold" data-testid="confirm-subir"
              onClick={() => act(pickMode === 'anunciar' ? { type: 'anunciar', amount: clampAmt(picker) } : { type: 'subir', amount: clampAmt(picker) })}>
              {pickMode === 'anunciar' ? 'Anunciar' : legal?.abrir ? 'Apostar' : 'Subir a'} {clampAmt(picker)}
            </button>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className="modal" onClick={() => setConfirmLeave(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>¿Salir de la mesa?</h2>
            <p className="note">{hand && !result ? 'La mano está en curso: perderás lo que ya pusiste. ' : ''}Tus {myCreditsNow()} créditos de mesa vuelven a tu saldo.</p>
            <div className="act-row">
              <button className="btn ghost" onClick={() => setConfirmLeave(false)}>Seguir jugando</button>
              <button className="btn no" onClick={() => onLeave(myCreditsNow())}>Salir</button>
            </div>
          </div>
        </div>
      )}
      {dry && (
        <div className="modal">
          <div className="modal-box">
            <h2>La mesa se secó</h2>
            <p className="note">Los bots se quedaron sin créditos y no recompran. Tus {myCreditsNow()} vuelven al saldo.</p>
            <button className="btn gold" onClick={() => onLeave(myCreditsNow())}>Volver al lobby</button>
          </div>
        </div>
      )}
      {broke && (
        <div className="modal">
          <div className="modal-box">
            <h2>Sin créditos en la mesa</h2>
            <p className="note">Necesitas al menos {minStackToPlay(rules)} (casa + anuncio + ronda final). Si el saldo de la cuenta se acaba, entra con otro correo.</p>
            <div className="act-row">
              <button className="btn ghost" onClick={() => onLeave(table.players[0].credits)}>Salir al lobby</button>
              <button className="btn gold" onClick={() => {
                const got = onRebuy();
                if (got) {
                  const t = { ...table, players: table.players.map((p, i) => (i === 0 ? { ...p, credits: p.credits + got } : p)) };
                  setBroke(false);
                  deal(t);
                }
              }}>Recargar {room.entrada}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
