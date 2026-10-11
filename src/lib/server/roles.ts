export type UserRole = 
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'EARLY_ACCESS'
  | 'USER'
  // Legacy roles — retained for backward compatibility with existing Firebase custom claims.
  // These roles are no longer assignable from the UI but are still recognized on the server.
  | 'SUPPORT'
  | 'FINANCE';

/**
 * Roles that can be assigned via the admin interface.
 * FINANCE and SUPPORT are intentionally excluded — they are legacy roles.
 * Existing holders are grandfathered; new assignments of these roles are blocked.
 */
export const VALID_ROLES: readonly UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'EARLY_ACCESS',
  'USER',
] as const;

/**
 * Legacy roles retained for backward compat. These are recognized by the server
 * but cannot be newly assigned through the admin UI.
 */
export const LEGACY_ROLES: readonly string[] = ['FINANCE', 'SUPPORT'] as const;

/**
 * All recognized roles including legacy ones — used for token validation only.
 */
export const ALL_RECOGNIZED_ROLES: readonly string[] = [
  ...VALID_ROLES,
  ...LEGACY_ROLES,
] as const;

export const ADMIN_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'] as const;

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  role: UserRole;
  isAdmin: boolean;
  claims: Record<string, unknown>;
}

/**
 * Validates whether an arbitrary string is a legitimate system role (including legacy)
 */
export function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && (ALL_RECOGNIZED_ROLES as readonly string[]).includes(role);
}

/**
 * Validates whether a role is actively assignable (not legacy)
 */
export function isAssignableRole(role: unknown): role is UserRole {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}

/**
 * Checks whether a role has general administrative access
 */
export function hasAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/**
 * Only SUPER_ADMIN can assign or modify user roles
 */
export function canAssignRoles(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * Checks permissions for specific administrative domains
 */
export function canAccessAdminDashboard(role: string | null | undefined): boolean {
  return hasAdminRole(role);
}

export function canManageApiKeys(role: string | null | undefined): boolean {
  return hasAdminRole(role);
}

export function canManagePayments(role: string | null | undefined): boolean {
  // FINANCE is a legacy role — existing holders retain payment access
  return hasAdminRole(role) || role === 'FINANCE';
}

export function canManageSettings(role: string | null | undefined): boolean {
  return hasAdminRole(role);
}

/**
 * Checks if a user has Early Access eligibility via role.
 * Note: Early Access is primarily managed via Supabase early_access_members table.
 * SUPER_ADMIN is implicitly eligible.
 */
export function hasEarlyAccess(role: string | null | undefined): boolean {
  return role === 'EARLY_ACCESS' || role === 'SUPER_ADMIN' || role === 'ADMIN';
}
