# Decisiones provisionales de comercio electrónico

Estas decisiones permiten avanzar con la etapa 5 antes de la validación final
con la clienta. Deben revisarse cuando se confirme el proceso operativo real.

El backend correspondiente ya está implementado. Los puntos marcados como mock
o no configurados siguen pendientes de definición externa, no de interfaz.

## Compradores y entrega

- La tienda aceptará compras con cuenta y como invitado.
- Se ofrecerán retiro en tienda y despacho.
- El despacho será realizado por un agente externo. Provisionalmente se
  modelará con disponibilidad, tarifa y estado simulados hasta confirmar el
  proveedor, las zonas, los plazos y la forma de cobro.

## Catálogo y disponibilidad

- Se podrán comprar marcos sin receta.
- La tienda mostrará lentes y accesorios; categorías y surtido definitivo están
  pendientes de confirmación.
- Hasta conectar la etapa 6 de inventario se usará disponibilidad simulada. La
  simulación no debe presentarse como una reserva real de stock.
- Cristales, tratamientos y adicionales se cobrarán por separado. Los importes
  quedan configurables porque todavía no están confirmados.

## Recetas externas

- Una compra de solo marco no requiere receta.
- Una compra que incluya cristales con graduación sí requiere una receta.
- El comprador podrá subir una imagen de la receta o completar sus datos
  manualmente.
- Se proyecta una lectura asistida de la imagen para proponer los datos al
  negocio. El resultado se guardará como borrador y deberá poder corregirse
  antes de utilizarlo; el archivo original se conservará como respaldo.
- No se agrega por ahora un flujo separado de aprobación clínica. Sí se deben
  conservar trazabilidad, fuente de los datos y correcciones.

## Pagos

- Habrá integración real de pagos, comenzando con Mercado Pago Checkout Pro.
- Los intentos del proveedor, sus notificaciones y los abonos aprobados se
  registran históricamente; no se eliminan físicamente.
- Esta fase continúa con enfoque backend primero. El frontend se implementará
  después de completar y validar los contratos de la API.
