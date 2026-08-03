// State + persistence for per-row, per-column restore overrides.
// Shape mirrors what `restore-advanced-backup` accepts on the plan.

export type RowAction = 'skip' | 'apply';
export type ColumnChoice = 'live' | 'backup' | 'null';

export interface RowOverride {
  action?: RowAction;
  columns?: Record<string, ColumnChoice>;
}

export type RowOverrides = Record<string, Record<string, RowOverride>>;

const LS_PREFIX = 'lov.restore.overrides.';

export function loadOverrides(key: string): RowOverrides {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOverrides(key: string, overrides: RowOverrides) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(overrides));
  } catch {
    /* ignore quota errors */
  }
}

export function clearOverrides(key: string) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

export function setRowAction(
  o: RowOverrides, table: string, id: string, action: RowAction | null,
): RowOverrides {
  const next = { ...o, [table]: { ...(o[table] || {}) } };
  const row = { ...(next[table][id] || {}) };
  if (action === null) delete row.action;
  else row.action = action;
  if (!row.action && (!row.columns || Object.keys(row.columns).length === 0)) {
    delete next[table][id];
  } else {
    next[table][id] = row;
  }
  return next;
}

export function setColumnChoice(
  o: RowOverrides, table: string, id: string, col: string, choice: ColumnChoice | null,
): RowOverrides {
  const next = { ...o, [table]: { ...(o[table] || {}) } };
  const row = { ...(next[table][id] || {}) };
  const cols = { ...(row.columns || {}) };
  if (choice === null) delete cols[col];
  else cols[col] = choice;
  if (Object.keys(cols).length === 0) delete row.columns;
  else row.columns = cols;
  if (!row.action && !row.columns) delete next[table][id];
  else next[table][id] = row;
  return next;
}

export function setColumnChoiceForTable(
  o: RowOverrides, table: string, rowIds: string[], col: string, choice: ColumnChoice,
): RowOverrides {
  let next = o;
  for (const id of rowIds) next = setColumnChoice(next, table, id, col, choice);
  return next;
}

export function summarize(o: RowOverrides) {
  let skipRows = 0;
  let overriddenRows = 0;
  let overriddenCols = 0;
  for (const t of Object.values(o)) {
    for (const r of Object.values(t)) {
      if (r.action === 'skip') skipRows++;
      const cc = r.columns ? Object.keys(r.columns).length : 0;
      if (cc > 0) { overriddenRows++; overriddenCols += cc; }
    }
  }
  return { skipRows, overriddenRows, overriddenCols };
}
