/**
 * Pure helpers for the cod-stale-collection job. They live here (not in
 * src/jobs) because Medusa's jobs loader requires every file under src/jobs
 * to be a job definition (default export + config).
 */

export const DEFAULT_STALE_COLLECTION_HOURS = 72

/**
 * Parses COD_STALE_COLLECTION_HOURS; anything missing, non-numeric, or
 * non-positive falls back to the 72h default.
 */
export function resolveStaleCollectionHours(
  raw: string | undefined
): number {
  const parsed = Number(raw)
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STALE_COLLECTION_HOURS
  }
  return parsed
}

/** Orders whose last update predates this cutoff count as stale. */
export function getStaleCollectionCutoff(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

/** Whole hours between the order's last update and now, for the warning. */
export function hoursSince(updatedAt: Date | string, now: Date): number {
  const updated =
    updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  return Math.floor((now.getTime() - updated.getTime()) / (60 * 60 * 1000))
}
