// Sonidos de naipes sintetizados con WebAudio (sin archivos): barajeo "riffle" y carta que se reparte.
// Cada carta es un chasquido de papel (banda alta) + un golpe seco de cartón (banda media) + un toque grave sobre el paño.
let ctx: AudioContext | null = null;
function storedMute(): boolean {
  try {
    return globalThis.localStorage?.getItem("v21.mute") === "1";
  } catch {
    return false;
  }
}
let muted = storedMute();
export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { globalThis.localStorage?.setItem("v21.mute", m ? "1" : "0"); } catch { /* sin almacenamiento */ }
}
function ac() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch { return null; } }
  return ctx;
}

let master: GainNode | null = null;
function out(c: AudioContext) {
  if (!master || master.context !== c) {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
    master = c.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(c.destination);
  }
  return master;
}

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = c.sampleRate * 2;
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}

function dest(c: AudioContext, pan: number): AudioNode {
  const o = out(c);
  if (typeof c.createStereoPanner !== "function") return o;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(o);
  return p;
}

/** Ruido filtrado con envolvente corta. */
function burst(c: AudioContext, t: number, dur: number, freq: number, q: number, gain: number, to: AudioNode, sweepTo?: number, type: BiquadFilterType = "bandpass") {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(to);
  src.start(t, Math.random() * 1.5, dur + 0.02);
}

function thump(c: AudioContext, t: number, gain: number, to: AudioNode, f0 = 190, f1 = 70) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.05);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(to);
  o.start(t); o.stop(t + 0.09);
}

/** Una carta que choca contra otra o contra el paño. */
function flick(c: AudioContext, t: number, vel: number, pan: number) {
  const to = dest(c, pan);
  const r = () => 0.85 + Math.random() * 0.3;
  burst(c, t, 0.022 * r(), 4200 * r(), 1.4, 0.55 * vel, to);
  burst(c, t + 0.002, 0.04 * r(), 1500 * r(), 0.9, 0.42 * vel, to);
  burst(c, t, 0.012, 7500, 0.8, 0.18 * vel, to, undefined, "highpass");
  thump(c, t, 0.16 * vel, to, 200 * r(), 80);
}

let queuedShuffle = false;
let lastShuffle = 0;

function startShuffle(c: AudioContext) {
  const now = Date.now();
  if (now - lastShuffle < 1400) return;
  lastShuffle = now;
  const t0 = c.currentTime + 0.03;
  // 1) Riffle: dos mitades que se entrelazan, cada vez más rápido.
  let t = t0;
  let gap = 0.062;
  for (let i = 0; i < 40; i++) {
    const side = i % 2 === 0 ? -0.35 : 0.35;
    flick(c, t, 0.55 + Math.random() * 0.35, side + (Math.random() - 0.5) * 0.2);
    t += gap * (0.8 + Math.random() * 0.4);
    gap = Math.max(0.016, gap * 0.935);
  }
  // 2) El "puente": cascada rápida de cartas que caen.
  for (let i = 0; i < 22; i++) {
    const tt = t + i * 0.011 + Math.random() * 0.004;
    flick(c, tt, 0.3 + (i / 22) * 0.35, (Math.random() - 0.5) * 0.6);
  }
  t += 0.3;
  // 3) Se empareja el mazo contra el paño: dos golpes secos.
  const mid = dest(c, 0);
  burst(c, t, 0.07, 900, 0.7, 0.55, mid);
  thump(c, t, 0.55, mid, 150, 55);
  burst(c, t + 0.13, 0.06, 1100, 0.7, 0.45, mid);
  thump(c, t + 0.13, 0.42, mid, 160, 60);
}

function flush(c: AudioContext) {
  if (!queuedShuffle || muted) return;
  queuedShuffle = false;
  startShuffle(c);
}

/** Llamar en el primer toque: los navegadores móviles bloquean el audio hasta entonces. */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") void c.resume().then(() => flush(c)).catch(() => undefined);
  else flush(c);
}

export function playShuffle() {
  if (muted) return;
  const c = ac();
  if (!c) return;
  if (c.state !== "running") {
    queuedShuffle = true;
    void c.resume().then(() => flush(c)).catch(() => undefined);
    return;
  }
  startShuffle(c);
}

/** Carta que se desliza sobre el paño y cae. */
export function playDeal() {
  if (muted) return;
  const c = ac();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  const to = dest(c, (Math.random() - 0.5) * 0.5);
  // deslizamiento (silbido de papel que sube de tono)
  burst(c, t, 0.11, 2200, 0.8, 0.22, to, 5200);
  burst(c, t + 0.015, 0.09, 6000, 0.6, 0.1, to, undefined, "highpass");
  // aterrizaje
  flick(c, t + 0.1, 0.95, 0);
}
