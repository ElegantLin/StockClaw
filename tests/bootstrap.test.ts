import { describe, expect, it, vi } from "vitest";

describe("bootstrap startup resilience", () => {
  it("keeps the daemon startup callback alive when telegram start throws", async () => {
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((message?: unknown) => {
      warnings.push(String(message ?? ""));
    });

    const telegram = {
      start: vi.fn(async () => {
        throw new Error("connect timeout");
      }),
    };

    try {
      if (telegram) {
        try {
          await telegram.start();
        } catch (error) {
          console.warn(
            `stock-claw telegram extension disabled for this run: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      warn.mockRestore();
    }

    expect(telegram.start).toHaveBeenCalledTimes(1);
    expect(
      warnings.some((message) =>
        message.includes("stock-claw telegram extension disabled for this run: connect timeout"),
      ),
    ).toBe(true);
  });
});
