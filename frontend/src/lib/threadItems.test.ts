import { describe, expect, it } from "vitest";

import { toApiMessages, type ThreadItem } from "./threadItems";

describe("toApiMessages", () => {
  it("maps user_text and tabby_text to chat roles in order", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "compare my places" },
      { kind: "tabby_text", text: "Here's the side-by-side." },
      { kind: "user_text", text: "evenings only" },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "compare my places" },
      { role: "assistant", content: "Here's the side-by-side." },
      { role: "user", content: "evenings only" },
    ]);
  });

  it("skips receipts and notices", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "hi" },
      { kind: "receipt", text: "Search radius → 500 m" },
      { kind: "notice", text: "Tabby can't reach the case files right now." },
      { kind: "tabby_text", text: "Hello." },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
    ]);
  });

  it("returns an empty array for an empty thread", () => {
    expect(toApiMessages([])).toEqual([]);
  });
});
