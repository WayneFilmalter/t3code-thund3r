import type { NoteId } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Where the Notes tab is and what is being typed, per environment. Session-only
 * and outside React on purpose: the right panel unmounts a tab's component when
 * another tab shows, and half-written meeting notes must survive that.
 */
export type NotesPanelMode =
  | { kind: "list" }
  | { kind: "view"; noteId: NoteId }
  | { kind: "edit"; noteId: NoteId | null }
  | { kind: "agent"; noteId: NoteId | null };

export interface NoteDraft {
  noteId: NoteId | null;
  title: string;
  body: string;
}

interface NotesPanelEnvironmentState {
  mode: NotesPanelMode;
  draft: NoteDraft | null;
}

interface NotesPanelStoreState {
  byEnvironment: Record<string, NotesPanelEnvironmentState>;
  setMode: (environmentId: string, mode: NotesPanelMode) => void;
  setDraft: (environmentId: string, draft: NoteDraft | null) => void;
}

const EMPTY_STATE: NotesPanelEnvironmentState = { mode: { kind: "list" }, draft: null };

export const useNotesPanelStore = create<NotesPanelStoreState>()((set) => ({
  byEnvironment: {},
  setMode: (environmentId, mode) =>
    set((state) => ({
      byEnvironment: {
        ...state.byEnvironment,
        [environmentId]: { ...(state.byEnvironment[environmentId] ?? EMPTY_STATE), mode },
      },
    })),
  setDraft: (environmentId, draft) =>
    set((state) => ({
      byEnvironment: {
        ...state.byEnvironment,
        [environmentId]: { ...(state.byEnvironment[environmentId] ?? EMPTY_STATE), draft },
      },
    })),
}));

export function selectNotesPanelState(
  byEnvironment: Record<string, NotesPanelEnvironmentState>,
  environmentId: string | null,
): NotesPanelEnvironmentState {
  if (environmentId === null) return EMPTY_STATE;
  return byEnvironment[environmentId] ?? EMPTY_STATE;
}
