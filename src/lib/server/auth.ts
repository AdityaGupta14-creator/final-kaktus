import { verifyUserToken } from './firebase-admin';
import { type AuthenticatedUser, type UserRole, hasAdminRole } from './roles';

export class AuthError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 401, code = 'UNAUTHENTICATED') {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Extracts the Bearer token from the incoming Request Authorization header
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

/**
 * Ensures the caller is authenticated with a valid Firebase ID token
 */
export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new AuthError('Authentication required. Missing Bearer token.', 401, 'MISSING_TOKEN');
  }

  const user = await verifyUserToken(token);
  if (!user) {
    throw new AuthError('Invalid or expired authentication token.', 401, 'INVALID_TOKEN');
  }

  return user;
}

/**
 * Requires the authenticated user to possess one of the allowed roles
 */
export async function requireRole(request: Request, allowedRoles: readonly UserRole[]): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(request);
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError(
      `Forbidden. Role '${user.role}' lacks permission for this action. Required: ${allowedRoles.join(', ')}`,
      403,
      'INSUFFICIENT_ROLE'
    );
  }
  return user;
}

/**
 * Requires the user to have either ADMIN or SUPER_ADMIN role
 */
export async function requireAdmin(request: Request): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(request);
  if (!hasAdminRole(user.role)) {
    throw new AuthError('Forbidden. Administrative privileges required.', 403, 'ADMIN_REQUIRED');
  }
  return user;
}

/**
 * Standard error response handler for server-side auth failures
 */
export function handleAuthError(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error('[Auth] Unexpected error during authorization:', error);
  return Response.json(
    { error: 'Internal authorization error.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}
