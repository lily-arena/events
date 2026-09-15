import { describe, expect, it } from 'vitest';
import {
  AAD_VERSION,
  canonicalJson,
  csrfTokenFor,
  decryptContact,
  encryptContact,
  maskEmail,
  maskName,
  maskPhone,
  newSessionToken,
  serializeContact,
  verifyCsrf,
} from '@first-seat/security';

async function devKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  return crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  ) as Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
}

describe('마스킹', () => {
  it('이름·전화·이메일 원문을 그대로 노출하지 않는다', () => {
    expect(maskName('홍길동')).toBe('홍*동');
    expect(maskName('김철')).toBe('김*');
    expect(maskPhone('+821012345678')).toBe('+82******5678');
    expect(maskEmail('test@example.com')).toBe('t***@e******.com');
  });
});

describe('canonical JSON', () => {
  it('키 순서가 달라도 같은 문자열을 만든다', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('연락처 원문은 name, phone, email 순서를 유지한다', () => {
    expect(serializeContact({ name: 'n', phone: 'p', email: 'e' })).toBe(
      '{"name":"n","phone":"p","email":"e"}',
    );
  });
});

describe('CSRF', () => {
  it('session에 묶인 token만 통과한다', async () => {
    const secret = 'test-secret';
    const session = newSessionToken();
    const token = await csrfTokenFor(secret, session);
    expect(await verifyCsrf(secret, session, token)).toBe(true);
    expect(await verifyCsrf(secret, session, 'wrong')).toBe(false);
    expect(await verifyCsrf(secret, newSessionToken(), token)).toBe(false);
    expect(await verifyCsrf(secret, session, null)).toBe(false);
  });
});

describe('envelope 암호화', () => {
  const aad = {
    campaignId: 'c1',
    submissionId: 's1',
    keyVersion: 'v1',
    aadVersion: AAD_VERSION,
  };
  const contact = { name: '홍길동', phone: '+821012345678', email: 'test@example.com' };

  it('암호화 후 같은 AAD로 복호화된다', async () => {
    const { publicKey, privateKey } = await devKeyPair();
    const envelope = await encryptContact(publicKey, 'v1', aad, contact);
    expect(envelope.iv.byteLength).toBe(12);
    expect(new TextDecoder().decode(envelope.ciphertext)).not.toContain('홍길동');
    expect(await decryptContact(privateKey, envelope, aad)).toEqual(contact);
  });

  it('AAD가 다르면 복호화되지 않는다', async () => {
    const { publicKey, privateKey } = await devKeyPair();
    const envelope = await encryptContact(publicKey, 'v1', aad, contact);
    await expect(decryptContact(privateKey, envelope, { ...aad, submissionId: 's2' })).rejects.toThrow();
  });

  it('매번 다른 IV와 DEK를 쓴다', async () => {
    const { publicKey } = await devKeyPair();
    const a = await encryptContact(publicKey, 'v1', aad, contact);
    const b = await encryptContact(publicKey, 'v1', aad, contact);
    expect(Buffer.from(a.iv).toString('hex')).not.toBe(Buffer.from(b.iv).toString('hex'));
    expect(Buffer.from(a.ciphertext).toString('hex')).not.toBe(Buffer.from(b.ciphertext).toString('hex'));
  });
});
