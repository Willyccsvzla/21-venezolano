import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Correo } from "@/game/ui/Correo";

export const Route = createFileRoute("/")({ component: Home });

function Opening({ text }: { text: string }) {
  return (
    <div className="screen entrada">
      <h1>21 <span>Venezolano</span></h1>
      <p className="tag">{text}</p>
    </div>
  );
}

class Guard extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "No se pudo abrir la mesa" };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="screen entrada">
          <h1>21 <span>Venezolano</span></h1>
          <p className="err">{this.state.error}</p>
          <button className="btn gold" onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Game() {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancel = false;
    void import("@/game/App")
      .then((m) => { if (!cancel) setApp(() => m.default); })
      .catch((e: unknown) => { if (!cancel) setErr(e instanceof Error ? e.message : "No se pudo abrir"); });
    return () => { cancel = true; };
  }, []);
  if (err) {
    return (
      <div className="screen entrada">
        <h1>21 <span>Venezolano</span></h1>
        <p className="err">{err}</p>
        <button className="btn gold" onClick={() => window.location.reload()}>Reintentar</button>
      </div>
    );
  }
  if (!App) return <Opening text="Abriendo la mesa…" />;
  return (
    <Guard>
      <App />
    </Guard>
  );
}

function Home() {
  const { user, isPending } = useCurrentUserState();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  if (isPending && !slow) return <Opening text="Abriendo la mesa…" />;
  if (!user) return <Correo />;
  return <Game />;
}