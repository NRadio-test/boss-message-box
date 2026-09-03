import { ArrowClockwise, Inbox } from "@phosphor-icons/react";
import { Button } from "../../../components/Button";

export function StudioLoading({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="studio-loading" aria-live="polite" aria-busy="true">
      <span className="studio-loading-signal" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function StudioEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="studio-empty">
      <Inbox aria-hidden="true" weight="duotone" />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function StudioError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="studio-error" role="alert">
      <h2>暂时无法加载</h2>
      <p>{message}</p>
      <Button
        type="button"
        variant="secondary"
        icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
        onClick={onRetry}
      >
        重新加载
      </Button>
    </div>
  );
}
