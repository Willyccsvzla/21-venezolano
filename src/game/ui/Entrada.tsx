import { useState } from 'react';
import { SpanishCard } from './SpanishCard';
import { Reglas } from './Reglas';

const AVATARS = ['🤠', '😎', '🧑🏽', '👩🏻', '🦁', '🦜'];

export function Entrada({ initialNick, onEnter }: { initialNick?: string; onEnter: (nick: string, avatar: string, testMode: boolean) => void }) {
  const [nick, setNick] = useState(initialNick ?? '');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [reglas, setReglas] = useState(false);
  return (
    <div className="screen entrada">
      <div className="hero">
        <div className="hero-cards">
          <SpanishCard card={{ rank: 7, suit: 'oros', id: 'h1' }} className="hc hc1" />
          <SpanishCard card={{ rank: 12, suit: 'copas', id: 'h2' }} className="hc hc2" />
          <SpanishCard card={{ rank: 7, suit: 'espadas', id: 'h3' }} className="hc hc3" />
        </div>
        <h1>21 <span>Venezolano</span></h1>
        <p className="tag">Tu cuenta ya está. Elige cómo te ven en la mesa.</p>
      </div>
      <form className="panel login" onSubmit={(e) => { e.preventDefault(); if (nick.trim()) onEnter(nick, avatar, false); }}>
        <label className="lbl">Tu apodo</label>
        <input data-testid="nick" value={nick} maxLength={16} placeholder="Ej: Willy" onChange={(e) => setNick(e.target.value)} />
        <div className="avatars">
          {AVATARS.map((a) => (
            <button type="button" key={a} className={a === avatar ? 'av on' : 'av'} onClick={() => setAvatar(a)}>{a}</button>
          ))}
        </div>
        <button className="btn gold big" data-testid="entrar" disabled={!nick.trim()}>Sentarme en la mesa</button>
        <button type="button" className="btn ghost" onClick={() => setReglas(true)}>¿Cómo se juega?</button>
      </form>
      <p className="foot">500 créditos por correo. Si se acaban, entra con otro.</p>
      {reglas && <Reglas onClose={() => setReglas(false)} />}
    </div>
  );
}
