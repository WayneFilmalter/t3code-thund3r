import type { NoteCategory, NoteCategoryColor } from "@t3tools/contracts";
import { useId, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import { NoteCategoryColorSwatches } from "./NoteCategoryMenu";

export type NoteCategoryDialogRequest =
  | { kind: "create"; name: string }
  | { kind: "edit"; category: NoteCategory };

/** Name and colour for a new category, or for one being renamed or recoloured. */
export function NoteCategoryDialog(props: {
  request: NoteCategoryDialogRequest;
  saving: boolean;
  onSubmit: (input: { name: string; color: NoteCategoryColor }) => void;
  onClose: () => void;
}) {
  const { request } = props;
  const [name, setName] = useState(
    request.kind === "create" ? request.name : request.category.name,
  );
  const [color, setColor] = useState<NoteCategoryColor>(
    request.kind === "create" ? "blue" : request.category.color,
  );
  const formId = useId();
  const canSubmit = name.trim().length > 0 && !props.saving;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{request.kind === "create" ? "New category" : "Edit category"}</DialogTitle>
          <DialogDescription>
            Notes in a category sit together in the list and take its colour.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) props.onSubmit({ name: name.trim(), color });
            }}
          >
            <Input
              autoFocus
              aria-label="Category name"
              placeholder="Name"
              value={name}
              maxLength={60}
              disabled={props.saving}
              onChange={(event) => setName(event.target.value)}
            />
            <NoteCategoryColorSwatches value={color} disabled={props.saving} onChange={setColor} />
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" disabled={!canSubmit}>
            {props.saving ? "Saving…" : request.kind === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
