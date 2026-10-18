// Display helpers for the permission catalogue (no business logic; the server enforces everything).
import { PERMISSION_KEYS, type PermissionKey } from '@relay/contracts/permissions';

/** i18n message keys cannot contain dots: `crm.contact.view` → `crm_contact_view`. */
export const permI18nKey = (k: PermissionKey) => k.replaceAll('.', '_');

export interface PermissionGroup {
  id: string;
  keys: PermissionKey[];
}

/** Grouped by the first key segment, in catalogue order. */
export const PERMISSION_GROUPS: PermissionGroup[] = Object.values(
  PERMISSION_KEYS.reduce<Record<string, PermissionGroup>>((acc, k) => {
    const id = k.split('.')[0]!;
    (acc[id] ??= { id, keys: [] }).keys.push(k);
    return acc;
  }, {}),
);
