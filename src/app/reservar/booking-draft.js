const STORAGE_KEY = "opticastylo:booking-recovery";
const LIFETIME_MS = 30 * 60_000;

export function saveBookingDraft({ professionalId, date, startAt }) {
  try {
    if (!professionalId || !date || !startAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ professionalId, date, startAt, expiresAt: Date.now() + LIFETIME_MS }));
  } catch {
    // El navegador puede bloquear el almacenamiento. La reserva sigue disponible.
  }
}

export function takeBookingDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const draft = JSON.parse(raw);
    if (Number.isFinite(draft?.expiresAt) && draft.expiresAt > Date.now()
      && /^[a-f0-9-]{36}$/i.test(draft.professionalId)
      && /^\d{4}-\d{2}-\d{2}$/.test(draft.date)
      && typeof draft.startAt === "string" && Number.isFinite(Date.parse(draft.startAt))) return draft;
  } catch {
    // Ignorar datos caducados, dañados o inaccesibles.
  }
  return null;
}
