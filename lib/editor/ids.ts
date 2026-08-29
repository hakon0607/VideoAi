/**
 * Id generation.
 *
 * Ids are real UUIDs so they can be written straight into Postgres `uuid`
 * columns. Tests inject a deterministic generator through the action context.
 */
export function newId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for very old runtimes; still RFC-4122 shaped.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Creates a deterministic generator, used by tests and by golden-file fixtures. */
export function createSequentialIdFactory(prefix = '0000'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    const n = counter.toString(16).padStart(12, '0');
    return `${prefix}0000-0000-4000-8000-${n}`;
  };
}
