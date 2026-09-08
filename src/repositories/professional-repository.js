import { prisma } from "../db/prisma.js";

const userRelation = "users_professional_profiles_user_idTousers";

function mapProfessional(row) {
  if (!row) return null;
  const user = row[userRelation];
  return {
    appointmentDurationMinutes: row.appointment_duration_minutes,
    createdAt: row.created_at,
    email: user.email,
    firstName: user.first_name,
    id: row.user_id,
    isBookable: row.is_bookable,
    lastName: user.last_name,
    slotIntervalMinutes: row.slot_interval_minutes,
    updatedAt: row.updated_at,
  };
}

const includeUser = { [userRelation]: true };

export async function createProfessionalProfile(profileData, actorUserId) {
  return prisma.$transaction(async (client) => {
    const clinicalUser = await client.users.findFirst({
      select: { id: true },
      where: {
        id: profileData.userId,
        is_active: true,
        user_roles_user_roles_user_idTousers: { some: { roles: { code: "CLINICAL_PROFESSIONAL" } } },
      },
    });
    if (!clinicalUser) return null;
    return mapProfessional(await client.professional_profiles.create({
      data: {
        appointment_duration_minutes: profileData.appointmentDurationMinutes,
        created_by: actorUserId,
        is_bookable: profileData.isBookable,
        slot_interval_minutes: profileData.slotIntervalMinutes,
        updated_by: actorUserId,
        user_id: profileData.userId,
      },
      include: includeUser,
    }));
  });
}

export async function findProfessionalById(professionalId) {
  return mapProfessional(await prisma.professional_profiles.findUnique({
    include: includeUser, where: { user_id: professionalId },
  }));
}

export async function listProfessionalProfiles() {
  const rows = await prisma.professional_profiles.findMany({
    include: includeUser,
    orderBy: [
      { [userRelation]: { last_name: "asc" } },
      { [userRelation]: { first_name: "asc" } },
      { user_id: "asc" },
    ],
  });
  return rows.map(mapProfessional);
}

export async function updateProfessionalProfile(professionalId, profileData, actorUserId) {
  const result = await prisma.professional_profiles.updateMany({
    data: {
      appointment_duration_minutes: profileData.appointmentDurationMinutes,
      is_bookable: profileData.isBookable,
      slot_interval_minutes: profileData.slotIntervalMinutes,
      updated_by: actorUserId,
    },
    where: { user_id: professionalId },
  });
  return result.count ? findProfessionalById(professionalId) : null;
}
