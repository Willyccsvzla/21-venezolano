import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Correo } from "@/game/ui/Correo";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="screen entrada">
        <p className="tag">Abriendo la mesa…</p>
      </div>
    );
  }
  if (user) return <Navigate to="/" />;
  return <Correo />;
}
