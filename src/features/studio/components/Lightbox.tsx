import { ArrowLeft, ArrowRight, DownloadSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { closeDialog, openDialog } from "../../../lib/dialog";

export interface LightboxImage {
  id: string;
  src: string;
  downloadUrl: string;
  alt: string;
  width: number;
  height: number;
}

interface LightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

export function Lightbox({ images, initialIndex, onClose }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const current = images[index];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    openDialog(dialog);
  }, []);

  if (!current) return null;
  const previous = () => setIndex((value) => (value - 1 + images.length) % images.length);
  const next = () => setIndex((value) => (value + 1) % images.length);

  return (
    <dialog
      ref={ref}
      className="studio-lightbox"
      aria-label={`查看图片 ${index + 1}，共 ${images.length} 张`}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        if (ref.current) closeDialog(ref.current);
      }}
      onKeyDown={(event) => {
        if (images.length < 2) return;
        if (event.key === "ArrowLeft") previous();
        if (event.key === "ArrowRight") next();
      }}
    >
      <div className="studio-lightbox-toolbar">
        <span aria-live="polite">{index + 1} / {images.length}</span>
        <div>
          <a className="studio-icon-button" href={current.downloadUrl} download aria-label="下载当前图片">
            <DownloadSimple aria-hidden="true" weight="bold" />
          </a>
          <button type="button" className="studio-icon-button" aria-label="关闭图片" onClick={() => ref.current && closeDialog(ref.current)}>
            <X aria-hidden="true" weight="bold" />
          </button>
        </div>
      </div>
      <div className="studio-lightbox-stage">
        {images.length > 1 && (
          <button type="button" className="studio-lightbox-arrow" aria-label="上一张图片" onClick={previous}>
            <ArrowLeft aria-hidden="true" weight="bold" />
          </button>
        )}
        <img
          key={current.id}
          src={current.src}
          alt={current.alt}
          width={current.width}
          height={current.height}
        />
        {images.length > 1 && (
          <button type="button" className="studio-lightbox-arrow" aria-label="下一张图片" onClick={next}>
            <ArrowRight aria-hidden="true" weight="bold" />
          </button>
        )}
      </div>
    </dialog>
  );
}
