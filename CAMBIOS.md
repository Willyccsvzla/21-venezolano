# Cambios (pulido de cartas, sonido y fluidez)
- Naipes: se recortó el borde negro de 3 px y las esquinas negras opacas de las 41 imágenes (eran las "manchas"). Ahora tienen esquinas redondeadas con transparencia, filete crema y nitidez leve. Mismo mazo y mismo estilo.
- CSS: `object-fit: contain` (ya no recorta), sombras en la imagen en vez de filtros sobre el contenedor, animación de reparto y brillo suave, botones con respuesta al toque.
- Sonido: barajeo tipo riffle (puente + golpes al paño) y carta que se desliza y cae, con paneo estéreo; el reparto suena después del barajeo.
- Red: la mesa consulta cada 0,8 s sin pedidos solapados, no retrocede a una respuesta vieja y se pausa con la pestaña oculta.
- Motor, economía, salas y marca: sin cambios.
