/**
 * Authoritative Server Clock Synchronizer
 * Anchors client countdown calculation to Express /api/time + monotonic performance.now()
 * so changing the local computer/phone clock never adds extra exam time.
 */

let syncedServerEpochMs: number | null = null;
let syncedPerfNowMs: number | null = null;
let syncPromise: Promise<void> | null = null;

export async function syncServerClock(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      const t0 = performance.now();
      const resp = await fetch('/api/time', { cache: 'no-store' });
      const t1 = performance.now();
      if (resp.ok) {
        const data = (await resp.json()) as { serverTimeMs?: number };
        if (typeof data.serverTimeMs === 'number') {
          const rttHalf = (t1 - t0) / 2;
          syncedServerEpochMs = data.serverTimeMs + rttHalf;
          syncedPerfNowMs = t1;
        }
      }
    } catch {
      // Keep last monotonic offset if offline; never reset timer upward
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

/**
 * Returns authoritative current UTC timestamp in milliseconds using monotonic performance.now()
 * anchored to the last verified server clock sync.
 */
export function getAuthoritativeNowMs(): number {
  if (syncedServerEpochMs !== null && syncedPerfNowMs !== null) {
    const elapsedSinceSync = performance.now() - syncedPerfNowMs;
    return Math.round(syncedServerEpochMs + elapsedSinceSync);
  }
  return Date.now();
}

export function isClockSyncedWithServer(): boolean {
  return syncedServerEpochMs !== null;
}

export function formatRemainingSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
