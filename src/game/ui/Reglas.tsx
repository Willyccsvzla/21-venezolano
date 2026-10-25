export function Reglas({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box reglas" onClick={(e) => e.stopPropagation()}>
        <h2>Reglas del 21 Venezolano</h2>
        <ul>
          <li>Baraja española de 40 (sin 8 ni 9). As–7 valen su número; sota, caballo y rey valen 0.</li>
          <li>Todos ponen la <b>casa</b>. Se reparten 2 cartas, una a una, empezando por la mano.</li>
          <li>La <b>mano</b> anuncia el total («dos»). Cada uno, en sentido del reloj: <b>voy</b> (iguala), <b>no voy</b> (pierde lo puesto) o <b>subo</b>.</li>
          <li>Tercera carta a quienes van. Ahí <b>no se puede pasar</b>: el que habla apuesta o no va. No hay conteo automático. <b>Sin límite de subidas</b>: se sube y resube hasta igualar o retirarse. <b>Sin tope</b>: puedes apostar lo que quieras hasta tu saldo (o ir de resto).</li>
          <li><b>Farol</b>: si nadie iguala tu apuesta, ganas el pozo sin mostrar cartas ni puntos. Si la mano gana con su propio anuncio o subida, deja su casa para la siguiente. Si otro subió y la mano no fue, ese se lleva el pozo entero.</li>
          <li>Gana la suma más alta. El máximo es 21 (7-7-7): no te puedes pasar. Empate lo gana la mano. Tres ases = 3. Tres sietes = 21, mano normal.</li>
          <li>La <b>mano</b> rota cada partida en sentido del reloj, aunque se haya retirado.</li>
          <li><b>Resto</b>: te juegas todo el saldo. Quien no alcanza va con todo y solo cobra lo que cubrió.</li>
        </ul>
        <button className="btn gold" onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}
