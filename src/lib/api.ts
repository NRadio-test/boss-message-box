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
import { requestJson } from "./request";

export class ApiClientError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiClientError";
  }
}

async function expectJson<T>(path: string, init: RequestInit, timeoutMs?: number): Promise<T> {
  const { response, body } = await requestJson<T | ApiErrorBody>(path, init, timeoutMs);
  if (!response.ok || !body) {
    if (body && typeof body === "object" && "ok" in body && body.ok === false) {
      throw new ApiClientError(body);
    }
    throw new Error("网络连接不稳定，请稍后重试");
  }
  return body as T;
}

export async function getPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  return expectJson("/api/config", { signal, headers: { Accept: "application/json" } });
}

export async function requestOtp(payload: OtpRequest): Promise<OtpRequestSuccess> {
  return expectJson(
    "/api/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function submitFeedback(
  payload: FeedbackSubmission,
  images: File[],
  signal?: AbortSignal,
): Promise<SubmitSuccess> {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  for (const image of images) formData.append("images", image, image.name);
  return expectJson(
    "/api/feedback", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
      signal,
    },
    90_000,
  );
}

export async function queryHistory(payload: HistoryQuery, signal?: AbortSignal): Promise<HistorySuccess> {
  return expectJson(
    "/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
}
