import {
  type EnvironmentId,
  LINEAR_ISSUE_STATUSES,
  LinearError,
  type LinearBoardStatsResult,
  UsageDay,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { BotIcon, RefreshCwIcon, TicketIcon, ZapIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

import { PROVIDER_PRESENTATION } from "../../usage/usageProviders";
import { WorkflowsSubheader } from "../../workflows/WorkflowsSubheader";
import {
  agentRows,
  compactTokens,
  localDayKey,
  localDaysBack,
  localWeekStart,
  promptDays,
  statusDeltas,
} from "./pulse.logic";

const isLinearError = Schema.is(LinearError);

/**
 * Linear changes slowly and a workspace board costs several paged requests
 * against the API key's hourly budget; agents and prompts are a cheap local read.
 */
const TICKETS_REFRESH_MS = 5 * 60_000;
const ACTIVITY_REFRESH_MS = 10_000;
const USAGE_REFRESH_MS = 60_000;
const ACTIVITY_DAYS = 14;
const MAX_MOVES_SHOWN = 6;
const MAX_AGENT_ICONS = 5;
const NO_COLOR = "var(--muted-foreground)";

function useInterval(callback: () => void, ms: number) {
  useEffect(() => {
    const interval = window.setInterval(callback, ms);
    return () => window.clearInterval(interval);
  }, [callback, ms]);
}

/**
 * Control window panel 4: how tickets, agents and prompts are moving. The
 * week starts on the local Monday; every section reads the primary
 * environment, which on desktop is this machine's own server.
 */
export function PulsePanel() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No local server.
      </div>
    );
  }
  return <Pulse environmentId={environmentId} />;
}

function Pulse({ environmentId }: { environmentId: EnvironmentId }) {
  // Re-render each minute so the week and day windows roll over at midnight.
  useNowMinute();
  const today = localDayKey(new Date());
  const { weekStart, weekStartDay, activitySince } = useMemo(() => {
    const now = new Date(`${today}T12:00:00`);
    const start = localWeekStart(now);
    return {
      weekStart: start.toISOString(),
      weekStartDay: localDayKey(start),
      activitySince: localDaysBack(now, ACTIVITY_DAYS).toISOString(),
    };
  }, [today]);
  const timeZone = useMemo(() => new Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const tickets = useEnvironmentQuery(
    linearEnvironment.boardStats({ environmentId, input: { since: weekStart } }),
  );
  const activity = useEnvironmentQuery(
    serverEnvironment.activityStats({
      environmentId,
      input: { since: activitySince, timeZone, weekStartDay },
    }),
  );
  const usage = useEnvironmentQuery(
    serverEnvironment.usageSummary({
      environmentId,
      input: {
        sinceDay: UsageDay.make(weekStartDay),
        untilDay: UsageDay.make(today),
        timeZone,
      },
    }),
  );
  useInterval(tickets.refresh, TICKETS_REFRESH_MS);
  useInterval(activity.refresh, ACTIVITY_REFRESH_MS);
  useInterval(usage.refresh, USAGE_REFRESH_MS);

  const rows = useMemo(
    () => agentRows(activity.data?.agents ?? [], usage.data?.buckets ?? [], today),
    [activity.data, usage.data, today],
  );
  const days = useMemo(
    () =>
      promptDays(activity.data?.promptsByDay ?? [], new Date(`${today}T12:00:00`), ACTIVITY_DAYS),
    [activity.data, today],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-foreground">
          Pulse
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh"
          disabled={tickets.isPending && activity.isPending}
          onClick={() => {
            tickets.refresh();
            activity.refresh();
            usage.refresh();
          }}
        >
          <RefreshCwIcon />
        </Button>
      </WorkflowsSubheader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <TicketFlow
          data={tickets.data}
          error={
            isLinearError(tickets.failure) && tickets.failure.kind === "not-configured"
              ? "Add a Linear API key in Settings → Integrations."
              : tickets.error
          }
        />
        <AgentTable
          rows={rows}
          loading={activity.data === null && activity.error === null}
          error={activity.data === null ? activity.error : null}
          tokensUnavailable={usage.data === null && usage.error !== null}
        />
        {/* Pinned to the bottom when there is spare height; flows normally when the body scrolls. */}
        <PromptActivity
          className="mt-auto"
          days={days}
          today={today}
          weekStartDay={weekStartDay}
          weekThreads={activity.data?.weekThreads ?? 0}
          error={activity.data === null ? activity.error : null}
        />
      </div>
    </div>
  );
}

const SECTION_TONES = {
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary",
} as const;

function Section(props: {
  icon: ReactNode;
  tone: keyof typeof SECTION_TONES;
  title: string;
  aside?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-2", props.className)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3",
            SECTION_TONES[props.tone],
          )}
        >
          {props.icon}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">{props.title}</h3>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p className={cn("text-xs", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}

function Dot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? NO_COLOR }}
    />
  );
}

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) return <span />;
  return (
    <span
      className={cn(
        "justify-self-end rounded-full px-1.5 text-2xs font-semibold tabular-nums",
        delta > 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      )}
    >
      {delta > 0 ? `+${delta}` : `−${-delta}`}
    </span>
  );
}

