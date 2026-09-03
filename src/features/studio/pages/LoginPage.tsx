import { LockKey, SignIn, User } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../../components/Button";
import { studioLoginSchema } from "../../../shared/studio-contracts";
import { StudioApiError } from "../api";
import { useStudioSession } from "../session";

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const { status, login } = useStudioSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === "authenticated") return <Navigate to="/studio/unreplied" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = studioLoginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    setMessage(null);
    setLoading(true);
    try {
      await login(parsed.data.username, parsed.data.password);
      const requested = (location.state as LoginLocationState | null)?.from;
      navigate(requested?.startsWith("/studio/") ? requested : "/studio/unreplied", { replace: true });
    } catch (error) {
      if (error instanceof StudioApiError) {
        setErrors(error.fieldErrors ?? {});
        setMessage(
          error.status === 429 && error.retryAfterSeconds
            ? `${error.message}，请在 ${error.retryAfterSeconds} 秒后重试`
            : error.message,
        );
      } else {
        setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="studio-login-page">
      <section className="studio-login-panel" aria-labelledby="studio-login-title">
        <div className="studio-login-brand">
          <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
          <span>老板留言箱</span>
        </div>
        <span className="studio-kicker">内部工作台</span>
        <h1 id="studio-login-title">登录 Studio</h1>
        <p>查看留言、管理待办并完成直播或留言回复。</p>
        <form noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor="studio-username">账号</label>
          <div className="studio-login-control">
            <User aria-hidden="true" />
            <input
              id="studio-username"
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? "studio-username-error" : undefined}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          {errors.username && <span id="studio-username-error" className="studio-field-error" role="alert">{errors.username}</span>}

          <label htmlFor="studio-password">密码</label>
          <div className="studio-login-control">
            <LockKey aria-hidden="true" />
            <input
              id="studio-password"
              type="password"
              value={password}
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "studio-password-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {errors.password && <span id="studio-password-error" className="studio-field-error" role="alert">{errors.password}</span>}
          {message && <p className="studio-login-error" role="alert">{message}</p>}
          <Button type="submit" loading={loading} loadingLabel="正在登录" icon={<SignIn aria-hidden="true" weight="bold" />}>
            登录
          </Button>
        </form>
      </section>
    </main>
  );
}
