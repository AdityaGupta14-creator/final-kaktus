# Security operations

This change hardens the application code. It does not configure Firebase, Supabase, Vercel, Cashfree, or Redis accounts.

## Required deployment settings

- `API_KEY_ENCRYPTION_KEY`: a 32-byte base64url secret. A local value has been created in the ignored `.env.local`; use that same value in every deployment that must read the same Gemini key pool. Do not commit or log it. Set this before deploying the new key-manager code. When configured, the first key-pool read transactionally migrates legacy plaintext records to AES-256-GCM ciphertext. Pool mutations fail closed when the setting is absent.
- `SUPER_ADMIN_EMAIL` and `ADMIN_EMAILS`: explicit bootstrap identities, if needed. Otherwise assign roles through Firebase custom claims. Fixed email addresses in the source no longer grant admin UI access.
- `ADMIN_REQUIRE_MFA=true`: after enrolling all administrator accounts in Firebase Identity Platform MFA, this makes server admin routes reject tokens without a verified second factor. The default remains off so existing admins are not locked out before enrollment.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: enables shared request limits across serverless instances. Without these, the app uses a per-process fallback, which is useful locally but is not a distributed production limit.
- `SMS_WEBHOOK_SECRET`: required for the SMS/UTR webhook. No built-in fallback secret is accepted.
- `CASHFREE_WEBHOOK_SECRET`: recommended webhook signing secret. The existing Cashfree API secret is accepted as a compatibility fallback.
- `KAKTUS_WEB_ORIGINS`: exact comma-separated origins for additional trusted terminal/USB clients. Do not use wildcard preview origins.

## Firebase and Supabase

- Publish the updated `firestore.rules` to the Firebase project before relying on client-side data restrictions. The rules prevent client role/plan changes and constrain user-submitted payment records.
- Apply `supabase/migrations/00006_security_rpc_hardening.sql` to the production database. It restricts quota RPCs to the server service role and pins their search path.
- Keep Firebase Admin and Supabase service-role credentials only in server-side secret settings. Never use a `NEXT_PUBLIC_` prefix for them.

## Controls and limits

- Admin routes verify Firebase ID tokens and check revocation; role changes revoke refresh tokens. The app uses bearer tokens rather than an app-managed cookie session, so cookie flags and cookie-session CSRF protections are not the active auth mechanism.
- The terminal binds to loopback, allows exact trusted origins, and verifies the Firebase ID token before creating a shell. The local USB service rejects untrusted origins and non-loopback Host headers; hardware requests also carry a Firebase ID token verified by the local Node service.
- Security audit entries are stored in Firestore, but this is not immutable/WORM retention. Configure a restricted export/retention sink for tamper-resistant audit retention.
- The application can enforce MFA through `ADMIN_REQUIRE_MFA`, but MFA enrollment/recovery is managed in Firebase Identity Platform and must be completed before enabling the flag.
- The current CSP blocks framing, plugin content, and base-URL injection; a strict script/style nonce policy still needs a separate compatibility rollout.
- Deploy only after the encryption key is set in the target environment and the Firebase/Supabase policy changes are applied. No production deployment was performed by this change.
