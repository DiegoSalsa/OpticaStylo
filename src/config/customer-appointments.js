const DEFAULT_NOTICE_HOURS = 24;

export function getCustomerAppointmentNoticeHours(environment = process.env) {
  const raw = environment.CUSTOMER_APPOINTMENT_CHANGE_NOTICE_HOURS?.trim();
  const configured = raw ? Number(raw) : DEFAULT_NOTICE_HOURS;
  return Number.isInteger(configured) && configured >= 0 && configured <= 168 ? configured : DEFAULT_NOTICE_HOURS;
}

export function customerAppointmentChangeDeadline(startAt, hours = getCustomerAppointmentNoticeHours()) {
  return new Date(new Date(startAt).getTime() - hours * 3_600_000);
}
