import {
  InvalidWebhookSignatureError,
  MerchantOrder,
  MercadoPagoConfig,
  Payment,
  Preference,
  WebhookSignatureValidator,
} from "mercadopago";

function createClient(accessToken) {
  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  });
}

function checkoutUrls(publicUrl) {
  if (!publicUrl) return {};
  return {
    auto_return: "approved",
    back_urls: {
      failure: `${publicUrl}/checkout/mercado-pago/failure`,
      pending: `${publicUrl}/checkout/mercado-pago/pending`,
      success: `${publicUrl}/checkout/mercado-pago/success`,
    },
    notification_url: `${publicUrl}/api/webhooks/mercado-pago?source_news=webhooks`,
  };
}

export async function createMercadoPagoPreference({ attempt, config, sale }) {
  const preference = new Preference(createClient(config.accessToken));
  const response = await preference.create({
    body: createMercadoPagoPreferenceBody({ attempt, config, sale }),
    requestOptions: { idempotencyKey: attempt.idempotencyKey },
  });

  return {
    checkoutUrl: selectMercadoPagoCheckoutUrl(response),
    externalPreferenceId: response.id,
    sandboxCheckoutUrl: response.sandbox_init_point ?? null,
  };
}

export function selectMercadoPagoCheckoutUrl(preference) {
  return preference.init_point ?? preference.sandbox_init_point ?? null;
}

export function createMercadoPagoPreferenceBody({ attempt, config, sale }) {
  return {
      ...checkoutUrls(config.publicUrl),
      external_reference: attempt.id,
      expires: true,
      expiration_date_to: attempt.expiresAt.toISOString(),
      items: [{
        currency_id: "CLP",
        id: sale.id,
        quantity: 1,
        title: `Compra Optica Stylo - Venta ${sale.saleNumber}`.slice(0, 256),
        unit_price: attempt.amountCents,
      }],
      metadata: {
        payment_attempt_id: attempt.id,
        sale_id: sale.id,
        sale_number: sale.saleNumber,
      },
      payer: {
        email: sale.customer.email,
        name: sale.customer.firstNames,
        surname: sale.customer.lastNames,
      },
      statement_descriptor: "OPTICA STYLO",
  };
}

export async function getMercadoPagoPayment(paymentId, config) {
  const client = createClient(config.accessToken);
  const payment = new Payment(client);
  const response = await payment.get({ id: paymentId });
  let merchantOrder = null;

  if (!response.preference_id && response.order?.id) {
    merchantOrder = await new MerchantOrder(client).get({
      merchantOrderId: response.order.id,
    });
  }

  return {
    currency: response.currency_id,
    lastUpdatedAt: response.date_last_updated ?? null,
    liveMode: response.live_mode,
    externalPaymentId: String(response.id),
    externalPreferenceId: resolveExternalPreferenceId(response, merchantOrder),
    externalReference: response.external_reference ?? null,
    status: response.status,
    statusDetail: response.status_detail ?? null,
    transactionAmount: response.transaction_amount,
  };
}

export function resolveExternalPreferenceId(payment, merchantOrder) {
  return payment.preference_id ?? merchantOrder?.preference_id ?? null;
}

export function validateMercadoPagoSignature({
  dataId,
  secret,
  xRequestId,
  xSignature,
}) {
  WebhookSignatureValidator.validate({
    dataId,
    secret,
    xRequestId,
    xSignature,
  });
}

export { InvalidWebhookSignatureError };
