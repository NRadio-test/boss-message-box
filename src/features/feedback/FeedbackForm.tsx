import {
  ArrowRight,
  CheckCircle,
  ImageSquare,
  PaperPlaneTilt,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { FormField } from "../../components/FormField";
import { TurnstileWidget, type TurnstileHandle } from "../../components/TurnstileWidget";
import { ApiClientError, requestOtp, submitFeedback } from "../../lib/api";
import {
  feedbackFieldsSchema,
  TOPIC_LABELS,
  TOPIC_VALUES,
  type FeedbackFields,
  type PublicConfig,
} from "../../shared/contracts";
import { PolicyDialog } from "../privacy/PolicyDialog";
import {
  clearDraftFields,
  clearDraftImages,
  clearOtpSession,
  deleteDraftImage,
  EMPTY_DRAFT,
  loadDraft,
  loadDraftImages,
  loadOtpSession,
  saveDraft,
  saveDraftImage,
  saveIdentity,
  saveOtpSession,
  type DraftImage,
  type DraftState,
  type OtpSession,
} from "./draft-store";
import { compressImage } from "./image-compression";
import { OtpDialog } from "./OtpDialog";

interface LocalImage extends DraftImage {
  previewUrl: string;
}

function currentTimestamp(): number {
  return Date.now();
}

function draftHasContent(draft: DraftState): boolean {
  return Boolean(
    draft.topic ||
      draft.content ||
      draft.nickname ||
      draft.phone ||
      draft.privacyAgreed ||
      draft.livestreamAgreed,
  );
}

function collectErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  return Object.fromEntries(issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]));
}