function TicketFlow(props: { data: LinearBoardStatsResult | null; error: string | null }) {
  const { data } = props;
  const deltas = useMemo(() => statusDeltas(data?.moves ?? []), [data]);
  const total = data?.statuses.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
  const max = Math.max(1, ...(data?.statuses.map((entry) => entry.count) ?? []));
  return (
    <Section
      icon={<TicketIcon />}
      tone="info"
      title="Tickets"
      aside={
        data !== null ? (
          <span className="text-2xs tabular-nums text-muted-foreground">{total} on the board</span>
        ) : null
      }
    >
      {data === null ? (
        <Note tone={props.error === null ? "muted" : "error"}>
          {props.error ?? "Reading Linear…"}
        </Note>
      ) : (
        <>
          <div className="grid grid-cols-[5.5rem_1fr_1.75rem_2.25rem] items-center gap-x-2 gap-y-1.5">
            {LINEAR_ISSUE_STATUSES.map((status) => {
              const entry = data.statuses.find((candidate) => candidate.status === status.id);
              const count = entry?.count ?? 0;
              const color = entry?.color ?? NO_COLOR;
              return (
                <div key={status.id} className="contents">
                  <span className="truncate text-xs">{status.label}</span>
                  <div
                    className="h-2 overflow-hidden rounded-full"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${(count / max) * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-right text-xs font-semibold tabular-nums">{count}</span>
                  <DeltaChip delta={deltas.get(status.id) ?? 0} />
                </div>
              );
            })}
          </div>
          {data.moves.length === 0 ? (
            <Note>No moves since Monday yet.</Note>
          ) : (
            // Two columns of pills, each only as wide as its move.
            <ul className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {data.moves.slice(0, MAX_MOVES_SHOWN).map((move) => (
                <li
                  key={`${move.from ?? ""}→${move.to}`}
                  className="inline-flex h-6 w-fit max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 text-xs"
                >
                  {move.from === null ? (
                    <span className="text-muted-foreground">New</span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Dot color={move.fromColor} />
                      <span className="truncate">{move.from}</span>
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground">→</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Dot color={move.toColor} />
                    <span className="truncate">{move.to}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">×{move.count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function AgentTable(props: {
  rows: ReturnType<typeof agentRows>;
  loading: boolean;
  error: string | null;
  tokensUnavailable: boolean;
}) {
  const running = props.rows.reduce((sum, row) => sum + row.threads + row.subagents, 0);
  const maxToday = Math.max(1, ...props.rows.map((row) => row.todayTokens));
  const maxWeek = Math.max(1, ...props.rows.map((row) => row.weekTokens));
  return (
    <Section
      icon={<BotIcon />}
      tone="warning"
      title="Agents"
      aside={
        running > 0 ? (
          <span className="rounded-full bg-warning/15 px-1.5 text-2xs font-semibold tabular-nums text-warning">
            {running} running
          </span>
        ) : null
      }
    >
      {props.error !== null ? (
        <Note tone="error">{props.error}</Note>
      ) : props.loading ? (
        <Note>Counting agents…</Note>
      ) : props.rows.length === 0 ? (
        <Note>No agents running and no tokens used this week.</Note>
      ) : (
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="text-2xs text-muted-foreground">
              <th className="pb-1 text-left font-medium">Model</th>
              <th className="w-14 pb-1 text-right font-medium">Today</th>
              <th className="w-14 pb-1 text-right font-medium">Week</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => {
              const color =
                row.provider === null ? NO_COLOR : PROVIDER_PRESENTATION[row.provider].color;
              return (
                <tr key={row.key} className="border-t border-border/50">
                  <td className="py-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Dot color={color} />
                      <span className="truncate">{row.label}</span>
                      <RunningAgents
                        threads={row.threads}
                        subagents={row.subagents}
                        color={color}
                      />
                    </span>
                  </td>
                  <TokenCell
                    tokens={row.todayTokens}
                    share={row.todayTokens / maxToday}
                    color={color}
                    unavailable={props.tokensUnavailable}
                  />
                  <TokenCell
                    tokens={row.weekTokens}
                    share={row.weekTokens / maxWeek}
                    color={color}
                    unavailable={props.tokensUnavailable}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/** One robot per running agent: threads at full strength, then dimmer subagents, capped with `+N`. */
function RunningAgents(props: { threads: number; subagents: number; color: string }) {
  const total = props.threads + props.subagents;
  if (total === 0) return null;
  const shown = Math.min(total, MAX_AGENT_ICONS);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex shrink-0 items-center gap-0.5" style={{ color: props.color }} />
        }
      >
        {Array.from({ length: shown }, (_, index) => (
          <BotIcon
            key={index}
            aria-hidden
            className={cn("size-3", index >= props.threads && "opacity-50")}
          />
        ))}
        {total > shown ? (
          <span className="text-2xs font-semibold tabular-nums">+{total - shown}</span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>
        <p>
          {plural(props.threads, "thread")} · {plural(props.subagents, "subagent")}
        </p>
      </TooltipPopup>
    </Tooltip>
  );
}

function TokenCell(props: { tokens: number; share: number; color: string; unavailable: boolean }) {
  return (
    <td className="py-1 text-right">
      <span className="flex flex-col items-end gap-0.5">
        <span className={cn("tabular-nums", props.tokens === 0 && "text-muted-foreground/60")}>
          {props.unavailable ? "—" : compactTokens(props.tokens)}
        </span>
        <span className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${props.share * 100}%`, backgroundColor: props.color }}
          />
        </span>
      </span>
    </td>
  );
}

const DAY_LETTER = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function PromptActivity(props: {
  days: ReturnType<typeof promptDays>;
  today: string;
  weekStartDay: string;
  weekThreads: number;
  error: string | null;
  className?: string;
}) {
  const todayEntry = props.days.find((entry) => entry.day === props.today);
  const weekCount = props.days
    .filter((entry) => entry.day >= props.weekStartDay)
    .reduce((sum, entry) => sum + entry.count, 0);
  const max = Math.max(1, ...props.days.map((entry) => entry.count));
  return (
    <Section icon={<ZapIcon />} tone="primary" title="Prompts" className={props.className}>
      {props.error !== null ? (
        <Note tone="error">{props.error}</Note>
      ) : (
        <div className="flex items-end gap-4">
          <div className="flex shrink-0 gap-4">
            <BigNumber
              label="Today"
              value={todayEntry?.count ?? 0}
              detail={plural(todayEntry?.threads ?? 0, "thread")}
            />
            <BigNumber
              label="This week"
              value={weekCount}
              detail={plural(props.weekThreads, "thread")}
            />
          </div>
          <div className="flex h-14 min-w-0 flex-1 items-end gap-0.5">
            {props.days.map((entry) => {
              const isToday = entry.day === props.today;
              const weekend = entry.date.getDay() === 0 || entry.date.getDay() === 6;
              return (
                <Tooltip key={entry.day}>
                  <TooltipTrigger
                    render={
                      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5" />
                    }
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className={cn(
                          "w-full rounded-sm transition-[height] duration-500",
                          isToday ? "bg-primary" : "bg-primary/40",
                          weekend && !isToday && "opacity-50",
                        )}
                        // A quiet day with any prompt still shows a sliver.
                        style={{
                          height: `${entry.count === 0 ? 0 : Math.max(8, (entry.count / max) * 100)}%`,
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        "text-4xs leading-none text-muted-foreground",
                        isToday && "font-semibold text-foreground",
                      )}
                    >
                      {DAY_LETTER.format(entry.date)}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup>
                    <p>
                      {DAY_LABEL.format(entry.date)} · {plural(entry.count, "prompt")} ·{" "}
                      {plural(entry.threads, "thread")}
                    </p>
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function BigNumber({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-bold leading-none tabular-nums">{value}</span>
      <span className="mt-1 text-2xs text-muted-foreground">
        {label} · {detail}
      </span>
    </div>
  );
}
