export interface ConversationTextMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface CompactedConversationContext {
  recentMessages: ConversationTextMessage[];
  earlierContext: string;
}

const RECENT_MESSAGE_COUNT = 8;
const EARLIER_MESSAGE_COUNT = 8;
const EARLIER_CONTEXT_LIMIT = 1_600;

function compactOlderText(text: string, limit: number): string {
  const compacted = text
    .replace(/<tutorial>[\s\S]*?<\/tutorial>/gi, '[structured circuit update]')
    .replace(/<implementation_plan>[\s\S]*?<\/implementation_plan>/gi, '[structured project plan]')
    .replace(/<pcb_design>[\s\S]*?<\/pcb_design>/gi, '[structured PCB update]')
    .replace(/<cmd>[\s\S]*?<\/cmd>/gi, '[command output]')
    .replace(/```[\s\S]*?```/g, '[code omitted from older chat context]')
    .replace(/\s+/g, ' ')
    .trim();

  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function limitRecentText(text: string, limit: number): string {
  const value = text.trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

/** Keep a small, useful conversational window and summarize older turns locally. */
export function compactConversationContext(messages: ConversationTextMessage[]): CompactedConversationContext {
  const splitIndex = Math.max(0, messages.length - RECENT_MESSAGE_COUNT);
  const olderMessages = messages.slice(0, splitIndex).slice(-EARLIER_MESSAGE_COUNT);
  const recentSource = messages.slice(splitIndex);
  const recentMessages = recentSource.map((message, index) => ({
    ...message,
    text: limitRecentText(message.text, index === recentSource.length - 1 ? 4_000 : message.role === 'user' ? 2_000 : 1_000),
  }));

  let earlierContext = olderMessages
    .map(message => {
      const text = compactOlderText(message.text, message.role === 'user' ? 220 : 150);
      return text ? `${message.role === 'user' ? 'User' : 'Assistant'}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  if (earlierContext.length > EARLIER_CONTEXT_LIMIT) {
    earlierContext = `${earlierContext.slice(0, EARLIER_CONTEXT_LIMIT - 1).trimEnd()}…`;
  }

  return { recentMessages, earlierContext };
}

export function messageReferencesPriorImage(text: string): boolean {
  return /\b(?:image|photo|picture|screenshot|diagram|attachment|attached|upload(?:ed)?|visual|shown|ss)\b|\b(?:look at|see in|as shown)\b|\b(?:iska|iski|isme|issme|tasveer|chitra)\b|\b(?:ye|yeh|iss)\s+(?:image|photo|picture|screenshot|diagram|tasveer)\b/i.test(text);
}
