import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { findAccountDependant } from "./account-family-repository.js";
import { accountPage, readAccountPage } from "../utils/account-pagination.js";

export function savedPrescriptionScope(accountId) {
  return { cart_id: null, created_by: null, customers: { customer_accounts: { id: accountId, is_active: true } } };
}

const summary = {
  id: true, original_filename: true, created_at: true, confirmed_at: true,
  file_sha256: true, status: true, extraction_status: true, extracted_data: true, confirmed_data: true,
};

function publicPrescription(row) {
  if (!row) return null;
  return {
    id: row.id, filename: row.original_filename, createdAt: row.created_at,
    confirmedAt: row.confirmed_at, imageHash: row.file_sha256, status: row.status,
    extractionStatus: row.extraction_status,
    extractedData: row.extraction_status === "COMPLETED" ? row.extracted_data : null,
    confirmedData: row.confirmed_data,
  };
}

export async function listAccountPrescriptions(accountId, dependantId, options) {
  return prisma.$transaction(async (client) => {
    if (dependantId && !await findAccountDependant(accountId, dependantId, client)) {
      return accountPage([], { pageSize: options.pageSize });
    }
    const result = await readAccountPage(client.external_prescriptions, options, {
      where: { ...savedPrescriptionScope(accountId), dependant_id: dependantId },
      select: { id: true, original_filename: true, created_at: true, status: true, extraction_status: true },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    });
    return { ...result, items: result.items.map((row) => ({
      id: row.id, filename: row.original_filename, createdAt: row.created_at, status: row.status,
      extractionStatus: row.extraction_status,
    })) };
  }, { isolationLevel: "RepeatableRead" });
}

export async function saveAccountPrescription(accountId, image, dependantId = null) {
  return retryTransaction(prisma, async (client) => {
    const account = await client.customer_accounts.findUnique({ where: { id: accountId, is_active: true } });
    if (!account) return null;
    if (dependantId && !await findAccountDependant(accountId, dependantId, client)) return null;
    const record = await client.external_prescriptions.create({
      data: {
        customer_id: account.customer_id, dependant_id: dependantId, source: "IMAGE", status: "DRAFT",
        original_filename: image.filename, media_type: image.mediaType,
        file_size_bytes: image.data.length, file_sha256: image.sha256, file_data: image.data,
      }, select: summary,
    });
    return publicPrescription(record);
  });
}

export async function findAccountPrescriptionImage(accountId, id) {
  return prisma.external_prescriptions.findFirst({
    where: { id, ...savedPrescriptionScope(accountId) },
    select: { file_data: true, media_type: true, original_filename: true },
  });
}

export async function claimAccountPrescriptionReading(accountId, id, now = new Date()) {
  return retryTransaction(prisma, async (client) => {
    await client.$queryRaw`SELECT id FROM external_prescriptions WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await client.external_prescriptions.findFirst({ where: { id, ...savedPrescriptionScope(accountId) } });
    if (!row) return { reason: "NOT_FOUND" };
    if (row.extraction_status === "COMPLETED") return { prescription: publicPrescription(row), cached: true };
    if (row.extraction_status === "PENDING" && row.updated_at > new Date(now.getTime() - 120_000)) return { reason: "READING" };
    const requestId = randomUUID();
    await client.external_prescriptions.update({ where: { id }, data: {
      extraction_status: "PENDING", extracted_data: { requestId }, extraction_provider: "OPENAI_GPT_5_6_LUNA",
    } });
    return { requestId, image: { data: row.file_data, mediaType: row.media_type, filename: row.original_filename } };
  });
}

export async function finishAccountPrescriptionReading(accountId, id, requestId, extraction) {
  const changed = await prisma.external_prescriptions.updateMany({
    where: { id, ...savedPrescriptionScope(accountId), extraction_status: "PENDING", extracted_data: { equals: { requestId } } },
    data: extraction
      ? { extraction_status: "COMPLETED", extracted_data: extraction.data, extraction_provider: extraction.provider }
      : { extraction_status: "FAILED", extracted_data: null },
  });
  if (!changed.count) return null;
  return publicPrescription(await prisma.external_prescriptions.findFirst({ where: { id, ...savedPrescriptionScope(accountId) }, select: summary }));
}

export async function confirmAccountPrescription(accountId, id, imageHash, data) {
  const changed = await prisma.external_prescriptions.updateMany({
    where: { id, ...savedPrescriptionScope(accountId), file_sha256: imageHash, extraction_status: "COMPLETED", status: "DRAFT" },
    data: { confirmed_data: data, confirmed_at: new Date(), status: "READY" },
  });
  if (!changed.count) return null;
  return publicPrescription(await prisma.external_prescriptions.findFirst({ where: { id, ...savedPrescriptionScope(accountId) }, select: summary }));
}
