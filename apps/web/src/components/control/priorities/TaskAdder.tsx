import { type EnvironmentId, PriorityTaskPriority } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

import { PRIORITY_LABELS } from "../../linear/linearPanel.logic";
import { usePriorityTasks } from "./prioritiesStore";

/**
 * The Control tab's Tasks block: a title, an optional description and a
 * priority. Tasks join the tickets in Panel 1 and need no Linear key.
 */
export function TaskAdder({ environmentId }: { environmentId: EnvironmentId }) {
  const { tasks, add } = usePriorityTasks(environmentId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<PriorityTaskPriority>("medium");
  const [adding, setAdding] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || adding) return;
    setAdding(true);
    try {
      const result = await add({ title: trimmed, body: body.trim(), priority });
      if (result._tag === "Success") {
        setTitle("");
        setBody("");
        setPriority("medium");
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {tasks.length === 0
          ? "No tasks on the list."
          : `${tasks.length} task${tasks.length === 1 ? "" : "s"} on the list.`}
      </p>
      <Input
        size="sm"
        placeholder="Task title"
        aria-label="Task title"
        value={title}
        disabled={adding}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Textarea
        size="sm"
        rows={2}
        placeholder="Description (optional)"
        aria-label="Task description"
        value={body}
        disabled={adding}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        <Select
          value={priority}
          onValueChange={(value) => {
            const next = PriorityTaskPriority.literals.find((literal) => literal === value);
            if (next !== undefined) setPriority(next);
          }}
        >
          <SelectTrigger size="sm" className="w-28" aria-label="Task priority">
            <SelectValue>{(value: PriorityTaskPriority) => PRIORITY_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {PriorityTaskPriority.literals.map((literal) => (
              <SelectItem key={literal} value={literal}>
                {PRIORITY_LABELS[literal]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          type="button"
          size="compact"
          variant="outline"
          disabled={adding || title.trim().length === 0}
          onClick={() => void submit()}
        >
          <PlusIcon />
          Add task
        </Button>
      </div>
    </div>
  );
}
