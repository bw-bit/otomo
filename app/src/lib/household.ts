import type { CompanionRole, Db } from "./db";

export interface Sibling {
  label: string;
  full_name: string;
  role: CompanionRole;
}

/** Companions born from the same verified human (same World nullifier), including `label` itself. */
export async function siblingsOf(db: Db, label: string): Promise<Sibling[]> {
  const rows = (await db.execute({
    sql: `SELECT c.label, c.full_name, c.role FROM companions c JOIN companions me ON me.label = ?
      WHERE me.human IS NOT NULL AND c.human = me.human ORDER BY c.created_at, c.label`,
    args: [label],
  })).rows;
  return rows.map((r) => ({ label: String(r.label), full_name: String(r.full_name), role: r.role === "work" ? "work" : "personal" }));
}

export async function canSwitch(db: Db, fromLabel: string, toLabel: string): Promise<boolean> {
  return (await siblingsOf(db, fromLabel)).some((s) => s.label === toLabel);
}

export async function roleOf(db: Db, nameOrLabel: string): Promise<CompanionRole | null> {
  const key = nameOrLabel.trim().toLowerCase();
  const r = (await db.execute({ sql: "SELECT role FROM companions WHERE full_name = ? OR label = ?", args: [key, key] })).rows[0];
  return r ? (r.role === "work" ? "work" : "personal") : null;
}
