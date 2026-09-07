import { api } from "../../api";
import type { DesignSuiteChangeEvent } from "./types";

type SuiteChangeApi = {
  onDesignSuiteChanged?: (callback: (event: DesignSuiteChangeEvent) => void) => () => void;
};

export const suiteApi = api;

export function subscribeToSuiteChanges(callback: (event: DesignSuiteChangeEvent | null) => void): () => void {
  const candidate = api as typeof api & SuiteChangeApi;
  if (candidate.onDesignSuiteChanged) return candidate.onDesignSuiteChanged(callback);
  return api.onDesignChanged(() => callback(null));
}
