export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`Missing required environment variables: ${names.join(", ")}`);
  }
}

export function requireEnv<const K extends string>(...names: K[]): Record<K, string> {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) throw new MissingEnvError(missing);
  return Object.fromEntries(names.map((n) => [n, process.env[n]!.trim()])) as Record<K, string>;
}

export function optionalNumberEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}
