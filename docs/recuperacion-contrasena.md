# Recuperación y restablecimiento de contraseña

El módulo separa las cuentas internas de las cuentas de clientes de la tienda.
Cada ámbito tiene rutas de solicitud y restablecimiento independientes; una
solicitud de un ámbito nunca busca ni consume credenciales del otro.

La solicitud devuelve el mismo mensaje para una dirección desconocida, una
cuenta inactiva y una cuenta válida. Se aplican cuotas por red e identificador
antes de consultar la cuenta o ejecutar el restablecimiento. Las solicitudes
con formato válido usan además una duración mínima con variación acotada para
reducir diferencias temporales observables entre cuentas existentes y ausentes.

Cada solicitud válida revoca sus solicitudes anteriores, registra solo el hash
del token, vence en quince minutos y crea un mensaje `PASSWORD_RECOVERY` en la
outbox. El correo obtiene el enlace al momento de enviarse a partir del
identificador de solicitud, el ámbito y una clave de servidor. No se almacenan
tokens ni enlaces de recuperación en la base de datos, registros, pruebas o
documentación.

Antes de renderizar un correo, el trabajador consulta nuevamente la solicitud.
Los mensajes asociados a solicitudes vencidas, revocadas, consumidas o ausentes
se suprimen sin generar ni enviar el enlace.

Al consumir una solicitud válida, la actualización de contraseña, el consumo
de un solo uso, la revocación de solicitudes restantes y la revocación de todas
las sesiones activas suceden en una sola transacción. La auditoría conserva
ámbito, evento y metadatos mínimos de la solicitud; no incluye secretos ni
información clínica.

La entrega de correo continúa sujeta a la configuración existente de la
outbox. Además requiere configurar el origen público y la clave de derivación
descritos en la documentación de correos transaccionales. La interfaz de
solicitud y restablecimiento no se implementó porque no existe una pantalla
Stitch aprobada para esos estados; debe aprobarse antes de habilitar entrega
para personas usuarias.
