import { prisma } from "../db/prisma.js";
import { requirePermissions } from "../auth/require-permission.js";
import { requireClinicalProfessional } from "../auth/clinical-professional.js";
import { validatePatientId } from "../validations/patient-validation.js";
import { validateEncounterId } from "../validations/clinical-validation.js";
import { clinicalInvalid, clinicalText } from "../validations/clinical-form-validation.js";
export const careScope = professionalId => ({
  OR: [{
    appointments: {
      some: {
        professional_id: professionalId,
        status: {
          in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"]
        }
      }
    }
  }, {
    clinical_care_assignments: {
      some: {
        professional_id: professionalId,
        revoked_at: null
      }
    }
  }]
});
const userSelect = {
  id: true,
  first_name: true,
  last_name: true
};
export async function clinicalPatients(query, actor) {
  await requireClinicalProfessional(actor);
  const patientId = query.get("patientId"),
    search = (query.get("search") ?? "").trim(),
    page = Number(query.get("page") ?? 1);
  if (search.length > 100 || !Number.isSafeInteger(page) || page < 1) clinicalInvalid("La búsqueda o la página no es válida.");
  const scope = careScope(actor.userId);
  if (patientId) {
    const row = await prisma.patients.findFirst({
      where: {
        id: validatePatientId(patientId),
        ...scope
      },
      include: {
        appointments: {
          where: {
            professional_id: actor.userId,
            status: {
              in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"]
            }
          },
          select: {
            id: true,
            start_at: true,
            status: true,
            clinical_encounters: {
              select: {
                id: true
              }
            }
          },
          orderBy: {
            start_at: "desc"
          },
          take: 100
        }
      }
    });
    if (!row) clinicalInvalid("No se encontró un paciente autorizado.", "CLINICAL_PATIENT_NOT_FOUND", 404);
    return {
      patient: {
        id: row.id,
        firstNames: row.first_names,
        lastNames: row.last_names,
        rut: row.rut,
        birthDate: row.birth_date.toISOString().slice(0, 10),
        phone: row.phone,
        email: row.email
      },
      appointments: row.appointments.map(a => ({
        id: a.id,
        startAt: a.start_at,
        status: a.status,
        encounterId: a.clinical_encounters?.id ?? null
      }))
    };
  }
  const terms = search ? {
    OR: [{
      first_names: {
        contains: search,
        mode: "insensitive"
      }
    }, {
      last_names: {
        contains: search,
        mode: "insensitive"
      }
    }, {
      rut: {
        contains: search.replaceAll(".", ""),
        mode: "insensitive"
      }
    }]
  } : {};
  const where = {
    AND: [scope, terms]
  };
  const [rows, total] = await prisma.$transaction([prisma.patients.findMany({
    where,
    select: {
      id: true,
      first_names: true,
      last_names: true,
      rut: true
    },
    orderBy: [{
      last_names: "asc"
    }, {
      id: "asc"
    }],
    take: 20,
    skip: (page - 1) * 20
  }), prisma.patients.count({
    where
  })]);
  return {
    items: rows.map(p => ({
      id: p.id,
      firstNames: p.first_names,
      lastNames: p.last_names,
      rut: p.rut
    })),
    page,
    total,
    totalPages: Math.ceil(total / 20)
  };
}
export async function getCareAssignments(query, actor) {
  requirePermissions(actor, ["medical_records.assign_care"]);
  if (query.get("options") === "true") {
    const rows = await prisma.professional_profiles.findMany({
      where: {
        users_professional_profiles_user_idTousers: {
          is_active: true,
          user_roles_user_roles_user_idTousers: {
            some: {
              roles: {
                code: "CLINICAL_PROFESSIONAL"
              }
            }
          }
        }
      },
      include: {
        users_professional_profiles_user_idTousers: {
          select: userSelect
        }
      }
    });
    return rows.map(p => ({
      id: p.user_id,
      name: `${p.users_professional_profiles_user_idTousers.first_name} ${p.users_professional_profiles_user_idTousers.last_name}`
    }));
  }
  const patientId = validatePatientId(query.get("patientId"));
  const rows = await prisma.clinical_care_assignments.findMany({
    where: {
      patient_id: patientId
    },
    include: {
      professional_profiles: {
        include: {
          users_professional_profiles_user_idTousers: {
            select: userSelect
          }
        }
      }
    },
    orderBy: {
      created_at: "desc"
    }
  });
  return rows.map(r => ({
    id: r.id,
    professionalId: r.professional_id,
    professional: `${r.professional_profiles.users_professional_profiles_user_idTousers.first_name} ${r.professional_profiles.users_professional_profiles_user_idTousers.last_name}`,
    reason: r.reason,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    revokeReason: r.revoke_reason
  }));
}
export async function assignCare(input, actor) {
  requirePermissions(actor, ["medical_records.assign_care"]);
  const reason = clinicalText(input?.reason, "El motivo de asignación", 500);
  if (!reason) clinicalInvalid("Indique el motivo de la asignación o revocación.");
  if (input.action === "REVOKE") {
    const id = validateEncounterId(input.id);
    const row = await prisma.clinical_care_assignments.findUnique({
      where: {
        id
      }
    });
    if (!row) clinicalInvalid("No se encontró la asignación.", "CARE_ASSIGNMENT_NOT_FOUND", 404);
    if (row.revoked_at) return {
      revoked: true
    };
    await prisma.clinical_care_assignments.updateMany({
      where: {
        id,
        revoked_at: null
      },
      data: {
        revoked_at: new Date(),
        revoked_by: actor.userId,
        revoke_reason: reason
      }
    });
    return {
      revoked: true
    };
  }
  if (input.confirmPatient !== true) clinicalInvalid("Confirme que verificó la identidad del paciente y la atención solicitada.");
  const patientId = validatePatientId(input.patientId),
    professionalId = validateEncounterId(input.professionalId);
  const [patient, profile] = await Promise.all([prisma.patients.findUnique({
    where: {
      id: patientId
    },
    select: {
      id: true
    }
  }), prisma.professional_profiles.findFirst({
    where: {
      user_id: professionalId,
      users_professional_profiles_user_idTousers: {
        is_active: true,
        user_roles_user_roles_user_idTousers: {
          some: {
            roles: {
              code: "CLINICAL_PROFESSIONAL"
            }
          }
        }
      }
    }
  })]);
  if (!patient || !profile) clinicalInvalid("Seleccione un paciente existente y un profesional clínico habilitado.");
  try {
    return await prisma.clinical_care_assignments.create({
      data: {
        patient_id: patientId,
        professional_id: professionalId,
        assigned_by: actor.userId,
        reason
      },
      select: {
        id: true
      }
    });
  } catch (error) {
    if (error.code === "P2002") clinicalInvalid("El paciente ya está asignado a ese profesional.", "CARE_ASSIGNMENT_EXISTS", 409);
    throw error;
  }
}
