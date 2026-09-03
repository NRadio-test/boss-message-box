import { SmsProviderRejectedError } from "../core/errors";
import type { SmsProvider } from "../core/ports";

const PNVS_ENDPOINT = "dypnsapi.aliyuncs.com";
const PNVS_ACTION = "SendSmsVerifyCode";
const PNVS_API_VERSION = "2017-05-25";
const PNVS_COUNTRY_CODE = "86";
const PNVS_CODE_LENGTH = 6;
const PNVS_VALID_TIME_SECONDS = 5 * 60;
const PNVS_SEND_INTERVAL_SECONDS = 120;
const PNVS_TIMEOUT_MS = 8_000;

interface PnvsResponse {
  Code?: string;
  Success?: boolean;
  RequestId?: string;
}

interface SmsProviderEnv {
  APP_ENV: "development" | "production" | "test";
  SMS_PROVIDER: "mock" | "alibaba_pnvs";
  DEV_OTP_CODE?: string;
  ALIBABA_ACCESS_KEY_ID?: string;
  ALIBABA_ACCESS_KEY_SECRET?: string;
  ALIBABA_PNVS_SIGN_NAME?: string;
  ALIBABA_PNVS_TEMPLATE_CODE?: string;
}

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

function compareByCodePoint(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalQueryString(parameters: ReadonlyMap<string, string>): string {
  return [...parameters.entries()]
    .sort(([left], [right]) => compareByCodePoint(left, right))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join("&");
}

function safeLogValue(value: string | undefined): string | undefined {
  return value?.replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 128);
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required PNVS configuration: ${name}`);
  return value;
}

export class AlibabaCloudPnvsSmsProvider implements SmsProvider {
  constructor(
    private readonly credentials: {
      accessKeyId: string;
      accessKeySecret: string;
      signName: string;
      templateCode: string;
    },
    private readonly timeoutMs = PNVS_TIMEOUT_MS,
  ) {}

  async sendOtp(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void> {
    if (!/^1[3-9]\d{9}$/u.test(input.phone) || !/^\d{6}$/u.test(input.code)) {
      throw new SmsProviderRejectedError();
    }
    if (input.expiresInMinutes * 60 !== PNVS_VALID_TIME_SECONDS) {
      throw new SmsProviderRejectedError();
    }

    const parameters = new Map<string, string>([
      ["AutoRetry", "0"],
      ["CodeLength", String(PNVS_CODE_LENGTH)],
      ["CountryCode", PNVS_COUNTRY_CODE],
      ["Interval", String(PNVS_SEND_INTERVAL_SECONDS)],
      ["PhoneNumber", input.phone],
      ["ReturnVerifyCode", "false"],
      ["SignName", this.credentials.signName],
      ["TemplateCode", this.credentials.templateCode],
      [
        "TemplateParam",
        JSON.stringify({ code: input.code, min: String(input.expiresInMinutes) }),
      ],
      ["ValidTime", String(PNVS_VALID_TIME_SECONDS)],
    ]);
    const canonicalQuery = canonicalQueryString(parameters);
    const date = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    const emptyBodyHash = await sha256Hex("");
    const headers: Record<string, string> = {
      host: PNVS_ENDPOINT,
      "x-acs-action": PNVS_ACTION,
      "x-acs-content-sha256": emptyBodyHash,
      "x-acs-date": date,
      "x-acs-signature-nonce": crypto.randomUUID(),
      "x-acs-version": PNVS_API_VERSION,
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.entries(headers)
      .sort(([left], [right]) => compareByCodePoint(left, right))
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
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`https://${PNVS_ENDPOINT}/?${canonicalQuery}`, {
        method: "POST",
        headers: { ...headers, authorization },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new Error("PNVS request timed out");
      throw new Error("PNVS network request failed");
    } finally {
      clearTimeout(timeout);
    }

    let result: PnvsResponse;
    try {
      result = (await response.json()) as PnvsResponse;
    } catch {
      throw new Error("PNVS returned an unreadable response");
    }

    if (response.ok && result.Code === "OK" && result.Success === true) return;

    if (response.status >= 500) {
      throw new Error("PNVS request outcome is unknown");
    }
    if (!response.ok || result.Success === false || (result.Code && result.Code !== "OK")) {
      console.error("Alibaba Cloud PNVS rejected request", {
        status: response.status,
        code: safeLogValue(result.Code),
        requestId: safeLogValue(result.RequestId),
      });
      throw new SmsProviderRejectedError();
    }
    throw new Error("PNVS returned an unexpected response");
  }
}

export class DevelopmentSmsProvider implements SmsProvider {
  constructor(private readonly fixedCode?: string) {}

  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    const code = this.fixedCode ?? input.code;
    console.info(`[development only] OTP sent to ${input.phone.slice(0, 3)}****${input.phone.slice(-4)}: ${code}`);
  }
}

export function resolveDevelopmentOtpCode(
  env: Pick<SmsProviderEnv, "APP_ENV" | "DEV_OTP_CODE">,
): string | undefined {
  if (env.APP_ENV !== "development") return undefined;
  if (env.DEV_OTP_CODE && !/^\d{6}$/u.test(env.DEV_OTP_CODE)) {
    throw new Error("DEV_OTP_CODE must contain exactly six digits");
  }
  return env.DEV_OTP_CODE;
}

export function createSmsProvider(env: SmsProviderEnv): SmsProvider {
  if (env.SMS_PROVIDER === "mock") {
    if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
      throw new Error("Mock SMS provider is forbidden outside development and test");
    }
    return new DevelopmentSmsProvider(resolveDevelopmentOtpCode(env));
  }
  if (env.SMS_PROVIDER !== "alibaba_pnvs") {
    throw new Error("Unsupported SMS provider");
  }
  return new AlibabaCloudPnvsSmsProvider({
    accessKeyId: requireValue(env.ALIBABA_ACCESS_KEY_ID, "ALIBABA_ACCESS_KEY_ID"),
    accessKeySecret: requireValue(env.ALIBABA_ACCESS_KEY_SECRET, "ALIBABA_ACCESS_KEY_SECRET"),
    signName: requireValue(env.ALIBABA_PNVS_SIGN_NAME, "ALIBABA_PNVS_SIGN_NAME"),
    templateCode: requireValue(env.ALIBABA_PNVS_TEMPLATE_CODE, "ALIBABA_PNVS_TEMPLATE_CODE"),
  });
}
