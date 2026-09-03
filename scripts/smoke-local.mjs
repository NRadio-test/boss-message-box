const origin = process.env.SMOKE_ORIGIN ?? "http://127.0.0.1:5173";
const suffix = String(Date.now()).slice(-8);
const phone = `139${suffix}`;
const nickname = `本地验收-${suffix.slice(-4)}`;

async function json(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json();
  return { response, body };
}

const otpPayload = { phone, nickname, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" };
const otp = await json("/api/otp/request", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(otpPayload),
});
if (!otp.response.ok || !otp.body.challengeId) throw new Error(`OTP request failed: ${JSON.stringify(otp.body)}`);

const cooldown = await json("/api/otp/request", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(otpPayload),
});
if (cooldown.response.status !== 429 || cooldown.body.error?.code !== "OTP_COOLDOWN") {
  throw new Error(`Cooldown was not enforced: ${JSON.stringify(cooldown.body)}`);
}

const submissionKey = crypto.randomUUID();
const payload = {
  submissionKey,
  topic: "released_hardware",
  customTopic: null,
  content: "本地端到端验收留言",
  nickname,
  phone,
  privacyAgreed: true,
  livestreamAgreed: true,
  challengeId: otp.body.challengeId,
  otp: "123456",
};
const formData = new FormData();
formData.set("payload", JSON.stringify(payload));
const submitted = await json("/api/feedback", { method: "POST", body: formData });
if (!submitted.response.ok || submitted.body.idempotent !== false) {
  throw new Error(`Submission failed: ${JSON.stringify(submitted.body)}`);
}

const retryData = new FormData();
retryData.set("payload", JSON.stringify(payload));
const retried = await json("/api/feedback", { method: "POST", body: retryData });
if (!retried.response.ok || retried.body.idempotent !== true) {
  throw new Error(`Idempotent retry failed: ${JSON.stringify(retried.body)}`);
}

const history = await json("/api/history", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone, nickname }),
});
if (!history.response.ok || history.body.items?.[0]?.content !== payload.content) {
  throw new Error(`History lookup failed: ${JSON.stringify(history.body)}`);
}

const wrongNickname = await json("/api/history", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone, nickname: `${nickname}-错误` }),
});
const unknownPhone = await json("/api/history", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: `138${suffix}`, nickname }),
});
if (
  wrongNickname.response.status !== 404 ||
  unknownPhone.response.status !== 404 ||
  wrongNickname.body.error?.code !== unknownPhone.body.error?.code ||
  wrongNickname.body.error?.message !== unknownPhone.body.error?.message
) {
  throw new Error("History lookup leaked whether the phone or nickname matched");
}

console.log(
  JSON.stringify({
    otp: "sent",
    cooldownSeconds: cooldown.body.error.retryAfterSeconds,
    submission: "created",
    idempotentRetry: "confirmed",
    history: "confirmed",
    genericMismatch: "confirmed",
  }),
);
