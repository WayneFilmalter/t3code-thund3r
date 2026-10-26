import type { EnvironmentId, LinearTicket, LinearTicketsGetResult } from "@t3tools/contracts";
import { parsePriorityPaste } from "@t3tools/shared/linearPriorities";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { TicketStateChip } from "./TicketParts";
import { usePriorityList } from "./prioritiesStore";

const SEARCH_DEBOUNCE_MS = 250;
/** The server reads at most this many identifiers per request. */
const MAX_PASTED_TICKETS = 100;

/** A bare `482` or `#482` searches for the team's ticket rather than the text. */
function searchTerm(query: string, teamKey: string): string {
  const trimmed = query.trim();
  const number = /^#?(\d{1,7})$/.exec(trimmed)?.[1];
  return number !== undefined && teamKey.length > 0 ? `${teamKey}-${Number(number)}` : trimmed;
}

/**
 * The Control tab's Priorities block: look up one ticket, or paste a message
 * listing several and confirm what it found. Both add to the list Panel 1 shows.
 */
export function PrioritiesAdder({ environmentId }: { environmentId: EnvironmentId }) {
  const teamKey = useEnvironmentSettings(environmentId, (settings) =>
    settings.linear.teamKey.trim().toUpperCase(),
  );
  const keySaved = useEnvironmentSettings(
    environmentId,
    (settings) => settings.linear.apiKey.length > 0,
  );
  const list = usePriorityList(environmentId);
  const listed = useMemo(
    () => new Set(list.entries.map((entry) => entry.identifier)),
    [list.entries],
  );

  if (!keySaved) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a Linear API key in Settings → Integrations to build a priority list.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {list.entries.length === 0
          ? "Nothing on the list yet."
          : `${list.entries.length} ticket${list.entries.length === 1 ? "" : "s"} on the list.`}
      </p>
      <TicketLookup
        environmentId={environmentId}
        teamKey={teamKey}
        listed={listed}
        onAdd={(ticket) => list.add([ticket])}
      />
      <PasteImport
        environmentId={environmentId}
        teamKey={teamKey}
        listed={listed}
        onAdd={list.add}
      />
    </div>
  );
}

