import { createContext } from "react";
import type { StudioAdmin, StudioMode } from "../../shared/studio-contracts";

export interface StudioSessionValue {
  status: "loading" | "authenticated" | "anonymous";
  admin: StudioAdmin | null;
  mode: StudioMode;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setMode: (mode: StudioMode) => Promise<void>;
}

export const StudioSessionContext = createContext<StudioSessionValue | null>(null);
