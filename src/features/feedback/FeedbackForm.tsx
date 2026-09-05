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
import { ApiClientError, submitFeedback } from "../../lib/api";
import { createRandomUuid } from "../../lib/random-id";
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
  deleteDraftImage,
  EMPTY_DRAFT,
  loadDraft,
  loadDraftImages,
  markDraftSubmitted,
  saveDraft,
  saveDraftImage,
  saveIdentity,
  type DraftImage,
  type DraftState,
} from "./draft-store";
import { compressImage } from "./image-compression";

interface LocalImage extends DraftImage {
  previewUrl: string;
}

function draftHasContent(draft: DraftState): boolean {
  return Boolean(
    draft.topic ||
      draft.content ||
      draft.nickname ||
      draft.imagesEnabled ||
      draft.privacyAgreed ||
      draft.livestreamAgreed,
  );
}

function collectErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] = issue.message;
  return errors;
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
  const [submitting, setSubmitting] = useState(false);
  const [policy, setPolicy] = useState<"privacy" | "livestream" | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<LocalImage[]>([]);
  const mounted = useRef(true);
  const submitted = useRef(false);
  const submittingRef = useRef(false);
  const imageGeneration = useRef(0);
  const compressionController = useRef<AbortController | null>(null);
  const submissionController = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = submitting || Boolean(draft.submissionPending);

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    const generation = imageGeneration.current;
    const recovery = initialDraft?.imagesEnabled ? loadDraftImages(initialDraft.submissionKey, initialDraft.imagesVersion !== 2) : Promise.resolve([]);
    recovery
      .then((stored) => {
        if (!alive || generation !== imageGeneration.current) return;
        const restored = stored.slice(0, 3).map((image) => ({
            ...image,
            previewUrl: URL.createObjectURL(image.blob),
          }));
        imagesRef.current = restored;
        setImages(restored);
        setDraft((current) => ({ ...current, imagesVersion: 2 }));
      })
      .catch(() => alive && setImageMessage("本地图片草稿暂时无法恢复，请重新选择图片"))
      .finally(() => alive && setHydrated(true));
    return () => {
      alive = false;
      mounted.current = false;
      imageGeneration.current += 1;
      compressionController.current?.abort();
      submissionController.current?.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, [initialDraft]);

  useEffect(() => {
    draftRef.current = draft;
    if (!hydrated) return;
    saveTimer.current = setTimeout(() => {
      if (!submitted.current) saveDraft(draft);
    }, 240);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, hydrated]);

  useEffect(() => {
    const flush = () => { if (!submitted.current) saveDraft(draftRef.current); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  const update = <Key extends keyof DraftState>(key: Key, value: DraftState[Key]) => {
    if (submittingRef.current || submitted.current || draft.submissionPending) return;
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

  const submit = async () => {
    if (submittingRef.current || submitted.current) return;
    if (!hydrated || compressionController.current) {
      setFormMessage(!hydrated ? "正在恢复草稿，请稍候" : "图片还在处理中，请处理完成后再提交");
      return;
    }
    const fields = validatedFields();
    if (!fields) return;
    if (draft.submissionPending && (draft.submissionImageCount ?? 0) !== images.length) {
      setFormMessage("上次提交的图片草稿无法完整恢复，请先到“我的留言”核对是否已提交。核对后可点击下方重新填写。");
      return;
    }
    submittingRef.current = true;
    const controller = new AbortController();
    submissionController.current = controller;
    setSubmitting(true);
    setFormMessage(null);
    let sent = false;
    try {
      const verifier = turnstileRef.current;
      if (!verifier) throw new Error("安全验证仍在加载，请稍后再试");
      const turnstileToken = await verifier.getToken();
      controller.signal.throwIfAborted();
      const pending = { ...draft, submissionPending: true, submissionImageCount: draft.imagesEnabled ? images.length : 0 };
      draftRef.current = pending;
      setDraft(pending);
      saveDraft(pending);
      sent = true;
      const result = await submitFeedback(
        { ...fields, turnstileToken },
        draft.imagesEnabled
          ? images.map((image, index) =>
              new File([image.blob], "image-" + String(index + 1) + ".webp", { type: "image/webp" }),
            )
          : [],
        controller.signal,
      );
      // Once the server confirms receipt, optional browser cleanup cannot undo it.
      submitted.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      markDraftSubmitted(fields.submissionKey);
      try { saveIdentity(fields.nickname); } catch { /* Optional browser storage. */ }
      try { clearDraftFields(); } catch { /* The completed key prevents stale recovery. */ }
      try { void clearDraftImages(fields.submissionKey).catch(() => undefined); } catch { /* Optional cleanup. */ }
      if (!mounted.current) return;
      navigate("/success", { replace: true, state: result });
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || submitted.current) return;
      const definitive = error instanceof ApiClientError && !["SUBMISSION_FAILED", "SERVER_ERROR"].includes(error.body.error.code);
      if (sent && definitive) {
        const editable = { ...draft, submissionPending: false };
        draftRef.current = editable;
        setDraft(editable);
        saveDraft(editable);
      }
      if (error instanceof ApiClientError && error.body.error.fieldErrors) {
        setErrors(error.body.error.fieldErrors);
      }
      setFormMessage(error instanceof Error ? error.message : "提交失败，请稍后重试");
    } finally {
      turnstileRef.current?.reset();
      submittingRef.current = false;
      submissionController.current = null;
      if (mounted.current && !submitted.current) setSubmitting(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length || !hydrated || !draft.imagesEnabled || compressionController.current || submittingRef.current || draft.submissionPending) return;
    const available = 3 - imagesRef.current.length;
    if (available <= 0) {
      setImageMessage("每次留言最多上传 3 张图片");
      return;
    }
    const selected = Array.from(files).slice(0, available);
    const generation = ++imageGeneration.current;
    const controller = new AbortController();
    compressionController.current = controller;
    const active = () => mounted.current && generation === imageGeneration.current && !controller.signal.aborted;
    setImageMessage(files.length > available ? "只添加了前 " + available + " 张图片，每次最多 3 张" : null);
    setCompressing(selected.length);
    try {
      for (const [index, file] of selected.entries()) {
        if (!active()) break;
        try {
          const result = await compressImage(file, controller.signal);
          if (!active()) break;
          const image: LocalImage = {
            id: createRandomUuid(),
            submissionKey: draft.submissionKey,
            blob: result.blob,
            name: "draft-" + createRandomUuid() + ".webp",
            width: result.width,
            height: result.height,
            byteSize: result.blob.size,
            previewUrl: URL.createObjectURL(result.blob),
          };
          imagesRef.current = [...imagesRef.current, image];
          setImages(imagesRef.current);
          try { await saveDraftImage(image); } catch {
            if (active()) setImageMessage("本地草稿无法保存，图片仍可正常提交；离开页面后需重新选择");
          }
          if (!active()) void deleteDraftImage(image.id).catch(() => undefined);
        } catch (error) {
          if (active()) setImageMessage(error instanceof Error ? error.message : "有一张图片处理失败");
        }
        if (active()) setCompressing(selected.length - index - 1);
      }
    } finally {
      if (active()) {
        compressionController.current = null;
        setCompressing(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  };

  const removeImage = async (image: LocalImage) => {
    if (submittingRef.current || draft.submissionPending) return;
    URL.revokeObjectURL(image.previewUrl);
    imagesRef.current = imagesRef.current.filter((item) => item.id !== image.id);
    setImages(imagesRef.current);
    await deleteDraftImage(image.id).catch(() => undefined);
  };

  const clearSelectedImages = () => {
    imageGeneration.current += 1;
    compressionController.current?.abort();
    compressionController.current = null;
    setCompressing(0);
    const removed = imagesRef.current;
    removed.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    imagesRef.current = [];
    setImages([]);
    setImageMessage(null);
    void Promise.all(removed.map((image) => deleteDraftImage(image.id))).catch(() => undefined);
  };

  const toggleImages = (enabled: boolean) => {
    if (!hydrated || submittingRef.current || draft.submissionPending) return;
    if (!enabled && imagesRef.current.length > 0) {
      const confirmed = window.confirm("关闭后会清除已经选择的图片，确定关闭吗？");
      if (!confirmed) return;
    }
    if (!enabled) clearSelectedImages();
    update("imagesEnabled", enabled);
  };

  const startFresh = () => {
    if (submittingRef.current || !hydrated || draft.submissionPending) return;
    clearSelectedImages();
    clearDraftFields();
    setDraft(EMPTY_DRAFT());
    setRecovered(false);
    setErrors({});
    setFormMessage(null);
  };

  const abandonMissingDraft = () => {
    if (!window.confirm("请先查询“我的留言”确认上次是否成功。确定放弃这份图片不完整的草稿，重新填写吗？")) return;
    clearSelectedImages();
    clearDraftFields();
    setDraft(EMPTY_DRAFT());
    setRecovered(false);
    setErrors({});
    setFormMessage(null);
  };

  return (
    <div className="page-column">
      <section className="page-intro" aria-labelledby="feedback-title">
        <div className="signal-caption"><span /> 直播留言通道</div>
        <h1 id="feedback-title">想说什么，直接写下来</h1>
        <p>产品问题、使用反馈、投诉或建议，统统端上来拷打张导！</p>
      </section>

      {recovered && (
        <div className="recovery-banner" role="status">
          <CheckCircle aria-hidden="true" weight="fill" />
          <div><strong>已恢复上次未提交的内容</strong><span>文字和图片仍只保存在这台设备上</span></div>
          <button type="button" disabled={!hydrated || locked} onClick={startFresh}>重新填写</button>
        </div>
      )}

      <form className="feedback-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <FormField index="01" label="留言主题" htmlFor="topic" required error={errors.topic}>
          <select
            id="topic"
            disabled={locked}
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
              disabled={locked}
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
            disabled={locked}
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
          label="抖音昵称"
          htmlFor="nickname"
          required
          helper="同一昵称每天最多成功提交 10 条留言"
          error={errors.nickname}
        >
          <input
            id="nickname"
            disabled={locked}
            required
            value={draft.nickname}
            maxLength={40}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="请输入你的抖音昵称"
            onChange={(event) => update("nickname", event.target.value)}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={"nickname-helper" + (errors.nickname ? " nickname-error" : "")}
          />
        </FormField>

        <FormField index="04" label="上传图片" helper="选填，最多 3 张。" error={imageMessage ?? undefined}>
          <div className="optional-upload-control">
            <span>需要上传图片时再开启</span>
            <label className="switch-control" htmlFor="images-enabled">
              <span>{draft.imagesEnabled ? "已开启" : "未开启"}</span>
              <input
                id="images-enabled"
                disabled={!hydrated || locked}
                type="checkbox"
                role="switch"
                checked={draft.imagesEnabled}
                onChange={(event) => void toggleImages(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
          </div>
          {draft.imagesEnabled && (
            <div className="optional-upload-panel">
              <input
                ref={fileInputRef}
                className="sr-only"
                id="images"
                disabled={!hydrated || locked || compressing > 0}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => void addImages(event.target.files)}
              />
              <button
                type="button"
                className="upload-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!hydrated || locked || images.length >= 3 || compressing > 0}
              >
                <UploadSimple aria-hidden="true" weight="bold" />
                <span>
                  {compressing > 0
                    ? "正在处理 " + compressing + " 张图片"
                    : images.length >= 3
                      ? "已添加 3 张图片"
                      : "选择图片"}
                </span>
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
                      <button type="button" disabled={locked || compressing > 0} onClick={() => void removeImage(image)} aria-label="移除这张图片">
                        <Trash aria-hidden="true" weight="bold" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </FormField>

        <div className="form-submit-zone">
          <TurnstileWidget ref={turnstileRef} siteKey={config.turnstileSiteKey} />
          <fieldset className="acknowledgements" disabled={locked}>
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
              <div><label htmlFor="livestream-agreed">我知道抖音昵称、留言文字和图片可能在公司直播中</label><button type="button" onClick={() => setPolicy("livestream")}>公开展示和回复</button></div>
              {errors.livestreamAgreed && <p id="livestream-agreed-error" className="field-error acknowledgement-error" role="alert">{errors.livestreamAgreed}</p>}
            </div>
          </fieldset>
          {formMessage && <p className="form-message" role="alert">{formMessage}</p>}
          {draft.submissionPending && !submitting && <p className="form-message" role="status">上次提交的结果尚未确认，内容已暂时锁定。请点击提交留言重试确认，不会重复创建留言。</p>}
          {hydrated && draft.submissionPending && !submitting && (draft.submissionImageCount ?? 0) !== images.length && <Button type="button" variant="quiet" onClick={abandonMissingDraft}>已核对留言，重新填写</Button>}
          {!hydrated && <p className="form-message" role="status">正在恢复草稿，请稍候</p>}
          {compressing > 0 && <p className="form-message" role="status">图片处理完成后即可提交</p>}
          <Button
            className="submit-button"
            type="submit"
            loading={submitting}
            disabled={!hydrated || compressing > 0}
            loadingLabel="正在提交"
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
    </div>
  );
}
