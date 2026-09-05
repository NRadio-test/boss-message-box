import { useState, type FormEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Button } from "../../../components/Button";
import { studioPasswordSchema } from "../../../shared/studio-contracts";
import { requestJson } from "../../../lib/request";
import type { StudioOutletContext } from "../components/StudioShell";

export function PasswordPage() {
  const { liveMode } = useOutletContext<StudioOutletContext>();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (liveMode) return <p>请先退出直播模式，再修改密码。</p>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = studioPasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查密码"); return; }
    if (newPassword !== confirmation) { setError("两次新密码不一致"); return; }
    setBusy(true);
    setError(null);
    try {
      const { response, body } = await requestJson<{ ok: boolean; error?: { message: string } }>("/api/studio/password", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "修改失败，请重试");
      navigate("/studio/login", { replace: true, state: { passwordChanged: true } });
      window.dispatchEvent(new Event("studio:unauthorized"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "修改失败，请重试"); }
    finally { setBusy(false); }
  };
  return (
    <section className="studio-password-page">
      <h1>修改密码</h1>
      <p>修改后，该账号在所有设备上的登录状态都会失效。请重新登录。</p>
      <form className="studio-reply-composer studio-password-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="current-password">当前密码</label>
        <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} required maxLength={200} />
        <label htmlFor="new-password">新密码（至少 12 字符）</label>
        <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} required minLength={12} maxLength={200} />
        <label htmlFor="confirm-password">确认新密码</label>
        <input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} required minLength={12} maxLength={200} />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" loading={busy}>保存新密码</Button>
      </form>
    </section>
  );
}
