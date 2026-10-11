import crypto from 'crypto';

interface TicketEntry {
  uid: string;
  expiresAt: number;
}

// In-memory short-lived session tickets
const activeTickets = new Map<string, TicketEntry>();
const TICKET_TTL_MS = 60_000; // 60 seconds

/**
 * Creates a cryptographically secure, short-lived session ticket for terminal WebSocket access
 */
export function createTerminalTicket(uid: string): string {
  const ticket = `term_${crypto.randomBytes(24).toString('hex')}`;
  activeTickets.set(ticket, {
    uid,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

/**
 * Validates and atomically consumes a session ticket (one-time use)
 */
export function validateAndConsumeTicket(ticket: string): boolean {
  if (!ticket) return false;
  const entry = activeTickets.get(ticket);
  if (!entry) return false;

  activeTickets.delete(ticket);

  if (entry.expiresAt < Date.now()) {
    return false;
  }

  return true;
}
