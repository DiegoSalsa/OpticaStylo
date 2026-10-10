// Support the canonical database format and compact input used by quick searches.
export function rutSearchValues(search) {
  const compact = search.replace(/[.\s-]/g, "").toUpperCase();
  return [...new Set([search, compact,
    ...(/^\d{1,8}[0-9K]$/.test(compact) ? [`${compact.slice(0,-1)}-${compact.slice(-1)}`] : []),
  ])].filter(Boolean);
}
