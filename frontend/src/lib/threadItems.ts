import type { AssistantMessage } from "../types";

/** One entry in the Tabby rail. Only user/tabby text round-trips to the LLM;
 * receipts and notices are local-only records (deterministic confirmations,
 * errors) per the Tabby-central spec. */
export type ThreadItem =
  | { kind: "user_text"; text: string }
  | { kind: "tabby_text"; text: string }
  | { kind: "receipt"; text: string }
  | { kind: "notice"; text: string };

export function toApiMessages(items: ThreadItem[]): AssistantMessage[] {
  const messages: AssistantMessage[] = [];
  for (const item of items) {
    if (item.kind === "user_text") messages.push({ role: "user", content: item.text });
    else if (item.kind === "tabby_text") messages.push({ role: "assistant", content: item.text });
  }
  return messages;
}
