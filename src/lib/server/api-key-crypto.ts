import crypto from 'crypto';

const ENCRYPTED_PREFIX = 'v1.';

function getEncryptionKey(): Buffer {
  const configured = process.env.API_KEY_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error('API_KEY_ENCRYPTION_KEY is required to write managed API keys.');
  }

  const key = Buffer.from(configured, 'base64url');
  if (key.length !== 32) {
    throw new Error('API_KEY_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.');
  }
  return key;
}

export function hasApiKeyEncryptionKey(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptApiKey(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('Unsupported encrypted API key format.');
  }
  const [ivText, tagText, ciphertextText] = value.slice(ENCRYPTED_PREFIX.length).split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted API key record.');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
