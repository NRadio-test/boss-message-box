import type { PhoneCryptoService } from "../core/ports";
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64Url,
  utf8,
  utf8Decode,
} from "./encoding";

async function importHmacKey(base64Key: string, label: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(base64Key, label),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export class WebCryptoPhoneService implements PhoneCryptoService {
  private readonly hashKey: Promise<CryptoKey>;
  private readonly encryptionKey: Promise<CryptoKey>;

  constructor(phoneHashKey: string, phoneEncryptionKey: string) {
    this.hashKey = importHmacKey(phoneHashKey, "PHONE_HASH_KEY");
    this.encryptionKey = crypto.subtle.importKey(
      "raw",
      base64ToBytes(phoneEncryptionKey, "PHONE_ENCRYPTION_KEY"),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }

  async hash(phone: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", await this.hashKey, utf8(`+86${phone}`));
    return bytesToBase64Url(signature);
  }

  async encrypt(phone: string, phoneHash: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: utf8(`phone:v1:${phoneHash}`), tagLength: 128 },
      await this.encryptionKey,
      utf8(`+86${phone}`),
    );
    return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
  }

  async decrypt(value: string, phoneHash: string): Promise<string> {
    const [version, iv, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext || extra) throw new Error("Unsupported phone ciphertext");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(iv),
        additionalData: utf8(`phone:v1:${phoneHash}`),
        tagLength: 128,
      },
      await this.encryptionKey,
      base64UrlToBytes(ciphertext),
    );
    return utf8Decode(plaintext);
  }
}

export class HmacService {
  private readonly key: Promise<CryptoKey>;

  constructor(base64Key: string, label: string) {
    this.key = importHmacKey(base64Key, label);
  }

  async sign(value: string): Promise<string> {
    return bytesToBase64Url(await crypto.subtle.sign("HMAC", await this.key, utf8(value)));
  }

  async verify(value: string, signature: string): Promise<boolean> {
    try {
      return await crypto.subtle.verify(
        "HMAC",
        await this.key,
        base64UrlToBytes(signature),
        utf8(value),
      );
    } catch {
      return false;
    }
  }
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  return bytesToBase64Url(await crypto.subtle.digest("SHA-256", data));
}
