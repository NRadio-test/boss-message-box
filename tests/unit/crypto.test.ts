// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WebCryptoPhoneService } from "../../worker/security/crypto";

const KEY_A = "ERERERERERERERERERERERERERERERERERERERERERE=";
const KEY_B = "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=";

describe("phone cryptography", () => {
  it("uses stable keyed lookup and randomized reversible AES-GCM", async () => {
    const service = new WebCryptoPhoneService(KEY_A, KEY_B);
    const phoneHash = await service.hash("13800138000");
    expect(await service.hash("13800138000")).toBe(phoneHash);

    const first = await service.encrypt("13800138000", phoneHash);
    const second = await service.encrypt("13800138000", phoneHash);
    expect(first).not.toBe(second);
    expect(first).not.toContain("13800138000");
    expect(await service.decrypt(first, phoneHash)).toBe("+8613800138000");
  });

  it("fails authentication after ciphertext or AAD tampering", async () => {
    const service = new WebCryptoPhoneService(KEY_A, KEY_B);
    const phoneHash = await service.hash("13800138000");
    const encrypted = await service.encrypt("13800138000", phoneHash);
    const last = encrypted.at(-1)!;
    const tampered = `${encrypted.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    await expect(service.decrypt(tampered, phoneHash)).rejects.toThrow();
    await expect(service.decrypt(encrypted, `${phoneHash}x`)).rejects.toThrow();
  });
});
