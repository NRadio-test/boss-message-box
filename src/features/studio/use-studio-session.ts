import { useContext } from "react";
import { StudioSessionContext, type StudioSessionValue } from "./session-context";

export function useStudioSession(): StudioSessionValue {
  const value = useContext(StudioSessionContext);
  if (!value) throw new Error("StudioSessionProvider is missing");
  return value;
}
