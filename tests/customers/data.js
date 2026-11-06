import { fixtureRut } from "../rut-fixture.js";
export const commercialDemo = {
  customerId: "43000000-0000-4000-8000-000000000001",
  staffBId: "43000000-0000-4000-8000-000000000002",
  staffBEmail: "ventas-sucursal-b@example.invalid",
  products: ["43000000-0000-4000-8000-000000000003", "43000000-0000-4000-8000-000000000004"],
  customer: {
    firstNames: "Cliente recurrente",
    lastNames: "Sintético",
    rut: fixtureRut(9650),
    phone: "+56981112222",
    email: "comercio-recurrente@example.invalid",
    address: "Dirección exclusivamente sintética"
  }
};
