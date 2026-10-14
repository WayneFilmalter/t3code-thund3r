/** 32-bit FNV-1a. Stable across sessions, so callers can key caches and seed layouts by it. */
export const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
export const FNV_PRIME_32 = 0x01000193;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}
