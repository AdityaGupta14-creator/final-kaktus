/**
 * Script to securely assign the TEST role and configure test token allowance.
 * 
 * Usage:
 *   node scripts/assign-test-role.mjs --email user@example.com --mode UNLIMITED
 *   node scripts/assign-test-role.mjs --uid <UID> --mode HIGH
 *   node scripts/assign-test-role.mjs --email user@example.com --mode STANDARD
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config();

function initFirebaseAdmin() {
  if (getApps().length > 0) return { auth: getAuth(), db: getFirestore() };

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'kaktus-platform';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();

  let app;
  if (rawServiceAccount) {
    try {
      let parsed;
      if (rawServiceAccount.startsWith('{') || rawServiceAccount.startsWith('[') || rawServiceAccount.startsWith('"') || rawServiceAccount.startsWith("'")) {
        let cleanJson = rawServiceAccount;
        if ((cleanJson.startsWith("'") && cleanJson.endsWith("'")) || (cleanJson.startsWith('"') && cleanJson.endsWith('"'))) {
          cleanJson = cleanJson.slice(1, -1);
        }
        parsed = JSON.parse(cleanJson);
      } else {
        parsed = JSON.parse(rawServiceAccount);
      }
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      app = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
      });
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY directly, trying default:', e.message);
      app = initializeApp({ projectId });
    }
  } else if (clientEmail && privateKey) {
    let cleanKey = privateKey.trim();
    if ((cleanKey.startsWith("'") && cleanKey.endsWith("'")) || (cleanKey.startsWith('"') && cleanKey.endsWith('"'))) {
      cleanKey = cleanKey.slice(1, -1);
    }
    cleanKey = cleanKey.replace(/\\n/g, '\n');
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail: clientEmail.trim(),
        privateKey: cleanKey,
      }),
      projectId,
    });
  } else {
    app = initializeApp({ projectId });
  }

  return { auth: getAuth(app), db: getFirestore(app) };
}

async function main() {
  const args = process.argv.slice(2);
  let targetEmail = null;
  let targetUid = null;
  let mode = 'UNLIMITED';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      targetEmail = args[i + 1].toLowerCase().trim();
      i++;
    } else if (args[i] === '--uid' && args[i + 1]) {
      targetUid = args[i + 1].trim();
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1].toUpperCase().trim();
      i++;
    }
  }

  if (!targetEmail && !targetUid) {
    console.error('Error: Please provide --email <email> or --uid <uid>');
    process.exit(1);
  }

  const { auth, db } = initFirebaseAdmin();

  let userRecord;
  if (targetEmail) {
    try {
      userRecord = await auth.getUserByEmail(targetEmail);
    } catch (e) {
      console.log(`User not found with email ${targetEmail}. Creating account...`);
      try {
        userRecord = await auth.createUser({
          email: targetEmail,
          emailVerified: true,
          displayName: targetEmail.split('@')[0],
        });
        console.log(`Created new Firebase user for ${targetEmail}: UID ${userRecord.uid}`);
      } catch (createErr) {
        console.error(`Failed to create user: ${createErr.message}`);
        process.exit(1);
      }
    }
  } else {
    try {
      userRecord = await auth.getUser(targetUid);
    } catch (e) {
      console.error(`User not found with UID: ${targetUid}`);
      process.exit(1);
    }
  }

  console.log(`Account: ${userRecord.email || userRecord.uid} (${userRecord.uid})`);
  console.log(`Granting TEST role with ${mode} token allowance...`);

  // 1. Authoritative Firebase custom claims
  const currentClaims = userRecord.customClaims || {};
  await auth.setCustomUserClaims(userRecord.uid, {
    ...currentClaims,
    role: 'TEST',
    testQuotaMode: mode,
  });

  // 2. Firestore user doc
  const userDocRef = db.collection('users').doc(userRecord.uid);
  await userDocRef.set({
    email: userRecord.email,
    displayName: userRecord.displayName || targetEmail?.split('@')[0] || 'User',
    role: 'TEST',
    testQuotaMode: mode,
    plan: 'pro',
    proRuns: 999999,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  // 3. Supabase subscription
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase.from('profiles').upsert({
        uid: userRecord.uid,
        email: userRecord.email,
        display_name: userRecord.displayName || targetEmail?.split('@')[0] || 'User',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'uid' });

      await supabase.from('subscriptions').upsert({
        user_uid: userRecord.uid,
        plan_id: 'pro',
        status: 'active',
        quota_remaining: 999999,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_uid' });
      console.log('✅ Supabase profile & pro subscription synchronized.');
    }
  } catch (sbErr) {
    console.warn('Supabase sync note:', sbErr.message);
  }

  console.log('\n🎉 Successfully granted free/unlimited token access!');
  console.log(`   Account: ${userRecord.email}`);
  console.log(`   UID: ${userRecord.uid}`);
  console.log(`   Role: TEST`);
  console.log(`   Quota Allowance Mode: ${mode}`);
  console.log(`   Plan: PRO (Active with unlimited test allowance)`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
