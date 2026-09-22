const DEFAULT_TIME_ZONE = "America/Santiago";
// Configuración centralizada de agenda.

// Consultar get agenda time zone y devolver los datos en el formato esperado por la capa llamadora
export function getSchedulingTimeZone(environment = process.env) {
  const timeZone = environment.APP_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("es-CL", { timeZone }).format(new Date());
  } catch {
    throw new Error("APP_TIME_ZONE debe contener una zona horaria IANA válida.");
  }

  return timeZone;
}
