/**
 * In-memory registry of files analysed in this tab session.
 *
 * Privacy: original media is never uploaded (only a downscaled preview is),
 * so the video player on the results page and the "re-analyze" action read
 * the file from here. Entries live only in JS memory and vanish on reload —
 * nothing persists on disk.
 */

const byKey = new Map<string, File>();

export function rememberFile(key: string, file: File): void {
  byKey.set(key, file);
  // bound the cache so long sessions don't hoard memory
  if (byKey.size > 6) {
    const first = byKey.keys().next().value;
    if (first) byKey.delete(first);
  }
}

export function recallFile(key: string): File | undefined {
  return byKey.get(key);
}

export function forgetFile(key: string): void {
  byKey.delete(key);
}
