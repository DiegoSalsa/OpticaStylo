import { createHash } from "node:crypto";
import { shippingConfiguration, shippingError } from "../../config/shipping.js";

// Official OpenAPI exports, checked 2026-11-06:
// https://developers.wschilexpress.com/api-details#api=georeference-rest-api
// https://developers.wschilexpress.com/api-details#api=rest-rating-api&operation=Rate
// https://developers.wschilexpress.com/api-details#api=rest-transport-orders-api
// All three currently publish v1.0 with subscription keys per service.
export function createChilexpress({ config = shippingConfiguration(), fetcher = fetch } = {}) {
  async function call(service, path, body) {
    if (config.mode === "disabled" || !config.keys[service]) shippingError("SHIPPING_NOT_CONFIGURED", "Chilexpress todavía no está configurado.", 503);
    let response;
    let json;
    try {
      response = await fetcher(`${config.host}/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
        headers: { "Ocp-Apim-Subscription-Key": config.keys[service], "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
      json = await response.json();
    } catch { shippingError("SHIPPING_PROVIDER_UNAVAILABLE", "Chilexpress no respondió. Conservamos la última información válida.", 503); }
    if ([401, 403].includes(response.status)) shippingError("SHIPPING_NOT_CONFIGURED", "El servicio requiere credenciales habilitadas.", 503);
    if ((!response.ok || Number(json.statusCode) !== 0) && service === "coverage" && path.endsWith("/georeference") && response.status < 500) shippingError("SHIPPING_ADDRESS_INVALID", "Chilexpress no reconoció la dirección. Revise calle y numeración.", 422);
    if (!response.ok || Number(json.statusCode) !== 0) shippingError("SHIPPING_PROVIDER_REJECTED", "Chilexpress no pudo validar esta operación. Revise los datos o reintente más tarde.", 503);
    return json;
  }
  const api = {
    config,
    async regions() { return (await call("coverage", "georeference/api/v1.0/regions")).regions; },
    async counties(region) { return (await call("coverage", `georeference/api/v1.0/coverage-areas?RegionCode=${encodeURIComponent(region)}&type=0`)).coverageAreas; },
    async address(destination) {
      const result = await call("coverage", "georeference/api/v1.0/addresses/georeference", { countyName: destination.countyName, streetName: destination.street, number: destination.number });
      if (!Number.isSafeInteger(result.data?.addressId) || result.data.addressId <= 0) shippingError("SHIPPING_ADDRESS_INVALID", "Chilexpress no reconoció la dirección.", 422);
      return { addressId: result.data.addressId };
    },
    async rates(input) {
      const result = await call("rating", "rating/api/v1.0/rates/courier", input);
      const options = result.data?.courierServiceOptions;
      if (!Array.isArray(options)) shippingError("SHIPPING_PROVIDER_UNAVAILABLE", "Respuesta de cotización incompleta.", 503);
      return options.map((o) => ({ serviceCode: String(o.serviceTypeCode), service: o.serviceDescription, providerCost: Number(o.serviceValue), conditions: o.conditions ?? "" }))
        .filter((o) => /^\d+$/.test(o.serviceCode) && typeof o.service === "string" && Number.isSafeInteger(o.providerCost) && o.providerCost >= 0);
    },
    async issue(input) {
      if (!config.ordersEnabled || !config.tcc || !/^\d+$/.test(config.rut ?? "") || !/^\d+$/.test(config.sellerRut ?? "")) shippingError("SHIPPING_ORDERS_NOT_CONFIGURED", "Falta habilitar la emisión de OT, TCC y RUT empresa/remitente.");
      const result = await call("orders", "transport-orders/api/v1.0/transport-orders", input);
      const detail = result.data?.detail;
      if (!Array.isArray(detail) || detail.length !== 1 || (detail[0].statusCode != null && Number(detail[0].statusCode) !== 0) || !detail[0].transportOrderNumber) shippingError("SHIPPING_RESULT_UNCERTAIN", "La emisión requiere conciliación antes de reintentar.");
      return { ot: String(detail[0].transportOrderNumber), certificate: String(result.data.header?.certificateNumber ?? ""), service: detail[0].serviceDescription ?? null, label: detail[0].label?.labelData ?? null };
    },
    async track({ ot, reference }) {
      if (!/^\d+$/.test(config.rut ?? "")) shippingError("SHIPPING_ORDERS_NOT_CONFIGURED", "Falta configurar el RUT empresa.");
      const result = await call("orders", "transport-orders/api/v1.0/tracking", { transportOrderNumber: ot ? Number(ot) : 0, reference, rut: Number(config.rut), showTrackingEvents: 1 });
      const data = result.data;
      if (!data?.transportOrderData?.transportOrderNumber) shippingError("SHIPPING_RESULT_UNCERTAIN", "No se encontró una OT verificable para esta referencia.");
      // Keep only logistics, never receptor RUT, coordinates or proof-of-delivery URLs.
      return { ot: String(data.transportOrderData.transportOrderNumber), reference: data.transportOrderData.reference, description: data.transportOrderData.status,
        events: (data.trackingEvents ?? []).map((e) => ({ code: String(e.code?.eventCode ?? ""), description: e.description, occurredAt: e.eventDateTime ?? null, location: e.location ?? null, motive: e.motive ?? null })) };
    },
    async label(ot) {
      const result = await call("orders", "transport-orders/api/v1.0/transport-orders-labels", { transportOrderNumber: Number(ot), labelType: 2 });
      const detail = result.data?.detail;
      const label = (Array.isArray(detail) ? detail[0] : detail)?.label?.labelData;
      if (!label) shippingError("SHIPPING_LABEL_UNAVAILABLE", "La etiqueta no está disponible para reimpresión.");
      return label;
    },
  };
  return api;
}

// Deliberately separate deterministic adapter. It never calls the carrier.
export function createSyntheticChilexpress(config = shippingConfiguration()) {
  if (!config.synthetic) shippingError("SYNTHETIC_SHIPPING_FORBIDDEN", "El simulador no está habilitado.");
  const otFor = (reference) => `TEST-${createHash("sha256").update(reference).digest("hex").slice(0, 16)}`;
  return {
    config,
    async regions() { return [{ regionId: "TEST-RM", regionName: "Región sintética de prueba" }]; },
    async counties() { return [{ countyCode: "TEST-DEST", countyName: "Comuna sintética", regionCode: "TEST-RM" }, { countyCode: "TEST-NONE", countyName: "Destino sin cobertura (prueba)", regionCode: "TEST-RM" }]; },
    async address(d) {
      if (d.countyCode === "TEST-NONE") shippingError("SHIPPING_NO_COVERAGE", "Destino sintético sin cobertura.", 422);
      if (d.street === "ERROR TEMPORAL") shippingError("SHIPPING_PROVIDER_UNAVAILABLE", "Error temporal sintético del proveedor.", 503);
      if (d.number === "0") shippingError("SHIPPING_ADDRESS_INVALID", "Dirección sintética inválida.", 422);
      return { addressId: 123456 };
    },
    async rates() { return [{ serviceCode: "3", service: "Servicio SINTÉTICO · NO PRODUCTIVO", providerCost: 4990, conditions: "Cotización de prueba. Sin promesa de entrega." }]; },
    async issue(input) { const reference = input.details[0].packages[0].deliveryReference; return { ot: otFor(reference), certificate: "TEST-CERTIFICATE", service: "SINTÉTICO", label: null }; },
    async track({ reference }) { return { ot: otFor(reference), reference, description: "Seguimiento SINTÉTICO", events: [{ code: "11", description: "En tránsito SINTÉTICO · NO PRODUCTIVO", occurredAt: "2026-11-01T12:00:00Z", location: "Centro sintético", motive: null }] }; },
    async label() { return null; },
  };
}

export function shippingProvider() {
  const config = shippingConfiguration();
  return config.synthetic ? createSyntheticChilexpress(config) : createChilexpress({ config });
}
