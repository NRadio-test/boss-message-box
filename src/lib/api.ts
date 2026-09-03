import type {
  ApiErrorBody,
  FeedbackSubmission,
  HistoryQuery,
  HistorySuccess,
  OtpRequest,
  OtpRequestSuccess,
  PublicConfig,
  SubmitSuccess,
} from "../shared/contracts";

export class ApiClientError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiClientError";
  }
}

async function expectJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok || !body) {
    if (body && typeof body === "object" && "ok" in body && body.ok === false) {
      throw new ApiClientError(body);
    }
    throw new Error("网络连接不稳定，请稍后重试");
  }
  return body as T;
}

export async function getPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  return expectJson(await fetch("/api/config", { signal, headers: { Accept: "application/json" } }));
}

export async function requestOtp(payload: OtpRequest): Promise<OtpRequestSuccess> {
  return expectJson(
    await fetch("/api/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function submitFeedback(
  payload: FeedbackSubmission,
  images: File[],
): Promise<SubmitSuccess> {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  for (const image of images) formData.append("images", image, image.name);
  return expectJson(
    await fetch("/api/feedback", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
    }),
  );
}

export async function queryHistory(payload: HistoryQuery): Promise<HistorySuccess> {
  return expectJson(
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
