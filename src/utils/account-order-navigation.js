const key = "optica-stylo:account-payment-return";
const orderIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function accountOrderHref(orderId) {
  return "/cuenta?seccion=pedidos&pedido=" + encodeURIComponent(orderId);
}

export function rememberAccountPayment(orderId) {
  try {
    if (orderId && orderIdPattern.test(orderId)) window.sessionStorage.setItem(key, orderId);
    else window.sessionStorage.removeItem(key);
  } catch {
    // El retorno del proveedor sigue disponible sin almacenamiento del navegador.
  }
}

export function pendingAccountPaymentOrder() {
  try {
    const orderId = window.sessionStorage.getItem(key);
    return orderIdPattern.test(orderId ?? "") ? orderId : null;
  } catch {
    return null;
  }
}
