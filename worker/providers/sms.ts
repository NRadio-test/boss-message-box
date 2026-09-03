import type { SmsProvider } from "../core/ports";
import { SmsProviderRejectedError } from "../core/errors";
import type { Env } from "../env";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class AlibabaCloudSmsProvider implements SmsProvider {
  private readonly endpoint = "dysmsapi.aliyuncs.com";

  constructor(
    private readonly credentials: {
      accessKeyId: string;
      accessKeySecret: string;
      signName: string;
      templateCode: string;
    },
  ) {}

  async sendOtp(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void> {
    const parameters = new Map<string, string>([
      ["PhoneNumbers", input.phone],
      ["SignName", this.credentials.signName],
      ["TemplateCode", this.credentials.templateCode],
      ["TemplateParam", JSON.stringify({ code: input.code })],
    ]);
    const canonicalQuery = [...parameters.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
      .join("&");

    const date = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    const nonce = crypto.randomUUID();
    const emptyBodyHash = await sha256Hex("");
    const headers: Record<string, string> = {
      host: this.endpoint,
      "x-acs-action": "SendSms",
      "x-acs-content-sha256": emptyBodyHash,
      "x-acs-date": date,
      "x-acs-signature-nonce": nonce,
      "x-acs-version": "2017-05-25",
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.entries(headers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value.trim()}\n`)
      .join("");
    const canonicalRequest = [
      "POST",
      "/",
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      emptyBodyHash,
    ].join("\n");
    const algorithm = "ACS3-HMAC-SHA256";
    const stringToSign = `${algorithm}\n${await sha256Hex(canonicalRequest)}`;
    const signature = await hmacSha256Hex(this.credentials.accessKeySecret, stringToSign);
    const authorization = `${algorithm} Credential=${this.credentials.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`https://${this.endpoint}/?${canonicalQuery}`, {
        method: "POST",
        headers: { ...headers, authorization },
        signal: controller.signal,
      });
      const body = (await response.json()) as { Code?: string; Message?: string; RequestId?: string };
      if (!response.ok || body.Code !== "OK") {
        console.error("Alibaba Cloud SMS rejected request", {
          status: response.status,
          code: body.Code,
          requestId: body.RequestId,
        });
        throw new SmsProviderRejectedError();
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DevelopmentSmsProvider implements SmsProvider {
  constructor(private readonly fixedCode?: string) {}

  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    const code = this.fixedCode ?? input.code;
    console.info(`[development only] OTP sent to ${input.phone.slice(0, 3)}****${input.phone.slice(-4)}: ${code}`);
  }
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required SMS configuration: ${name}`);
  return value;
}

export function createSmsProvider(env: Env): SmsProvider {
  if (env.SMS_PROVIDER === "mock") {
    if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
      throw new Error("Mock SMS provider is forbidden outside development and test");
    }
    if (env.DEV_OTP_CODE && !/^\d{6}$/u.test(env.DEV_OTP_CODE)) {
      throw new Error("DEV_OTP_CODE must contain exactly six digits");
    }
    return new DevelopmentSmsProvider(env.DEV_OTP_CODE);
  }
  return new AlibabaCloudSmsProvider({
    accessKeyId: requireValue(env.ALIBABA_ACCESS_KEY_ID, "ALIBABA_ACCESS_KEY_ID"),
    accessKeySecret: requireValue(env.ALIBABA_ACCESS_KEY_SECRET, "ALIBABA_ACCESS_KEY_SECRET"),
    signName: requireValue(env.ALIBABA_SMS_SIGN_NAME, "ALIBABA_SMS_SIGN_NAME"),
    templateCode: requireValue(env.ALIBABA_SMS_TEMPLATE_CODE, "ALIBABA_SMS_TEMPLATE_CODE"),
  });
}