export function FeedbackForm({ config }: { config: PublicConfig }) {
  const navigate = useNavigate();
  const initialDraft = useMemo(() => loadDraft(), []);
  const [draft, setDraft] = useState<DraftState>(initialDraft ?? EMPTY_DRAFT());
  const [images, setImages] = useState<LocalImage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(Boolean(initialDraft && draftHasContent(initialDraft)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [imageMessage, setImageMessage] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(0);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSession, setOtpSession] = useState<OtpSession | null>(loadOtpSession());
  const [policy, setPolicy] = useState<"privacy" | "livestream" | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<LocalImage[]>([]);

  useEffect(() => {
    let alive = true;
    loadDraftImages()
      .then((stored) => {
        if (!alive) return;
        setImages(
          stored.slice(0, 3).map((image) => ({
            ...image,
            previewUrl: URL.createObjectURL(image.blob),
          })),
        );
      })
      .catch(() => setImageMessage("本地图片草稿暂时无法恢复，请重新选择图片"))
      .finally(() => alive && setHydrated(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl)),
    [],
  );

  useEffect(() => {
    if (!hydrated) return;
    const timeout = setTimeout(() => saveDraft(draft), 240);
    return () => clearTimeout(timeout);
  }, [draft, hydrated]);

  const update = <Key extends keyof DraftState>(key: Key, value: DraftState[Key]) => {
    setDraft((current) => ({ ...current, [key]: value, updatedAt: Date.now() }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormMessage(null);
  };

  const validatedFields = (): FeedbackFields | null => {
    const result = feedbackFieldsSchema.safeParse({
      ...draft,
      customTopic: draft.topic === "other" ? draft.customTopic : null,
    });
    if (!result.success) {
      setErrors(collectErrors(result.error.issues));
      setFormMessage("还有几项需要补充，请检查标记的位置");
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return null;
    }
    setErrors({});
    return result.data;
  };

  const openVerification = async () => {
    const fields = validatedFields();
    if (!fields) return;
    const existing = loadOtpSession();
    const existingNow = existing ? currentTimestamp() - existing.serverOffsetMs : 0;
    if (
      existing &&
      existing.phone === fields.phone &&
      existing.nickname === fields.nickname &&
      existing.challengeId &&
      existing.expiresAt > existingNow
    ) {
      setOtpSession(existing);
      setOtpError(null);
      setOtpOpen(true);
      return;
    }
    await sendCode(fields);
  };

  const sendCode = async (fields = validatedFields()) => {
    if (!fields) return;
    setRequestingOtp(true);
    setOtpError(null);
    setFormMessage(null);
    try {
      const turnstileToken = await turnstileRef.current!.getToken();
      const result = await requestOtp({
        phone: fields.phone,
        nickname: fields.nickname,
        turnstileToken,
      });
      const session: OtpSession = {
        phone: fields.phone,
        nickname: fields.nickname,
        challengeId: result.challengeId,
        maskedPhone: result.maskedPhone,
        expiresAt: result.expiresAt,
        cooldownEndsAt: result.cooldownEndsAt,
        serverOffsetMs: Date.now() - result.serverNow,
      };
      saveOtpSession(session);
      setOtpSession(session);
      setOtpOpen(true);
    } catch (error) {
      if (error instanceof ApiClientError && error.body.error.code === "OTP_COOLDOWN") {
        const retry = error.body.error.retryAfterSeconds ?? 120;
        const previous = loadOtpSession();
        const session: OtpSession = {
          phone: fields.phone,
          nickname: fields.nickname,
          challengeId:
            previous?.phone === fields.phone && previous.nickname === fields.nickname
              ? previous.challengeId
              : null,
          maskedPhone: `${fields.phone.slice(0, 3)} **** ${fields.phone.slice(-4)}`,
          expiresAt: previous?.expiresAt ?? 0,
          cooldownEndsAt: Date.now() + retry * 1000,
          serverOffsetMs: 0,
        };
        saveOtpSession(session);
        setOtpSession(session);
        setOtpError(error.message);
        setOtpOpen(true);
      } else {
        const message = error instanceof Error ? error.message : "验证码发送失败，请稍后重试";
        setFormMessage(message);
      }
    } finally {
      turnstileRef.current?.reset();
      setRequestingOtp(false);
    }
  };

  const confirmSubmission = async (code: string) => {
    const fields = validatedFields();
    if (!fields || !otpSession?.challengeId) return;
    setSubmitting(true);
    setOtpError(null);
    try {
      const result = await submitFeedback(
        { ...fields, challengeId: otpSession.challengeId, otp: code },
        images.map((image, index) =>
          new File([image.blob], `image-${index + 1}.webp`, { type: "image/webp" }),
        ),
      );
      saveIdentity(fields.phone, fields.nickname);
      clearDraftFields();
      clearOtpSession();
      await clearDraftImages();
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setOtpOpen(false);
      navigate("/success", { replace: true, state: result });
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.body.error.fieldErrors) setErrors(error.body.error.fieldErrors);
        setOtpError(error.message);
      } else {
        setOtpError(error instanceof Error ? error.message : "提交失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const available = 3 - images.length;
    if (available <= 0) {
      setImageMessage("每次留言最多上传 3 张图片");
      return;
    }
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) setImageMessage(`只添加了前 ${available} 张图片，每次最多 3 张`);
    else setImageMessage(null);
    setCompressing(selected.length);
    const results = await Promise.allSettled(selected.map(compressImage));
    const added: LocalImage[] = [];
    for (const result of results) {
      if (result.status === "rejected") {
        setImageMessage(result.reason instanceof Error ? result.reason.message : "有一张图片处理失败");
        continue;
      }
      const image: LocalImage = {
        id: crypto.randomUUID(),
        blob: result.value.blob,
        name: `draft-${crypto.randomUUID()}.webp`,
        width: result.value.width,
        height: result.value.height,
        byteSize: result.value.blob.size,
        previewUrl: URL.createObjectURL(result.value.blob),
      };
      try {
        await saveDraftImage(image);
        added.push(image);
      } catch {
        URL.revokeObjectURL(image.previewUrl);
        setImageMessage("图片无法保存到本地草稿，请检查浏览器存储空间");
      }
    }
    setImages((current) => [...current, ...added].slice(0, 3));
    setCompressing(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = async (image: LocalImage) => {
    await deleteDraftImage(image.id).catch(() => undefined);
    URL.revokeObjectURL(image.previewUrl);
    setImages((current) => current.filter((item) => item.id !== image.id));
  };

  const startFresh = async () => {
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    await clearDraftImages().catch(() => undefined);
    clearDraftFields();
    clearOtpSession();
    setImages([]);
    setDraft(EMPTY_DRAFT());
    setRecovered(false);
    setOtpSession(null);
    setErrors({});
    setFormMessage(null);
  };

  return (
    <div className="page-column">
      <section className="page-intro" aria-labelledby="feedback-title">
        <div className="signal-caption"><span /> 直播留言通道</div>
        <h1 id="feedback-title">想说什么，直接写下来</h1>
        <p>产品问题、使用反馈、投诉或建议都会进入直播处理流程。通常只需要 2 分钟。</p>
      </section>

      {recovered && (
        <div className="recovery-banner" role="status">
          <CheckCircle aria-hidden="true" weight="fill" />
          <div><strong>已恢复上次未提交的内容</strong><span>文字和图片仍只保存在这台设备上</span></div>
          <button type="button" onClick={startFresh}>重新填写</button>
        </div>
      )}

      <form className="feedback-form" noValidate onSubmit={(event) => { event.preventDefault(); void openVerification(); }}>
        <FormField index="01" label="留言主题" htmlFor="topic" required error={errors.topic}>
          <select
            id="topic"
            required
            value={draft.topic}
            onChange={(event) => {
              update("topic", event.target.value as DraftState["topic"]);
              if (event.target.value !== "other") update("customTopic", null);
            }}
            aria-invalid={Boolean(errors.topic)}
            aria-describedby={errors.topic ? "topic-error" : undefined}
          >
            <option value="" disabled>请选择一个主题</option>
            {TOPIC_VALUES.map((topic) => <option key={topic} value={topic}>{TOPIC_LABELS[topic]}</option>)}
          </select>
        </FormField>

        {draft.topic === "other" && (
          <FormField label="请填写留言主题" htmlFor="custom-topic" required error={errors.customTopic} className="progressive-field">
            <input
              id="custom-topic"
              required
              value={draft.customTopic ?? ""}
              maxLength={60}
              onChange={(event) => update("customTopic", event.target.value)}
              aria-invalid={Boolean(errors.customTopic)}
              aria-describedby={errors.customTopic ? "custom-topic-error" : undefined}
              autoFocus
            />
          </FormField>
        )}

        <FormField index="02" label="留言内容" htmlFor="content" required error={errors.content}>
          <textarea
            id="content"
            required
            value={draft.content}
            maxLength={2000}
            rows={7}
            placeholder="把遇到的问题或想法说明白就好"
            onChange={(event) => update("content", event.target.value)}
            aria-invalid={Boolean(errors.content)}
            aria-describedby={errors.content ? "content-error" : undefined}
          />
          <div className="character-count" aria-live="polite">{draft.content.length} / 2000</div>
        </FormField>

        <FormField
          index="03"
          label="上传图片"
          htmlFor="images"
          helper="选填，最多 3 张。大图会先在本机快速压缩并移除拍摄信息。"
          error={imageMessage ?? undefined}
        >
          <input
            ref={fileInputRef}
            className="sr-only"
            id="images"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => void addImages(event.target.files)}
          />
          <button
            type="button"
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={images.length >= 3 || compressing > 0}
            aria-describedby={`images-helper${imageMessage ? " images-error" : ""}`}
          >
            <UploadSimple aria-hidden="true" weight="bold" />
            <span>{compressing > 0 ? `正在处理 ${compressing} 张图片` : images.length >= 3 ? "已添加 3 张图片" : "选择图片"}</span>
          </button>
          {images.length > 0 && (
            <ul className="image-list" aria-label="已选择的图片">
              {images.map((image) => (
                <li key={image.id}>
                  <img src={image.previewUrl} alt="留言附件预览" width={image.width} height={image.height} />
                  <div className="image-meta">
                    <ImageSquare aria-hidden="true" />
                    <span>{Math.max(1, Math.round(image.byteSize / 1024))} KB</span>
                  </div>
                  <button type="button" onClick={() => void removeImage(image)} aria-label="移除这张图片">
                    <Trash aria-hidden="true" weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormField>

        <FormField
          index="04"
          label="抖音昵称"
          htmlFor="nickname"
          required
          helper="首次提交后将与手机号绑定，请填写准确"
          error={errors.nickname}
        >
          <input
            id="nickname"
            required
            value={draft.nickname}
            maxLength={40}
            autoComplete="nickname"
            placeholder="请输入你的抖音昵称"
            onChange={(event) => update("nickname", event.target.value)}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={`nickname-helper${errors.nickname ? " nickname-error" : ""}`}
          />
        </FormField>

        <FormField index="05" label="手机号" htmlFor="phone" required error={errors.phone}>
          <div className="phone-input">
            <span aria-hidden="true">+86</span>
            <input
              id="phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={draft.phone}
              maxLength={13}
              placeholder="请输入中国大陆手机号"
              onChange={(event) => update("phone", event.target.value.replace(/[^\d\s-]/g, ""))}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "phone-error" : undefined}
            />
          </div>
        </FormField>

        <div className="form-submit-zone">
          <TurnstileWidget ref={turnstileRef} siteKey={config.turnstileSiteKey} />
          <fieldset className="acknowledgements">
            <legend className="sr-only">提交前确认</legend>
            <div className={errors.privacyAgreed ? "checkbox-row checkbox-row--error" : "checkbox-row"}>
              <input
                id="privacy-agreed"
                type="checkbox"
                required
                checked={draft.privacyAgreed}
                onChange={(event) => update("privacyAgreed", event.target.checked)}
                aria-invalid={Boolean(errors.privacyAgreed)}
                aria-describedby={errors.privacyAgreed ? "privacy-agreed-error" : undefined}
              />
              <div><label htmlFor="privacy-agreed">我已阅读并同意</label><button type="button" onClick={() => setPolicy("privacy")}>《隐私政策》</button></div>
              {errors.privacyAgreed && <p id="privacy-agreed-error" className="field-error acknowledgement-error" role="alert">{errors.privacyAgreed}</p>}
            </div>
            <div className={errors.livestreamAgreed ? "checkbox-row checkbox-row--error" : "checkbox-row"}>
              <input
                id="livestream-agreed"
                type="checkbox"
                required
                checked={draft.livestreamAgreed}
                onChange={(event) => update("livestreamAgreed", event.target.checked)}
                aria-invalid={Boolean(errors.livestreamAgreed)}
                aria-describedby={errors.livestreamAgreed ? "livestream-agreed-error" : undefined}
              />
              <div><label htmlFor="livestream-agreed">我知道抖音昵称、留言文字和提交内容可能在公司直播中</label><button type="button" onClick={() => setPolicy("livestream")}>公开展示和回复</button>，手机号不会公开</div>
              {errors.livestreamAgreed && <p id="livestream-agreed-error" className="field-error acknowledgement-error" role="alert">{errors.livestreamAgreed}</p>}
            </div>
          </fieldset>
          {formMessage && <p className="form-message" role="alert">{formMessage}</p>}
          <Button
            className="submit-button"
            type="submit"
            loading={requestingOtp}
            loadingLabel="正在发送验证码"
            icon={<PaperPlaneTilt aria-hidden="true" weight="fill" />}
          >
            提交留言
          </Button>
          <a className="history-shortcut" href="/my" onClick={(event) => { event.preventDefault(); navigate("/my"); }}>
            查看我的留言 <ArrowRight aria-hidden="true" weight="bold" />
          </a>
        </div>
      </form>

      <PolicyDialog
        open={policy !== null}
        kind={policy ?? "privacy"}
        version={policy === "livestream" ? config.livestreamPolicyVersion : config.privacyPolicyVersion}
        onClose={() => setPolicy(null)}
      />
      {otpOpen && (
        <OtpDialog
          key={otpSession?.challengeId ?? "cooldown"}
          open
          session={otpSession}
          loading={submitting || requestingOtp}
          error={otpError}
          onClose={() => setOtpOpen(false)}
          onConfirm={(code) => void confirmSubmission(code)}
          onResend={() => void sendCode()}
        />
      )}
    </div>
  );
}
