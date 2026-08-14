import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createCustomer as createCustomerRepository,
  findCustomerById,
  listCustomers,
  updateCustomer as updateCustomerRepository,
} from "../repositories/customer-repository.js";
import { findPatientById } from "../repositories/patient-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreateCustomerInput,
  validateCustomerId,
  validateCustomerListQuery,
  validateUpdateCustomerInput,
} from "../validations/customer-validation.js";

function notFound() {
  throw new AppError({ code: "CUSTOMER_NOT_FOUND", message: "No se encontró el cliente.", status: 404 });
}

function convertUniqueViolation(error) {
  if (error?.code !== "23505") throw error;
  const linkedPatient = error.constraint === "customers_patient_id_key";
  throw new AppError({
    code: linkedPatient ? "PATIENT_ALREADY_HAS_CUSTOMER" : "CUSTOMER_RUT_ALREADY_EXISTS",
    message: linkedPatient
      ? "El paciente ya se encuentra vinculado a otro cliente."
      : "Ya existe un cliente registrado con ese RUT.",
    status: 409,
    cause: error,
  });
}

export async function createCustomer(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_MANAGE]);
  const data = validateCreateCustomerInput(input);
  let customerData = data;

  if (data.copyPatientData) {
    const patient = await (dependencies.findPatientById ?? findPatientById)(data.patientId);
    if (!patient) {
      throw new AppError({ code: "PATIENT_NOT_FOUND", message: "No se encontró el paciente.", status: 404 });
    }
    customerData = {
      address: patient.address,
      email: patient.email,
      firstNames: patient.firstNames,
      lastNames: patient.lastNames,
      patientId: patient.id,
      phone: patient.phone,
      rut: patient.rut,
    };
  }

  try {
    return await (dependencies.createCustomer ?? createCustomerRepository)(customerData, actor.userId);
  } catch (error) {
    return convertUniqueViolation(error);
  }
}

export async function getCustomer(customerId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_READ]);
  const id = validateCustomerId(customerId);
  const customer = await (dependencies.findCustomerById ?? findCustomerById)(id);
  if (!customer) notFound();
  return customer;
}

export async function getCustomerList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_READ]);
  return (dependencies.listCustomers ?? listCustomers)(validateCustomerListQuery(searchParams));
}

export async function updateCustomer(customerId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_MANAGE]);
  const id = validateCustomerId(customerId);
  const find = dependencies.findCustomerById ?? findCustomerById;
  const current = await find(id);
  if (!current) notFound();
  const data = validateUpdateCustomerInput(input, current);
  try {
    const customer = await (dependencies.updateCustomer ?? updateCustomerRepository)(id, data, actor.userId);
    if (!customer) notFound();
    return customer;
  } catch (error) {
    return convertUniqueViolation(error);
  }
}
