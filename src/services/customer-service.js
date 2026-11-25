import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createCustomer as createCustomerRepository,
  findCustomerById,
  updateCustomer as updateCustomerRepository,
} from "../repositories/customer-repository.js";
import { findPatientById } from "../repositories/patient-repository.js";
import { AppError } from "../utils/app-error.js";
import {commercialCustomers} from "../repositories/customer-commercial-repository.js";
import {commercialQuery} from "../validations/customer-commercial-validation.js";
import { operationBranch } from "../auth/branch-identity.js";
import {saleBranchScope} from "../auth/sale-branch-access.js";
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
  if (!["23505","P2002"].includes(error?.code)) throw error;
  const linkedPatient = error.constraint === "customers_patient_id_key" || error.meta?.target?.includes("patient_id");
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
    const branchId = !dependencies.findPatientById && input.branchId ? await operationBranch(actor, input.branchId) : null;
    const patientActor = branchId ? { ...actor, activeBranchId: branchId } : actor;
    const patient = await (dependencies.findPatientById ? dependencies.findPatientById(data.patientId) : findPatientById(data.patientId, patientActor));
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
    return await (dependencies.createCustomer ?? createCustomerRepository)(customerData, actor.userId, ...(dependencies.createCustomer ? [] : [actor, input.branchId]));
  } catch (error) {
    return convertUniqueViolation(error);
  }
}

export async function getCustomer(customerId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_READ]);
  const id = validateCustomerId(customerId);
  const customer = await (dependencies.findCustomerById ? dependencies.findCustomerById(id) : findCustomerById(id, actor));
  if (!customer) notFound();
  return customer;
}

export async function getCustomerList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_READ]);
  if(dependencies.listCustomers)return dependencies.listCustomers(validateCustomerListQuery(searchParams));
  const requested = searchParams.get("branchId");
  const branchId = requested ? await operationBranch(actor, requested) : null;
  return commercialCustomers(commercialQuery(searchParams), await saleBranchScope(actor, branchId));
}

export async function updateCustomer(customerId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.CUSTOMERS_MANAGE]);
  const id = validateCustomerId(customerId);
  const current = await (dependencies.findCustomerById ? dependencies.findCustomerById(id) : findCustomerById(id, actor));
  if (!current) notFound();
  const data = validateUpdateCustomerInput(input, current);
  try {
    if(input.expectedVersion!=null&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1))throw new AppError({code:"INVALID_CUSTOMER_VERSION",message:"La versión del cliente no es válida.",status:400});
    const customer = await (dependencies.updateCustomer ?? updateCustomerRepository)(id, data, actor.userId, input.expectedVersion, ...(dependencies.updateCustomer ? [] : [actor]));
    if (!customer) notFound();
    return customer;
  } catch (error) {
    return convertUniqueViolation(error);
  }
}
