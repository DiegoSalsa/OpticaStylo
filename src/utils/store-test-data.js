export function canUseStoreTestData(environment = process.env) {
  return environment.NODE_ENV !== "production"
    || (environment.DEPLOYMENT_ENVIRONMENT === "university"
      && environment.STORE_INCLUDE_TEST_DATA === "true");
}
