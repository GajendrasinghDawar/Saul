export const ACTIONS = [
  "read_todos",
  "send_digest_email",
  "clear_todos",
  "complete",
  "wait",
  "save_todo",
  "reply_to_user",
] as const;

export type ActionName = (typeof ACTIONS)[number];
