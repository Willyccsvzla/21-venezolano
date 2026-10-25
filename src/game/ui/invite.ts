const KEY = "v21.invite";

export function rememberInvite() {
  if (typeof window === "undefined") return;
  const live = new URLSearchParams(window.location.search);
  const mesa = live.get("mesa")?.trim().toUpperCase();
  const sala = live.get("sala")?.trim();
  try {
    if (mesa) sessionStorage.setItem(KEY, `m:${mesa}`);
    else if (sala) sessionStorage.setItem(KEY, `s:${sala}`);
  } catch { /* el iframe a veces bloquea storage */ }
}

export function readInvite(): { mesa: string; sala: string } {
  const live = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  let mesa = live.get("mesa")?.trim().toUpperCase() ?? "";
  let sala = live.get("sala")?.trim() ?? "";
  if (typeof window !== "undefined" && (!mesa || !sala)) {
    try {
      const saved = sessionStorage.getItem(KEY) ?? "";
      if (!mesa && saved.startsWith("m:")) mesa = saved.slice(2);
      if (!sala && saved.startsWith("s:")) sala = saved.slice(2);
      if (mesa && mesa.length < 4) mesa = "";
    } catch { /* sin storage */ }
  }
  return { mesa, sala };
}

export function inviteUrl(code: string | null, tableId: string): string {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (code) url.searchParams.set("mesa", code);
  else url.searchParams.set("sala", tableId);
  return url.toString();
}
