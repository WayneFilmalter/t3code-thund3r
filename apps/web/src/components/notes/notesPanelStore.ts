import type { NoteId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

/**
 * Where the Notes tab is and what is being typed, per environment. Session-only
 * and outside React on purpose: the right panel unmounts a tab's component when
 * another tab shows, and half-written meeting notes must survive that.
 *
 * Which category groups are folded is the one piece that persists: a user who
 * tucks away "Done" wants it tucked away after a reload too.
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
  /** Collapsed group keys (category ids or the uncategorised key) per environment. */
  collapsedGroups: Record<string, ReadonlyArray<string>>;
  setMode: (environmentId: string, mode: NotesPanelMode) => void;
  setDraft: (environmentId: string, draft: NoteDraft | null) => void;
  toggleGroupCollapsed: (environmentId: string, groupKey: string) => void;
}

const EMPTY_STATE: NotesPanelEnvironmentState = { mode: { kind: "list" }, draft: null };
const NO_GROUPS: ReadonlyArray<string> = [];

export const useNotesPanelStore = create<NotesPanelStoreState>()(
  persist(
    (set) => ({
      byEnvironment: {},
      collapsedGroups: {},
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
      toggleGroupCollapsed: (environmentId, groupKey) =>
        set((state) => {
          const current = state.collapsedGroups[environmentId] ?? NO_GROUPS;
          const next = current.includes(groupKey)
            ? current.filter((key) => key !== groupKey)
            : [...current, groupKey];
          return { collapsedGroups: { ...state.collapsedGroups, [environmentId]: next } };
        }),
    }),
    {
      name: "t3code:notes:collapsed-groups:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ collapsedGroups: state.collapsedGroups }),
    },
  ),
);

export function selectNotesPanelState(
  byEnvironment: Record<string, NotesPanelEnvironmentState>,
  environmentId: string | null,
): NotesPanelEnvironmentState {
  if (environmentId === null) return EMPTY_STATE;
  return byEnvironment[environmentId] ?? EMPTY_STATE;
}

export function selectCollapsedGroups(
  collapsedGroups: Record<string, ReadonlyArray<string>>,
  environmentId: string | null,
): ReadonlyArray<string> {
  if (environmentId === null) return NO_GROUPS;
  return collapsedGroups[environmentId] ?? NO_GROUPS;
}
