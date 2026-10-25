import { useEffect, useState, type FormEvent } from "react";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { savePlayer } from "@/lib/player.functions";
import { Reglas } from "./Reglas";
import { rememberInvite } from "./invite";
import { unlockAudio, playShuffle } from "./sound";
import sieteOros from "../assets/cards/7-oros.webp";
import reyCopas from "../assets/cards/12-copas.webp";
import sieteEspadas from "../assets/cards/7-espadas.webp";

const AVATARS = ["🤠", "😎", "🧑🏽", "👩🏻", "🦁", "🦜"];
const BEARER_KEY = "grok-auth.bearer-token";

type Mode = "entrar" | "crear";
type AuthResult = { data: { token?: string | null } | null; error: { message?: string; code?: string } | null };

function mensaje(error: { message?: string; code?: string } | null): string {
  const code = error?.code ?? "";
  const text = (error?.message ?? "").toLowerCase();
  if (code.includes("USER_ALREADY_EXISTS") || text.includes("already")) return "Ese correo ya tiene cuenta. Entra con tu clave.";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || text.includes("invalid email or password")) return "Correo o clave incorrectos.";
  if (text.includes("password") || text.includes("8")) return "La clave necesita al menos 8 caracteres.";
  if (text.includes("email")) return "Ese correo no sirve.";
  return error?.message || "No se pudo entrar. Intenta otra vez.";
}

async function rememberSession(token?: string | null) {
  if (token && typeof window !== "undefined" && window.location.hostname.endsWith(".grok-sandbox.com")) {
    try { sessionStorage.setItem(BEARER_KEY, token); } catch { /* el iframe a veces bloquea storage */ }
  }
  await authClient.getSession();
}

export function Correo() {
  const [mode, setMode] = useState<Mode>("crear");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nick, setNick] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reglas, setReglas] = useState(false);
  useEffect(() => { rememberInvite(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    unlockAudio();
    playShuffle();
    try {
      if (mode === "crear") {
        const name = nick.trim().slice(0, 16);
        if (!name) { setErr("Escribe un apodo para la mesa."); return; }
        const res = await authClient.signUp.email({
          email: email.trim(),
          password,
          name,
        }) as AuthResult;
        if (res.error) { setErr(mensaje(res.error)); return; }
        if (res.data?.token && typeof window !== "undefined" && window.location.hostname.endsWith(".grok-sandbox.com")) {
          try { sessionStorage.setItem(BEARER_KEY, res.data.token); } catch { /* ignore */ }
        }
        await savePlayer({ data: { nick: name, avatar, testMode: false } });
        await rememberSession(res.data?.token);
      } else {
        const res = await authClient.signIn.email({
          email: email.trim(),
          password,
        }) as AuthResult;
        if (res.error) { setErr(mensaje(res.error)); return; }
        await rememberSession(res.data?.token);
      }
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : "No se pudo entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen entrada">
      <div className="hero">
        <div className="hero-cards">
          <img className="naipe hc hc1" src={sieteOros} alt="Siete de Oros" draggable={false} />
          <img className="naipe hc hc2" src={reyCopas} alt="Rey de Copas" draggable={false} />
          <img className="naipe hc hc3" src={sieteEspadas} alt="Siete de Espadas" draggable={false} />
        </div>
        <h1>21 <span>Venezolano</span></h1>
        <p className="tag">500 créditos al crear la cuenta</p>
      </div>
      <form className="panel login" onSubmit={submit}>
        <div className="modes">
          <button type="button" className={mode === "entrar" ? "on" : ""} onClick={() => { setMode("entrar"); setErr(""); }}>Entrar</button>
          <button type="button" className={mode === "crear" ? "on" : ""} onClick={() => { setMode("crear"); setErr(""); }}>Crear cuenta</button>
        </div>
        <label className="lbl" htmlFor="correo">Correo</label>
        <input id="correo" data-testid="email" type="email" autoComplete="email" required value={email} placeholder="tu@correo.com" onChange={(e) => setEmail(e.target.value)} />
        <label className="lbl" htmlFor="clave">Clave</label>
        <input id="clave" data-testid="password" type="password" autoComplete={mode === "crear" ? "new-password" : "current-password"} required minLength={8} value={password} placeholder="Mínimo 8 caracteres" onChange={(e) => setPassword(e.target.value)} />
        {mode === "crear" && (
          <>
            <label className="lbl" htmlFor="nick">Apodo en la mesa</label>
            <input id="nick" data-testid="nick" value={nick} maxLength={16} placeholder="Ej: Willy" onChange={(e) => setNick(e.target.value)} />
            <div className="avatars">
              {AVATARS.map((a) => (
                <button type="button" key={a} className={a === avatar ? "av on" : "av"} onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
          </>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn gold big" data-testid="entrar" disabled={busy}>
          {busy ? "Un momento…" : mode === "crear" ? "Crear cuenta y jugar" : "Entrar a la mesa"}
        </button>
        <div className="oauth">
          {GROK_PROVIDERS.map((p) => (
            <button key={p.providerId} type="button" className="btn ghost" onClick={() => { rememberInvite(); void signIn(p.providerId, { callbackURL: `${window.location.pathname}${window.location.search}` }); }}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost" onClick={() => setReglas(true)}>¿Cómo se juega?</button>
      </form>
      <p className="foot">500 créditos por correo. Si se acaban, entra con otro. Sin pagos reales.</p>
      {reglas && <Reglas onClose={() => setReglas(false)} />}
    </div>
  );
}
