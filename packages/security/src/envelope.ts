import { base64Decode, randomBytes } from './bytes.js';

/**
 * 개인정보 envelope 암호화. AES-256-GCM 원문 + RSA-OAEP로 wrap한 DEK를 D1에 저장한다.
 * Public Worker는 공개키만 가지며 개인키는 Admin Worker에만 준다.
 * Public 메모리에서 평문을 다루므로 end-to-end 암호화라고 부르지 않는다.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ContactPlaintext {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
}

export interface EnvelopeAad {
  readonly campaignId: string;
  readonly submissionId: string;
  readonly keyVersion: string;
  readonly aadVersion: number;
}

export interface ContactEnvelope {
  readonly ciphertext: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: string;
  readonly aadVersion: number;
}

export const AAD_VERSION = 1;

/** BUILD_SPEC 3절이 지정한 키 순서. 알파벳 정렬이 아니라 문서에 적힌 순서를 그대로 쓴다. */
export function serializeContact(contact: ContactPlaintext): string {
  return JSON.stringify({ name: contact.name, phone: contact.phone, email: contact.email });
}

export function serializeAad(aad: EnvelopeAad): string {
  return JSON.stringify({
    campaignId: aad.campaignId,
    submissionId: aad.submissionId,
    keyVersion: aad.keyVersion,
    aadVersion: aad.aadVersion,
  });
}

export async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    base64Decode(spkiBase64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

export async function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    base64Decode(pkcs8Base64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
}

export async function encryptContact(
  publicKey: CryptoKey,
  keyVersion: string,
  aad: EnvelopeAad,
  contact: ContactPlaintext,
): Promise<ContactEnvelope> {
  const rawDek = randomBytes(32);
  const dek = await crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12);
  // Web Crypto 출력에는 authentication tag가 이미 포함되어 있다.
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(serializeAad(aad)) },
    dek,
    encoder.encode(serializeContact(contact)),
  );
  const wrappedDek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawDek);
  rawDek.fill(0);
  return {
    ciphertext: new Uint8Array(ciphertext),
    wrappedDek: new Uint8Array(wrappedDek),
    iv,
    keyVersion,
    aadVersion: aad.aadVersion,
  };
}

export async function decryptContact(
  privateKey: CryptoKey,
  envelope: ContactEnvelope,
  aad: EnvelopeAad,
): Promise<ContactPlaintext> {
  const rawDek = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, new Uint8Array(envelope.wrappedDek));
  const dek = await crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(envelope.iv), additionalData: encoder.encode(serializeAad(aad)) },
    dek,
    new Uint8Array(envelope.ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plaintext)) as ContactPlaintext;
  return { name: parsed.name, phone: parsed.phone, email: parsed.email };
}
