import { ArrowLeft, ArrowRight, Broadcast, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/Button";
import { createRandomUuid } from "../../../lib/random-id";
import { ULTRA_PHOTO_ACCEPT, type UltraPhoto } from "../../../shared/ultra-photo-contracts";
import { StudioEmpty, StudioError, StudioLoading } from "../components/AsyncState";
import { Lightbox } from "../components/Lightbox";
import type { StudioOutletContext } from "../components/StudioShell";
import { getUltraPhotos, uploadUltraPhoto } from "../ultra-photo-api";

const newestFirst = (items: UltraPhoto[]) => [...items].sort((a, b) => b.uploadedAt - a.uploadedAt || b.id.localeCompare(a.id));
const time = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(value);

export function UltraPhotosPage() {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const navigate = useNavigate();
  const [query, setQuery] = useSearchParams();
  const [photos, setPhotos] = useState<UltraPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imageState, setImageState] = useState<{ id: string; failed: boolean } | null>(null);
  const [imageRetry, setImageRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const jobs = useRef<Array<{ file: File; key: string }>>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    getUltraPhotos(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPhotos(newestFirst(result.items)); setError(null);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "照片加载失败"); });
    return () => controller.abort();
  }, [reload]);

  const requestedIndex = photos?.findIndex(item => item.id === query.get("photo")) ?? -1;
  const index = requestedIndex >= 0 ? requestedIndex : 0;
  const current = photos?.[index];
  const move = (direction: number) => {
    const target = photos?.[index + direction];
    if (!target) return;
    const next = new URLSearchParams(query); next.set("photo", target.id);
    setQuery(next, { replace: true });
  };
  useLayoutEffect(() => {
    if (!liveMode || lightboxIndex !== null) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector("dialog[open]")) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const target = photos?.[index + direction];
      if (!direction || !target) return;
      event.preventDefault();
      const next = new URLSearchParams(query); next.set("photo", target.id);
      setQuery(next, { replace: true });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [index, lightboxIndex, liveMode, photos, query, setQuery]);

  const upload = async () => {
    if (lock.current || liveMode) return;
    lock.current = true; setUploading(true); setUploadError(null); setUploadNotice(null);
    const total = jobs.current.length;
    try {
      while (jobs.current.length) {
        const job = jobs.current[0]!;
        setProgress(`正在上传 ${total - jobs.current.length + 1} / ${total}：${job.file.name}`);
        const result = await uploadUltraPhoto(job.file, job.key);
        jobs.current.shift();
        if (!mounted.current) return;
        setPhotos(existing => newestFirst([result.item, ...(existing ?? []).filter(item => item.id !== result.item.id)]));
      }
      setUploadNotice(`已上传 ${total} 张照片，最新照片排在最前面。`);
    } catch (reason) {
      if (mounted.current) setUploadError(reason instanceof Error ? reason.message : "照片上传失败，请重试");
    } finally {
      lock.current = false;
      if (mounted.current) { setUploading(false); setProgress(""); }
    }
  };

  const lightbox = lightboxIndex !== null && photos && <Lightbox images={photos.map(item => ({ id: item.id, src: item.imageUrl,
    downloadUrl: item.imageUrl, alt: `${item.senderName}的 Ultra 到货照片` }))}
    initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />;

  if (liveMode) {
    return <div className="studio-live-page studio-ultra-live">
      {!photos && !error && <StudioLoading label="正在加载到货照片" />}
      {error && <StudioError message={error} onRetry={() => setReload(value => value + 1)} />}
      {photos?.length === 0 && <StudioEmpty title="还没有到货照片" description="退出直播展示后上传照片。" />}
      {current && <section key={current.id} className="studio-live-stage" aria-label="Ultra 到货照片直播展示" aria-keyshortcuts="ArrowLeft ArrowRight">
        <div className="studio-live-frame">
          <header className="studio-live-identity" tabIndex={0} aria-label="照片发送者">
            <div className="studio-live-signal-mark" aria-hidden="true"><i /><i /><i /></div>
            <div className="studio-live-identity-copy"><h1>{current.senderName}</h1><p>第一批 Ultra 到货照片</p></div>
          </header>
          <article className="studio-live-message studio-ultra-photo-panel" aria-label="到货照片">
            <button className="studio-ultra-stage-image" type="button" onClick={() => setLightboxIndex(index)} aria-label={`放大 ${current.senderName} 的照片`}>
              <img key={`${current.id}-${imageRetry}`} src={current.imageUrl} alt={`${current.senderName}的 Ultra 到货照片`}
                onLoad={() => setImageState({ id: current.id, failed: false })}
                onError={() => setImageState({ id: current.id, failed: true })} />
            </button>
            {imageState?.id !== current.id && <p className="studio-ultra-image-status" role="status">正在加载照片…</p>}
            {imageState?.id === current.id && imageState.failed && <div className="studio-ultra-image-status" role="alert">照片加载失败 <Button variant="secondary" onClick={() => setImageRetry(value => value + 1)}>重试</Button></div>}
          </article>
        </div>
        <div className="studio-ultra-live-navigation" aria-label="照片翻页">
          <button type="button" className="studio-live-action" disabled={index === 0} aria-label="上一张照片" onClick={() => move(-1)}><ArrowLeft aria-hidden="true" /></button>
          <span role="status">{index + 1} / {photos!.length}</span>
          <button type="button" className="studio-live-action" disabled={index === photos!.length - 1} aria-label="下一张照片" onClick={() => move(1)}><ArrowRight aria-hidden="true" /></button>
          <span className="sr-only">右方向键查看更早上传的照片，左方向键返回更新的照片。</span>
        </div>
      </section>}
      {lightbox}
    </div>;
  }

  return <div className="studio-page studio-ultra-gallery">
    <header className="studio-page-heading"><div><h1>Ultra 到货照片</h1><p>第一批 Ultra · 按上传时间从新到旧</p></div><span>{photos?.length ?? 0} 张</span></header>
    {error && <StudioError message={error} onRetry={() => setReload(value => value + 1)} />}
    {!photos && !error && <StudioLoading label="正在加载到货照片" />}
    {photos?.length === 0 && <StudioEmpty title="还没有到货照片" description="点击左下角上传照片，文件名会作为发送者名称。" />}
    <div className="studio-ultra-grid">
      {photos?.map((item, position) => <button className="studio-ultra-preview" key={item.id} onClick={() => setLightboxIndex(position)} aria-label={`预览 ${item.senderName} 的照片`}>
        <div className="studio-ultra-preview-image"><img src={item.imageUrl} alt={`${item.senderName}的 Ultra 到货照片`} loading="lazy" /></div>
        <strong>{item.senderName}</strong><time dateTime={new Date(item.uploadedAt).toISOString()}>上传于 {time(item.uploadedAt)}</time>
      </button>)}
    </div>
    <footer className="studio-ultra-upload-bar">
      <div className="studio-ultra-upload-feedback">
        {progress && <p role="status">{progress}</p>}{uploadNotice && <p role="status">{uploadNotice}</p>}
        {uploadError && <p className="studio-field-error" role="alert">{uploadError} <button type="button" onClick={() => void upload()}>重试剩余照片</button></p>}
      </div>
      <div className="studio-ultra-upload-actions">
        <input ref={input} className="sr-only" type="file" multiple accept={ULTRA_PHOTO_ACCEPT} tabIndex={-1} aria-label="选择到货照片"
          onChange={event => {
            const files = Array.from(event.target.files ?? []); event.target.value = "";
            if (!files.length || lock.current) return;
            jobs.current = files.map(file => ({ file, key: createRandomUuid() })); void upload();
          }} />
        <Button type="button" variant="secondary" loading={uploading} loadingLabel="正在上传" icon={<UploadSimple aria-hidden="true" />} onClick={() => input.current?.click()}>上传照片</Button>
        <Button type="button" disabled={!photos?.length || uploading} icon={<Broadcast aria-hidden="true" />} onClick={() => navigate("/studio/ultra-photos?mode=live")}>直播展示</Button>
      </div>
    </footer>
    {lightbox}
  </div>;
}
