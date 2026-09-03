import type { PasswordVerifier } from "../core/studio-ports";
import { base64UrlToBytes, utf8 } from "./encoding";

const HASH_NAME = "pbkdf2-sha256";
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 2_000_000;

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export class Pbkdf2PasswordVerifier implements PasswordVerifier {
  async verify(password: string, encodedHash: string): Promise<boolean> {
    try {
      const [name, iterationText, saltText, expectedText, extra] = encodedHash.split("$");
      const iterations = Number(iterationText);
      if (
        name !== HASH_NAME ||
        extra !== undefined ||
        !Number.isInteger(iterations) ||
        iterations < MIN_ITERATIONS ||
        iterations > MAX_ITERATIONS
      ) {
        return false;
      }
      const salt = base64UrlToBytes(saltText ?? "");
      const expected = base64UrlToBytes(expectedText ?? "");
      if (salt.byteLength < 16 || expected.byteLength !== 32) return false;

      const material = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
      const derived = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        material,
        expected.byteLength * 8,
      );
      return equalBytes(new Uint8Array(derived), expected);
    } catch {
      return false;
    }
  }
}

