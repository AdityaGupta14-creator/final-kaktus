import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { type UserRole, type AuthenticatedUser, hasAdminRole, isValidRole } from './roles';

import fs from 'fs';
import path from 'path';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

function initFirebaseAdmin(): { app: App; auth: Auth; db: Firestore } {
  if (getApps().length > 0) {
    const existing = getApp();
    return {
      app: existing,
      auth: getAuth(existing),
      db: getFirestore(existing),
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'kaktus-platform';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();

  if (rawServiceAccount) {
    try {
      let parsed: any;
      // 1. Check if it's a file path pointing to a json file
      const potentialFilePath = path.isAbsolute(rawServiceAccount)
        ? rawServiceAccount
        : path.resolve(process.cwd(), rawServiceAccount);

      if (fs.existsSync(potentialFilePath) && fs.statSync(potentialFilePath).isFile()) {
        const fileContent = fs.readFileSync(potentialFilePath, 'utf8');
        parsed = JSON.parse(fileContent);
      } else if (rawServiceAccount.startsWith('{') || rawServiceAccount.startsWith('[') || rawServiceAccount.startsWith('"') || rawServiceAccount.startsWith("'")) {
        // Strip surrounding single/double quotes if present
        let cleanJson = rawServiceAccount;
        if ((cleanJson.startsWith("'") && cleanJson.endsWith("'")) || (cleanJson.startsWith('"') && cleanJson.endsWith('"'))) {
          cleanJson = cleanJson.slice(1, -1);
        }
        parsed = JSON.parse(cleanJson);
      } else {
        // Attempt base64 decode if not plain json
        try {
          const decoded = Buffer.from(rawServiceAccount, 'base64').toString('utf8');
          parsed = JSON.parse(decoded);
        } catch {
          parsed = JSON.parse(rawServiceAccount);
        }
      }

      // Ensure RSA private key newlines are properly unescaped
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }

      adminApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
      });
      console.log(`[FirebaseAdmin] Successfully initialized with service account for project: ${parsed.project_id || projectId}`);
    } catch (err) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', (err as Error).message);
      adminApp = initializeApp({ projectId });
    }
  } else if (clientEmail && privateKey) {
    // Strip surrounding quotes if present
    let cleanKey = privateKey.trim();
    if ((cleanKey.startsWith("'") && cleanKey.endsWith("'")) || (cleanKey.startsWith('"') && cleanKey.endsWith('"'))) {
      cleanKey = cleanKey.slice(1, -1);
    }
    cleanKey = cleanKey.replace(/\\n/g, '\n');

    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail: clientEmail.trim(),
        privateKey: cleanKey,
      }),
      projectId,
    });
    console.log(`[FirebaseAdmin] Initialized with individual client email credentials for project: ${projectId}`);
  } else {
    adminApp = initializeApp({ projectId });
  }

  adminAuth = getAuth(adminApp);
  adminDb = getFirestore(adminApp);

  return { app: adminApp, auth: adminAuth, db: adminDb };
}

const initialized = initFirebaseAdmin();
export const auth = initialized.auth;
export const db = initialized.db;

/**
 * Returns configured bootstrap SUPER_ADMIN email from SUPER_ADMIN_EMAIL env
 */
export function getBootstrapSuperAdminEmails(): string[] {
  const envEmails = process.env.SUPER_ADMIN_EMAIL || '';
  return envEmails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns a list of configured bootstrap admin emails from ADMIN_EMAILS environment variable
 */
export function getBootstrapAdminEmails(): string[] {
  const envEmails = process.env.ADMIN_EMAILS || '';
  return envEmails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolves the authoritative role for a decoded Firebase token
 */
export function resolveUserRole(decoded: DecodedIdToken): UserRole {
  const email = (decoded.email || '').toLowerCase().trim();
  const superAdminEmails = getBootstrapSuperAdminEmails();

  // 1. Check bootstrap SUPER_ADMIN_EMAIL first
  if (email && superAdminEmails.includes(email)) {
    // If the token doesn't already contain the claim, sync it in the background
    if (decoded.role !== 'SUPER_ADMIN') {
      auth.setCustomUserClaims(decoded.uid, {
        role: 'SUPER_ADMIN',
        admin: true,
      }).catch(err => {
        console.warn('[FirebaseAdmin] Could not persist SUPER_ADMIN custom claim:', err.message);
      });
    }
    return 'SUPER_ADMIN';
  }

  // 2. Authoritative Firebase custom claims
  if (decoded.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (decoded.role === 'ADMIN' || decoded.admin === true) return 'ADMIN';
  if (decoded.role === 'EARLY_ACCESS') return 'EARLY_ACCESS';
  // Legacy roles — still recognized for existing token holders
  if (decoded.role === 'FINANCE') return 'FINANCE';
  if (decoded.role === 'SUPPORT') return 'SUPPORT';

  // 3. Server-side bootstrap email whitelist from ADMIN_EMAILS (for regular ADMIN)
  if (email) {
    const adminEmails = getBootstrapAdminEmails();
    if (adminEmails.includes(email)) {
      if (decoded.role !== 'ADMIN') {
        auth.setCustomUserClaims(decoded.uid, {
          role: 'ADMIN',
          admin: true,
        }).catch(err => {
          console.warn('[FirebaseAdmin] Could not persist ADMIN custom claim:', err.message);
        });
      }
      return 'ADMIN';
    }
  }

  return 'USER';
}

/**
 * Verifies a client Firebase ID token and resolves user identity and role
 */
export async function verifyUserToken(token: string): Promise<AuthenticatedUser | null> {
  try {
    const decoded = await auth.verifyIdToken(token);
    const role = resolveUserRole(decoded);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      role,
      isAdmin: hasAdminRole(role),
      claims: decoded as unknown as Record<string, unknown>,
    };
  } catch (error) {
    console.error('[FirebaseAdmin] Token verification failed:', error);
    return null;
  }
}

/**
 * Sets custom claims on a user account and optionally mirrors to Firestore for UI display
 */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  if (!isValidRole(role)) {
    throw new Error(`Invalid role '${role}'. Assignable roles: SUPER_ADMIN, ADMIN, EARLY_ACCESS, USER. Legacy roles FINANCE and SUPPORT are recognized for existing holders but cannot be newly assigned.`);
  }

  const userRecord = await auth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};

  // Authoritative Firebase Custom Claim
  await auth.setCustomUserClaims(uid, {
    ...currentClaims,
    role,
    admin: hasAdminRole(role),
  });

  // Mirror to Firestore user doc for read-only UI display (not used for authorization)
  try {
    await db.collection('users').doc(uid).set(
      {
        role,
        roleUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[FirebaseAdmin] Could not mirror role to Firestore user document:', (err as Error).message);
  }
}
