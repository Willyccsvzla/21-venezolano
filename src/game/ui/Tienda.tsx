import { BONO_INICIAL } from "../packs";

export function Tienda({ balance, onContinue, onBack }: {
  balance: number;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen tienda">
      <header className="bar">
        <button className="btn ghost sm" onClick={onBack}>← Salir</button>
        <h2>Tu saldo</h2>
        <div className="bal" data-testid="balance">🪙 {balance}</div>
      </header>
      <div className="panel login" style={{ margin: "12px auto" }}>
        <p className="note">Al crear la cuenta con un correo se acreditan <b>{BONO_INICIAL} créditos</b>. No se reponen y no hay compra.</p>
        <p className="note">Si los consumes, la única forma de volver a jugar es entrar con otro correo.</p>
        <p className="note">Los bots juegan corto: no sueltan un pozo grande.</p>
      </div>
      <div className="row-actions">
        <button className="btn gold big" data-testid="ir-salas" onClick={onContinue}>Ir a las salas →</button>
      </div>
    </div>
  );
}
