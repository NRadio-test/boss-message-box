import { CircleNotch } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet";
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel = "处理中",
  icon,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <CircleNotch className="spinner" aria-hidden="true" weight="bold" /> : icon}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
