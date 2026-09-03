// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsProviderRejectedError } from "../../worker/core/errors";
import {
  AlibabaCloudPnvsSmsProvider,
  resolveDevelopmentOtpCode,
} from "../../worker/providers/sms";

const TEST_CREDENTIALS = {
  accessKeyId: "fixture-access-key-id",
  accessKeySecret: "fixture-access-key-secret",
  signName: "fixture-pnvs-sign",
  templateCode: "100001",
};
const PHONE = "13800138000";
const OTP = "583921";

function successResponse(): Response {
  return Response.json({ Code: "OK", Success: true, RequestId: "request-success" });
}

function requestParameters(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): URLSearchParams {
  const [input] = fetchMock.mock.calls[0]!;
  return new URL(String(input)).searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Alibaba Cloud PNVS SMS provider", () => {
  it("sends the Worker-generated OTP through a correctly signed SendSmsVerifyCode request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlibabaCloudPnvsSmsProvider(TEST_CREDENTIALS);

    await provider.sendOtp({ phone: PHONE, code: OTP, expiresInMinutes: 5 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/dypnsapi\.aliyuncs\.com\/\?/u);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("x-acs-action")).toBe("SendSmsVerifyCode");
    expect(headers.get("x-acs-version")).toBe("2017-05-25");
    expect(headers.get("x-acs-content-sha256")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(headers.has("content-type")).toBe(false);
    expect(headers.get("authorization")).toMatch(
      /^ACS3-HMAC-SHA256 Credential=fixture-access-key-id,SignedHeaders=.*Signature=[a-f0-9]{64}$/u,
    );

    const parameters = requestParameters(fetchMock);
    expect([...parameters.keys()]).toEqual([...parameters.keys()].sort());
    expect(parameters.get("CountryCode")).toBe("86");
    expect(parameters.get("PhoneNumber")).toBe(PHONE);
    expect(parameters.get("SignName")).toBe(TEST_CREDENTIALS.signName);
    expect(parameters.get("TemplateCode")).toBe(TEST_CREDENTIALS.templateCode);
    expect(JSON.parse(parameters.get("TemplateParam")!)).toEqual({ code: OTP, min: "5" });
    expect(parameters.get("CodeLength")).toBe("6");
    expect(parameters.get("ValidTime")).toBe("300");
    expect(parameters.get("Interval")).toBe("120");
    expect(parameters.get("ReturnVerifyCode")).toBe("false");
    expect(parameters.get("AutoRetry")).toBe("0");
    expect(parameters.has("CodeType")).toBe(false);
    expect(parameters.get("TemplateParam")).not.toContain("##code##");
  });

  it("treats an Alibaba business rejection as an explicit no-send outcome", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ Code: "FREQUENCY_FAIL", Success: false, RequestId: "request-rejected" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = new AlibabaCloudPnvsSmsProvider(TEST_CREDENTIALS);

    await expect(
      provider.sendOtp({ phone: PHONE, code: OTP, expiresInMinutes: 5 }),
    ).rejects.toBeInstanceOf(SmsProviderRejectedError);

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("FREQUENCY_FAIL");
    for (const secret of [PHONE, OTP, TEST_CREDENTIALS.accessKeyId, TEST_CREDENTIALS.accessKeySecret]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("keeps an HTTP 5xx outcome uncertain so the OTP cooldown lease is not released", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ Code: "InternalError", Success: false }, { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlibabaCloudPnvsSmsProvider(TEST_CREDENTIALS);

    const error = await provider
      .sendOtp({ phone: PHONE, code: OTP, expiresInMinutes: 5 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SmsProviderRejectedError);
    expect((error as Error).message).toBe("PNVS request outcome is unknown");
  });

  it("replaces network errors with a safe provider-level error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`upstream included ${PHONE} ${OTP} ${TEST_CREDENTIALS.accessKeySecret}`));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlibabaCloudPnvsSmsProvider(TEST_CREDENTIALS);

    await expect(
      provider.sendOtp({ phone: PHONE, code: OTP, expiresInMinutes: 5 }),
    ).rejects.toThrow("PNVS network request failed");
  });

  it("aborts a slow PNVS request after the configured timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlibabaCloudPnvsSmsProvider(TEST_CREDENTIALS, 5);

    await expect(
      provider.sendOtp({ phone: PHONE, code: OTP, expiresInMinutes: 5 }),
    ).rejects.toThrow("PNVS request timed out");
  });

  it("ignores a fixed development OTP in production and test environments", () => {
    expect(resolveDevelopmentOtpCode({ APP_ENV: "production", DEV_OTP_CODE: "123456" })).toBeUndefined();
    expect(resolveDevelopmentOtpCode({ APP_ENV: "test", DEV_OTP_CODE: "123456" })).toBeUndefined();
    expect(resolveDevelopmentOtpCode({ APP_ENV: "development", DEV_OTP_CODE: "123456" })).toBe("123456");
  });
});
