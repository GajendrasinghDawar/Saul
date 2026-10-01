import type { ActionName } from './types.ts';

export const actionPolicy: Record<ActionName, 'read' | 'write' | 'approval' | 'terminal' | 'wait'> = {
  read_todos: 'read',
  send_digest_email: 'approval', // Requires human approval before sending
  clear_todos: 'approval',       // Requires human approval before deleting
  complete: 'terminal',
  wait: 'wait',
  save_todo: 'write',            // Auto-executes without approval
  reply_to_user: 'write',        // Auto-executes without approval
};
