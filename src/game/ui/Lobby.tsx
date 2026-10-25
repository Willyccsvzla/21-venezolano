import { useState } from 'react';
import { UserButton } from '@/lib/auth/gates';
import type { Profile, Room } from '../services/backend';
import { useViewport } from './useViewport';
import { inviteUrl } from './invite';

export function Lobby({ profile, balance, rooms, onJoin, onCreate, onFindCode, onShop, notice }: {
  profile: Profile; balance: number; rooms: Room[];
  onJoin: (r: Room) => void; onCreate: (name: string, casa: number, bots: number) => Promise<Room>; onFindCode: (code: string) => Promise<Room | null>;
  onShop: () => void; notice?: string;
}) {
  const { w, h } = useViewport();
  const wide = w >= 760;
  const rowH = wide ? 74 : 70;
  const perPage = Math.max(2, Math.floor((h - (wide ? 230 : 250)) / rowH) * (wide ? 2 : 1));
  const [page, setPage] = useState(0);
  const list = Array.isArray(rooms) ? rooms : [];
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const pg = Math.min(page, pages - 1);
  const visible = list.slice(pg * perPage, pg * perPage + perPage);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Room | null>(null);
  const [cName, setCName] = useState('Mesa de ' + profile.nick);
  const [cCasa, setCCasa] = useState(1);
  const [cBots, setCBots] = useState(3);

  return (
    <div className="screen lobby">
      <header className="bar">
        <div className="auth-chip"><UserButton /></div>
        <div className="me"><span className="av-sm">{profile.avatar}</span> {profile.nick}</div>
        <button className="bal btnlike" onClick={onShop} data-testid="balance">🪙 {balance} <small>+</small></button>
      </header>
      <h2 className="title">Salas</h2>
      {notice && <p className="err">{notice}</p>}
      <div className={wide ? 'rooms two' : 'rooms'} style={{ gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visible.length / (wide ? 2 : 1)))}, ${rowH - 8}px)` }}>
        {visible.map((r) => (
          <div className="room" key={r.id} data-testid={`room-${r.id}`}>
            <div className="rinfo">
              <div className="rname">{r.private ? '🔒 ' : ''}{r.name}</div>
              <div className="rmeta">Casa <b>{r.casa}</b> · Entrada <b>{r.entrada}</b> · 👥 {r.occupied} en la mesa</div>
              <div className="rbots">{(r.bots ?? []).map((b, i) => <span key={b.name + i} title={b.name}>{b.avatar}</span>)}</div>
            </div>
            <button className="btn gold" disabled={balance < r.entrada} onClick={() => onJoin(r)}>{balance < r.entrada ? 'Sin saldo' : 'Unirse'}</button>
          </div>
        ))}
      </div>
      <div className="pager">
        <button className="btn ghost sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
        <span>{pg + 1}/{pages}</span>
        <button className="btn ghost sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
      </div>
      <div className="lobby-actions">
        <button className="btn gold" data-testid="crear" onClick={() => { setCreating(true); setCreated(null); }}>＋ Crear sala privada</button>
        <form className="codeform" onSubmit={(e) => { e.preventDefault(); void onFindCode(code).then((r) => { if (r) onJoin(r); else setErr('Código no encontrado'); }); }}>
          <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(''); }} placeholder="CÓDIGO" maxLength={5} />
          <button className="btn ghost">Entrar</button>
        </form>
        {err && <div className="err">{err}</div>}
      </div>
      <p className="foot">Misma mesa para todos. Si falta alguien, el puesto lo ocupa un bot.</p>
      {creating && (
        <div className="modal" onClick={() => setCreating(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            {!created ? (
              <>
                <h2>Sala privada</h2>
                <label className="lbl">Nombre</label>
                <input value={cName} onChange={(e) => setCName(e.target.value)} maxLength={22} />
                <label className="lbl">Casa</label>
                <div className="seg">{[1, 2, 5, 10].map((c) => <button key={c} className={c === cCasa ? 'on' : ''} onClick={() => setCCasa(c)}>{c}</button>)}</div>
                <label className="lbl">Bots</label>
                <div className="seg">{[1, 2, 3, 4, 5].map((c) => <button key={c} className={c === cBots ? 'on' : ''} onClick={() => setCBots(c)}>{c}</button>)}</div>
                <p className="note">Entrada: {cCasa * 30} créditos</p>
                <button className="btn gold big" onClick={() => { void onCreate(cName, cCasa, cBots).then((r) => setCreated(r)); }}>Crear</button>
              </>
            ) : (
              <>
                <h2>¡Sala creada!</h2>
                <p className="note">Código de invitación</p>
                <div className="bigcode" data-testid="code">{created.code}</div>
                <input className="invite-link" readOnly value={inviteUrl(created.code ?? null, created.id)} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn ghost" onClick={() => { const link = inviteUrl(created.code ?? null, created.id); void navigator.clipboard?.writeText(link); }}>Copiar enlace</button>
                <p className="note">Tu amigo abre ese enlace, entra con su correo y se sienta en esta mesa. Puedes seguir con bots hasta que llegue.</p>
                <button className="btn gold big" onClick={() => { setCreating(false); onJoin(created); }}>Entrar a la sala</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
