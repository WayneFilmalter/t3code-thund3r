import { describe, expect, it } from "vite-plus/test";

import { orderPriorityItems, parseTaskNumbers, parseTaskRequest } from "./priorityTasks.ts";

describe("parseTaskRequest", () => {
  it("reads a priority prefix and a body after a bar", () => {
    expect(parseTaskRequest("High: Fix login | Users cannot sign in on Safari")).toEqual({
      title: "Fix login",
      body: "Users cannot sign in on Safari",
      priority: "high",
    });
  });

  it("reads later lines as the body and defaults to medium", () => {
    expect(
      parseTaskRequest("Write the release notes\nCover the Slack commands\nand tasks"),
    ).toEqual({
      title: "Write the release notes",
      body: "Cover the Slack commands\nand tasks",
      priority: "medium",
    });
  });

  it("keeps a leading priority word without a colon in the title", () => {
    expect(parseTaskRequest("High CPU on the build box")).toEqual({
      title: "High CPU on the build box",
      body: "",
      priority: "medium",
    });
  });

  it("needs a title", () => {
    expect(parseTaskRequest("   ")).toBeNull();
    expect(parseTaskRequest("urgent: | only a body")).toBeNull();
  });
});

describe("parseTaskNumbers", () => {
  it("reads labels, hashes and bare numbers once each", () => {
    expect(parseTaskNumbers("T-12, t-13 #14 15 and T-12 again")).toEqual([12, 13, 14, 15]);
  });

  it("ignores ticket identifiers", () => {
    expect(parseTaskNumbers("ENG-482")).toEqual([]);
  });
});

describe("orderPriorityItems", () => {
  it("mixes tickets and tasks by priority, the earlier one first on a tie", () => {
    const tickets = [
      { identifier: "ENG-1", addedAt: "2026-10-26T10:00:00.000Z" },
      { identifier: "ENG-2", addedAt: "2026-10-26T12:00:00.000Z" },
      { identifier: "ENG-3", addedAt: "2026-10-26T09:00:00.000Z" },
    ];
    const tasks = [
      { id: "low", priority: "low" as const, createdAt: "2026-10-26T08:00:00.000Z" },
      { id: "high", priority: "high" as const, createdAt: "2026-10-26T11:00:00.000Z" },
    ];
    const known = new Map([
      ["ENG-1", { priority: "high" as const }],
      ["ENG-2", { priority: "urgent" as const }],
    ]);

    expect(
      orderPriorityItems(tickets, tasks, known).map((item) =>
        item.kind === "ticket" ? item.entry.identifier : item.task.id,
      ),
    ).toEqual(["ENG-2", "ENG-1", "high", "low", "ENG-3"]);
  });
});
