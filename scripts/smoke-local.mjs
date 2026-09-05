const origin = process.env.SMOKE_ORIGIN ?? "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
  throw new Error("This smoke check creates test data and only supports a local server.");
}
const suffix = String(Date.now()).slice(-8);
const nickname = `本地验收-${suffix}`;

async function json(path, init) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  return { response, body };
}

const submissionKey = crypto.randomUUID();
const payload = {
  submissionKey,
  topic: "released_hardware",
  customTopic: null,
  content: "本地端到端验收留言",
  nickname,
  privacyAgreed: true,
  livestreamAgreed: true,
  turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
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
  body: JSON.stringify({ nickname }),
});
if (!history.response.ok || history.body.items?.[0]?.content !== payload.content) {
  throw new Error(`History lookup failed: ${JSON.stringify(history.body)}`);
}

const wrongNickname = await json("/api/history", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ nickname: `${nickname}-不存在` }),
});
if (wrongNickname.response.status !== 404) {
  throw new Error("Unknown nickname did not return the expected history lookup error");
}

console.log(
  JSON.stringify({
    submission: "created",
    idempotentRetry: "confirmed",
    history: "confirmed",
    unknownNickname: "confirmed",
  }),
);
