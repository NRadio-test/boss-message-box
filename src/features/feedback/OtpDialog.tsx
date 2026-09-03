import { ArrowClockwise, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { OtpSession } from "./draft-store";

interface OtpDialogProps {
  open: boolean;
  session: OtpSession | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (code: string) => void;
  onResend: () => void;
}

export function OtpDialog({
  open,
  session,
  loading,
  error,
  onClose,
  onConfirm,
  onResend,
}: OtpDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = setTimeout(() => inputRefs.current[0]?.focus(), 80);
    return () => clearTimeout(focusTimer);
  }, [open, session?.challengeId]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(interval);
  }, [open]);

  const remaining = useMemo(() => {
    if (!session) return 0;
    const serverNow = clock - session.serverOffsetMs;
    return Math.max(0, Math.ceil((session.cooldownEndsAt - serverNow) / 1000));
  }, [clock, session]);
  const code = digits.join("");

  const distribute = (value: string, start: number) => {
    const numbers = value.replace(/\D/g, "").slice(0, 6 - start).split("");
    if (numbers.length === 0) return;
    setDigits((current) => {
      const next = [...current];
      numbers.forEach((digit, index) => {
        next[start + index] = digit;
      });
      return next;
    });
    inputRefs.current[Math.min(start + numbers.length, 5)]?.focus();
  };

  return (
    <dialog ref={dialogRef} className="otp-dialog" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <span className="dialog-kicker">手机校验</span>
          <h2>验证手机号</h2>
        </div>
        <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="关闭验证">
          <X aria-hidden="true" weight="bold" />
        </button>
      </div>
      <div className="otp-body">
        {session?.challengeId ? (
          <>
            <p className="otp-destination">验证码已发送至<br /><strong>{session.maskedPhone}</strong></p>
            <fieldset className="otp-group">
              <legend className="sr-only">请输入 6 位短信验证码</legend>
              {digits.map((digit, index) => (
                <label key={index} className="otp-cell">
                  <span className="sr-only">第 {index + 1} 位</span>
                  <input
                    ref={(element) => { inputRefs.current[index] = element; }}
                    value={digit}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={index === 0 ? 6 : 1}
                    disabled={loading}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) distribute(value, index);
                      else setDigits((current) => current.map((item, itemIndex) => itemIndex === index ? "" : item));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" && !digits[index] && index > 0) {
                        inputRefs.current[index - 1]?.focus();
                      }
                      if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
                      if (event.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      distribute(event.clipboardData.getData("text"), index);
                    }}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "otp-error" : undefined}
                  />
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <div className="cooldown-message">
            <ArrowClockwise aria-hidden="true" weight="bold" />
            <p>上一条验证码仍在冷却中，倒计时结束后即可发送新的验证码。</p>
          </div>
        )}
        {error && <p id="otp-error" className="dialog-error" role="alert">{error}</p>}
        <div className="otp-resend" aria-live="polite">
          {remaining > 0 ? `${remaining} 秒后可重新发送` : (
            <button type="button" onClick={onResend} disabled={loading}>重新发送验证码</button>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        {session?.challengeId ? (
          <Button
            type="button"
            loading={loading}
            loadingLabel="正在提交"
            disabled={code.length !== 6}
            onClick={() => onConfirm(code)}
          >
            确认提交
          </Button>
        ) : (
          <Button type="button" disabled={remaining > 0} loading={loading} onClick={onResend}>
            发送验证码
          </Button>
        )}
      </div>
    </dialog>
  );
}
