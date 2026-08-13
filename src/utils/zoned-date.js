import { fromZonedTime } from "date-fns-tz";

export function getNextDateOnly(date) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function getZonedDayRange(date, timeZone) {
  return {
    endAt: fromZonedTime(`${getNextDateOnly(date)}T00:00:00`, timeZone),
    startAt: fromZonedTime(`${date}T00:00:00`, timeZone),
  };
}
