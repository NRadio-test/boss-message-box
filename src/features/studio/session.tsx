import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StudioAdmin, StudioMode } from "../../shared/studio-contracts";
import {
  getStudioSession,
  loginStudio,
  logoutStudio,
  StudioApiError,
  updateStudioMode,
} from "./api";
import { StudioSessionContext, type StudioSessionValue } from "./session-context";

export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudioSessionValue["status"]>("loading");
  const [admin, setAdmin] = useState<StudioAdmin | null>(null);
  const [mode, setModeState] = useState<StudioMode>("normal");

  useEffect(() => {
    const controller = new AbortController();
    getStudioSession(controller.signal)
      .then((session) => {
        setAdmin(session.admin);
        setModeState(session.mode);
        setStatus("authenticated");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof StudioApiError && error.status === 401) {
          setAdmin(null);
          setModeState("normal");
          setStatus("anonymous");
          return;
        }
        setAdmin(null);
        setStatus("anonymous");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const clear = () => {
      setAdmin(null);
      setModeState("normal");
      setStatus("anonymous");
    };
    window.addEventListener("studio:unauthorized", clear);
    return () => window.removeEventListener("studio:unauthorized", clear);
  }, []);

  const value = useMemo<StudioSessionValue>(
    () => ({
      status,
      admin,
      mode,
      login: async (username, password) => {
        const session = await loginStudio({ username, password });
        setAdmin(session.admin);
        setModeState(session.mode);
        setStatus("authenticated");
      },
      logout: async () => {
        await logoutStudio();
        setAdmin(null);
        setModeState("normal");
        setStatus("anonymous");
      },
      setMode: async (nextMode) => {
        const session = await updateStudioMode(nextMode);
        setAdmin(session.admin);
        setModeState(session.mode);
        setStatus("authenticated");
      },
    }),
    [admin, mode, status],
  );

  return <StudioSessionContext.Provider value={value}>{children}</StudioSessionContext.Provider>;
}