function TicketLookup(props: {
  environmentId: EnvironmentId;
  teamKey: string;
  listed: ReadonlySet<string>;
  onAdd: (ticket: LinearTicket) => void;
}) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setTerm(searchTerm(query, props.teamKey)),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [props.teamKey, query]);

  const search = useEnvironmentQuery(
    term.length < 2
      ? null
      : linearEnvironment.ticketSearch({
          environmentId: props.environmentId,
          input: { query: term },
        }),
  );
  const tickets = search.data?.tickets ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        size="sm"
        type="search"
        placeholder={
          props.teamKey ? `Find a ticket: ${props.teamKey}-482, 482, or words` : "Find a ticket"
        }
        aria-label="Find a Linear ticket"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {term.length >= 2 ? (
        search.error !== null ? (
          <p className="text-xs text-destructive">{search.error}</p>
        ) : search.data === null ? (
          <p className="text-xs text-muted-foreground">Searching Linear…</p>
        ) : tickets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tickets match.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 rounded-md border border-border/70">
            {tickets.map((ticket) => {
              const added = props.listed.has(ticket.identifier);
              return (
                <li key={ticket.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-medium text-foreground">
                      {ticket.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                      {ticket.identifier}
                      <TicketStateChip ticket={ticket} />
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant={added ? "ghost-muted" : "outline"}
                    disabled={added}
                    onClick={() => props.onAdd(ticket)}
                  >
                    {added ? <CheckIcon /> : <PlusIcon />}
                    {added ? "Added" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

function PasteImport(props: {
  environmentId: EnvironmentId;
  teamKey: string;
  listed: ReadonlySet<string>;
  onAdd: (tickets: ReadonlyArray<LinearTicket>) => void;
}) {
  const resolveTickets = useAtomCommand(linearEnvironment.resolveTickets);
  const [text, setText] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<LinearTicketsGetResult | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());

  const find = async () => {
    const identifiers = parsePriorityPaste(text, props.teamKey).slice(0, MAX_PASTED_TICKETS);
    if (identifiers.length === 0) {
      toastManager.add({
        type: "warning",
        title: "No tickets found in that text",
        description: props.teamKey
          ? undefined
          : "Bare numbers need a team key in Settings → Integrations.",
      });
      return;
    }
    setFinding(true);
    try {
      const result = await resolveTickets({
        environmentId: props.environmentId,
        input: { identifiers: [...identifiers] },
      });
      if (result._tag === "Success") {
        setUnchecked(new Set());
        setFound(result.value);
      }
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        size="sm"
        rows={4}
        placeholder="Paste a message listing tickets, like this week's priorities…"
        aria-label="Message listing tickets"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="compact"
          variant="outline"
          disabled={finding || text.trim().length === 0}
          onClick={() => void find()}
        >
          {finding ? "Finding tickets…" : "Find tickets"}
        </Button>
      </div>
      <ConfirmImportDialog
        found={found}
        listed={props.listed}
        unchecked={unchecked}
        onToggle={(identifier, checked) =>
          setUnchecked((current) => {
            const next = new Set(current);
            if (checked) next.delete(identifier);
            else next.add(identifier);
            return next;
          })
        }
        onClose={() => setFound(null)}
        onConfirm={(tickets) => {
          props.onAdd(tickets);
          setFound(null);
          setText("");
          toastManager.add({
            type: "success",
            title: `Added ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} to priorities`,
          });
        }}
      />
    </div>
  );
}

function ConfirmImportDialog(props: {
  found: LinearTicketsGetResult | null;
  listed: ReadonlySet<string>;
  unchecked: ReadonlySet<string>;
  onToggle: (identifier: string, checked: boolean) => void;
  onClose: () => void;
  onConfirm: (tickets: ReadonlyArray<LinearTicket>) => void;
}) {
  const { unchecked } = props;
  const fresh = useMemo(
    () => props.found?.tickets.filter((ticket) => !props.listed.has(ticket.identifier)) ?? [],
    [props.found, props.listed],
  );
  const alreadyListed =
    props.found?.tickets.filter((ticket) => props.listed.has(ticket.identifier)) ?? [];
  const missing = props.found?.missing ?? [];
  const selected = fresh.filter((ticket) => !unchecked.has(ticket.identifier));

  return (
    <Dialog
      open={props.found !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to priorities</DialogTitle>
          <DialogDescription>
            {fresh.length > 0
              ? "The following tickets will be added to the priority list."
              : "Every ticket found is already on the priority list."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="flex flex-col gap-1">
            {fresh.map((ticket) => (
              <li key={ticket.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-accent/50">
                  <Checkbox
                    checked={!unchecked.has(ticket.identifier)}
                    onCheckedChange={(checked) => props.onToggle(ticket.identifier, checked)}
                  />
                  <span className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {ticket.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>
                  <TicketStateChip ticket={ticket} />
                </label>
              </li>
            ))}
            {alreadyListed.map((ticket) => (
              <li
                key={ticket.id}
                className="flex items-center gap-2.5 px-1.5 py-1 text-muted-foreground/70"
              >
                <CheckIcon className="size-4 shrink-0" />
                <span className="w-16 shrink-0 text-xs tabular-nums">{ticket.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>
                <span className="shrink-0 text-2xs">Already on the list</span>
              </li>
            ))}
            {missing.map((identifier) => (
              <li
                key={identifier}
                className="flex items-center gap-2.5 px-1.5 py-1 text-muted-foreground/70"
              >
                <span className="size-4 shrink-0" />
                <span className="w-16 shrink-0 text-xs tabular-nums line-through">
                  {identifier}
                </span>
                <span className="text-2xs">Not found in Linear</span>
              </li>
            ))}
          </ul>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={selected.length === 0} onClick={() => props.onConfirm(selected)}>
            Add {selected.length} ticket{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
