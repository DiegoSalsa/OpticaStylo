import { fromZonedTime } from "date-fns-tz";
// Utilidades compartidas para zoned-date.

// Consultar get next date only y devolver los datos en el formato esperado por la capa llamadora
export function getNextDateOnly(date) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

// Consultar get zoned day range y devolver los datos en el formato esperado por la capa llamadora
export function getZonedDayRange(date, timeZone) {
  return {
    endAt: fromZonedTime(`${getNextDateOnly(date)}T00:00:00`, timeZone),
    startAt: fromZonedTime(`${date}T00:00:00`, timeZone),
  };
}
