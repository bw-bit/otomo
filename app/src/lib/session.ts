import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env";

export const SESSION_COOKIE = "otomo_session";

const sign = (label: string) =>
  createHmac("sha256", requireEnv("APP_SECRET").APP_SECRET).update(label).digest("base64url");

export const sessionValue = (label: string) => {
  const payload = `${label}:${Date.now() + 86400_000}`;
  return `${payload}.${sign(payload)}`;
};

/** Returns the companion label the browser owns, or null. */
export function readSession(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = value.slice(0, i);
  const [label, expiry] = payload.split(":");
  if (!label || !Number.isFinite(Number(expiry)) || Number(expiry) <= Date.now()) return null;
  const a = Buffer.from(value.slice(i + 1));
  const b = Buffer.from(sign(payload));
  return a.length === b.length && timingSafeEqual(a, b) ? label : null;
}
