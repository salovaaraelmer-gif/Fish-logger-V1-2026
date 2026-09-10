/**
 * Keep one profile row per stable id (username + name hits must not duplicate).
 * @param {Array<{ id?: string | null } | null | undefined>} rows
 * @returns {Array<{ id: string }>}
 */
export function uniqueProfilesById(rows) {
  const merged = new Map();
  for (const row of rows || []) {
    if (!row || row.id == null) continue;
    const id = String(row.id);
    if (!id || merged.has(id)) continue;
    merged.set(id, { ...row, id });
  }
  return [...merged.values()];
}
