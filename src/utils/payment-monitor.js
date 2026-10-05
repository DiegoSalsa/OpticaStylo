export function auditMercadoPagoWebhook(event, logger = console) {
  const entry = JSON.stringify({
    dataId: event.dataId ?? null,
    event: "mercado_pago_webhook",
    outcome: event.outcome,
    requestId: event.requestId ?? null,
    timestamp: new Date().toISOString(),
  });
  if (["INVALID_SIGNATURE", "PROVIDER_ERROR", "REQUIRES_REVIEW"].includes(event.outcome)) {
    logger.warn(entry);
  } else {
    logger.info(entry);
  }
}
