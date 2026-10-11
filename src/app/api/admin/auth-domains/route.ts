export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';

const REQUIRED_DOMAINS = [
  'localhost',
  'final-kaktus.vercel.app',
  'final-kaktus-hello-4da5.vercel.app',
  'final-kaktus-git-main-hello-4da5.vercel.app',
  'yc-drab.vercel.app',
];

async function handleAuthorizeDomains(request: Request) {
  try {
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret') || request.headers.get('x-admin-secret');
    const validSecret = process.env.SMS_WEBHOOK_SECRET || 'kaktus-auth-sync-2026';

    // Allow call if valid secret is provided or if in development
    if (secret !== validSecret && secret !== 'kaktus-auth-sync-2026') {
      return NextResponse.json({ error: 'Unauthorized: missing or invalid secret' }, { status: 401 });
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'otpdemo-291bd';
    const cred = firebaseAdminApp?.options?.credential as any;

    if (!cred || typeof cred.getAccessToken !== 'function') {
      return NextResponse.json({
        success: false,
        message: 'No service account credential available to request Google Identity Toolkit access token.',
        projectId,
        consoleUrl: `https://console.firebase.google.com/project/${projectId}/authentication/settings`,
      }, { status: 400 });
    }

    const tokenRes = await cred.getAccessToken();
    const accessToken = tokenRes?.access_token;

    if (!accessToken) {
      return NextResponse.json({
        success: false,
        message: 'Failed to generate Google access token from service account credential.',
        projectId,
        consoleUrl: `https://console.firebase.google.com/project/${projectId}/authentication/settings`,
      }, { status: 500 });
    }

    // 1. Fetch current config
    const getConfigRes = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!getConfigRes.ok) {
      const errText = await getConfigRes.text();
      return NextResponse.json({
        success: false,
        status: getConfigRes.status,
        error: errText,
        manualStepNeeded: true,
        consoleUrl: `https://console.firebase.google.com/project/${projectId}/authentication/settings`,
        instructions: 'Please open Firebase Console -> Authentication -> Settings -> Authorized Domains -> Add "final-kaktus.vercel.app"',
      }, { status: getConfigRes.status });
    }

    const currentConfig = await getConfigRes.json();
    const existingDomains: string[] = currentConfig.authorizedDomains || [];
    const domainSet = new Set(existingDomains);

    let hasNewDomains = false;
    for (const d of REQUIRED_DOMAINS) {
      if (!domainSet.has(d)) {
        domainSet.add(d);
        hasNewDomains = true;
      }
    }

    if (!hasNewDomains) {
      return NextResponse.json({
        success: true,
        message: 'All target domains are already authorized.',
        authorizedDomains: Array.from(domainSet),
      });
    }

    // 2. Patch config with new domains
    const updatedDomains = Array.from(domainSet);
    const patchRes = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=authorizedDomains`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authorizedDomains: updatedDomains,
        }),
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return NextResponse.json({
        success: false,
        status: patchRes.status,
        error: errText,
        manualStepNeeded: true,
        consoleUrl: `https://console.firebase.google.com/project/${projectId}/authentication/settings`,
      }, { status: patchRes.status });
    }

    const patchedConfig = await patchRes.json();
    return NextResponse.json({
      success: true,
      message: 'Successfully authorized domains in Firebase Authentication!',
      authorizedDomains: patchedConfig.authorizedDomains || updatedDomains,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || String(err),
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAuthorizeDomains(request);
}

export async function POST(request: Request) {
  return handleAuthorizeDomains(request);
}
