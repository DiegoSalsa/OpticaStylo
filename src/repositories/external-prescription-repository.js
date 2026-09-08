import { prisma } from "../db/prisma.js";

function mapPrescription(row) {
  if (!row) return null;
  return {
    confirmedAt: row.confirmed_at, confirmedData: row.confirmed_data,
    createdAt: row.created_at, customerId: row.customer_id,
    cloudinaryAssetId: row.cloudinary_asset_id, fileSha256: row.file_sha256,
    fileSizeBytes: row.file_size_bytes, hasImage: row.source === "IMAGE", id: row.id,
    mediaType: row.media_type, originalFilename: row.original_filename,
    patient: row.patients ? {
      firstNames: row.patients.first_names, id: row.patients.id,
      lastNames: row.patients.last_names, rut: row.patients.rut,
    } : null,
    source: row.source, status: row.status, updatedAt: row.updated_at,
  };
}

async function findExternalPrescriptionWithClient(client, id) {
  return mapPrescription(await client.external_prescriptions.findUnique({
    include: { patients: true }, where: { id },
  }));
}

export async function createPointOfSaleExternalPrescription(input, actorUserId) {
  return prisma.$transaction(async (client) => {
    const [customer, patient] = await Promise.all([
      client.customers.findUnique({ select: { id: true }, where: { id: input.customerId } }),
      client.patients.findUnique({ select: { id: true }, where: { id: input.patientId } }),
    ]);
    if (!customer) return { prescription: null, reason: "CUSTOMER_NOT_FOUND" };
    if (!patient) return { prescription: null, reason: "PATIENT_NOT_FOUND" };
    const created = await client.external_prescriptions.create({ data: {
      cloudinary_asset_id: input.cloudinary?.assetId ?? null,
      cloudinary_format: input.cloudinary?.format ?? null,
      cloudinary_public_id: input.cloudinary?.publicId ?? null,
      cloudinary_version: input.cloudinary?.version ?? null,
      confirmed_at: input.confirmedAt, confirmed_data: input.confirmedData,
      created_by: actorUserId, customer_id: input.customerId,
      extraction_status: input.source === "IMAGE" ? "NOT_CONFIGURED" : "NOT_REQUESTED",
      file_data: input.data, file_sha256: input.sha256, file_size_bytes: input.size,
      media_type: input.mediaType, original_filename: input.filename,
      patient_id: input.patientId, source: input.source, status: "READY",
    } });
    return { prescription: await findExternalPrescriptionWithClient(client, created.id), reason: null };
  });
}

export async function findExternalPrescriptionById(id) {
  return findExternalPrescriptionWithClient(prisma, id);
}

export async function listExternalPrescriptionsByPatient(patientId) {
  return (await prisma.external_prescriptions.findMany({
    include: { patients: true }, orderBy: { created_at: "desc" },
    where: { patient_id: patientId, status: "READY" },
  })).map(mapPrescription);
}

export async function findExternalPrescriptionFileById(id) {
  const row = await prisma.external_prescriptions.findFirst({
    select: {
      cloudinary_asset_id: true, cloudinary_format: true, cloudinary_public_id: true,
      cloudinary_version: true, file_data: true, media_type: true, original_filename: true,
    },
    where: { id, source: "IMAGE" },
  });
  return row ? {
    cloudinary: row.cloudinary_asset_id ? {
      assetId: row.cloudinary_asset_id, format: row.cloudinary_format,
      publicId: row.cloudinary_public_id, version: Number(row.cloudinary_version),
    } : null,
    data: row.file_data, filename: row.original_filename, mediaType: row.media_type,
  } : null;
}
