import { randomBytes } from "node:crypto";
import type { Db } from "./db";

export const BIRTH_CHALLENGE_COOKIE = "otomo_birth";
export async function createBirthChallenge(db: Db, now = Date.now()) {
  const id = randomBytes(32).toString("hex");
  const signal = randomBytes(32).toString("hex");
  await db.execute({ sql: "DELETE FROM birth_challenges WHERE expires_at < ?", args: [now] });
  await db.execute({ sql: "INSERT INTO birth_challenges VALUES (?,?,?)", args: [id, signal, now + 10 * 60_000] });
  return { id, signal };
}
export async function consumeBirthChallenge(db: Db, id: string | undefined, now = Date.now()) {
  if (!id) return null;
  const row = (await db.execute({ sql: "DELETE FROM birth_challenges WHERE id = ? RETURNING signal, expires_at", args: [id] })).rows[0];
  return row && Number(row.expires_at) > now ? String(row.signal) : null;
}
