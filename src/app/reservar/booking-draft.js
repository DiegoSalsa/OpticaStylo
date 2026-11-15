const STORAGE_KEY = "opticastylo:booking-recovery";
const LIFETIME_MS = 30 * 60_000;

export function saveBookingDraft({ professionalId, date, startAt }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ professionalId, date, startAt, expiresAt: Date.now() + LIFETIME_MS }));
  } catch {
    // El navegador puede bloquear el almacenamiento. La reserva sigue disponible.
  }
}

export function clearBookingDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // El almacenamiento puede no estar disponible en esta pestaña.
  }
}

export function readBookingDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const now = Date.now();
    if (Number.isFinite(draft?.expiresAt) && draft.expiresAt > now && draft.expiresAt <= now + LIFETIME_MS
      && typeof draft.professionalId === "string"
      && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(draft.professionalId)
      && /^\d{4}-\d{2}-\d{2}$/.test(draft.date)
      && typeof draft.startAt === "string" && Number.isFinite(Date.parse(draft.startAt))) return draft;
  } catch {
    // Ignorar datos caducados, dañados o inaccesibles.
  }
  clearBookingDraft();
  return null;
}
