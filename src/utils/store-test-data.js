// Determinar si can use tienda test datos cumple la condición requerida por la aplicación
export function canUseStoreTestData(environment = process.env) {
  return environment.NODE_ENV !== "production"
    || (environment.DEPLOYMENT_ENVIRONMENT === "university"
      && environment.STORE_INCLUDE_TEST_DATA === "true");
}
// Utilidades compartidas para store-test-data.
// Determinar si can use tienda test datos cumple la condición requerida por la aplicación
