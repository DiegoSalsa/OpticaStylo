import { prisma } from "../db/prisma.js";
import { requirePermissions } from "./require-permission.js";
import { AppError } from "../utils/app-error.js";
export async function requireClinicalProfessional(actor, permission = "medical_records.read_assigned", client = prisma) {
  requirePermissions(actor, [permission]);
  const profile = actor.roles?.includes("CLINICAL_PROFESSIONAL") ? await client.professional_profiles.findUnique({
    where: {
      user_id: actor.userId
    },
    include: {
      users_professional_profiles_user_idTousers: {
        select: {
          is_active: true,
          first_name: true,
          last_name: true
        }
      }
    }
  }) : null;
  if (!profile?.users_professional_profiles_user_idTousers.is_active) throw new AppError({
    code: "CLINICAL_ACCESS_DENIED",
    message: "El acceso requiere un profesional clínico habilitado.",
    status: 403
  });
  return profile;
}
