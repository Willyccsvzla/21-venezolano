// Habladera de mesa de los bots (venezolana, cortica).
const T = {
  sube: ['¡Ahí te va, pana!', 'Súbele, que estoy prendío 🔥', 'Esto se puso bueno', '¿Quién dijo miedo?', 'Pa’ que respeten'],
  farol: ['Tranquilo, que yo sí tengo 😏', 'Ajá, ¿y quién va?', 'No me vean así…'],
  voy: ['Voy, voy', 'Dale pues', 'Aquí estoy', 'Ni de vaina me voy'],
  noVoy: ['Paso', 'Me salgo, chamo', 'Ni loco, paso', 'Esa no es mía'],
  resto: ['¡Resto! Que sea lo que Dios quiera', 'Todo pa’ dentro 💰', '¡Me jugué la quincena!'],
  gana: ['¡Ese pote es mío! 😎', 'Gracias por la colaboración', 'Fácil, mi pana', 'Así se juega en Maracaibo'],
  ganaFarol: ['Nunca sabrán lo que tenía 🤫', 'Se asustaron, ¿verdad?', 'Con cualquier cosa les gano'],
  responde: ['¡Epa! ¿Y esa subida?', 'Ese tiene miedo', 'Mosca con ese', 'Ajá, ¿tienes o no tienes?', 'Chamo, cálmate'],
  pierde: ['Qué vaina…', 'Me salió mala la mano', 'La próxima es mía', 'Uy, casi'],
};
export type TalkKind = keyof typeof T;
export function line(kind: TalkKind, r = Math.random): string {
  const a = T[kind]; return a[Math.floor(r() * a.length)];
}
