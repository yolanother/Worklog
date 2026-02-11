/**
 * Lightweight keyboard chord handler for TUI.
 *
 * API:
 * - new ChordHandler({ timeoutMs })
 * - register(sequence: string[], handler: () => void)
 * - feed(key: KeyInfo): boolean  // returns true if the event was consumed by the chord system
 * - reset(): void
 */

export type KeyInfo = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean };

type Handler = () => void;

function normalizeKey(k: KeyInfo | string): string {
  if (typeof k === 'string') return k;
  const name = k.name || '';
  const parts: string[] = [];
  if (k.ctrl) parts.push('C');
  if (k.meta) parts.push('M');
  if (k.shift) parts.push('S');
  parts.push(name);
  return parts.join('-');
}

export class ChordHandler {
  private readonly timeoutMs: number;
  private readonly trie: Map<string, any> = new Map();
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingHandler: Handler | null = null;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? 1000;
  }

  // Register a sequence of normalized keys (array of KeyInfo or strings)
  register(seq: Array<KeyInfo | string>, handler: Handler): void {
    const keys = seq.map(normalizeKey);
    let node: Map<string, any> = this.trie;
    for (const k of keys) {
      if (!node.has(k)) node.set(k, new Map());
      node = node.get(k) as Map<string, any>;
    }
    // store handler under a special key
    (node as any).__handler = handler;
  }

  reset(): void {
    this.pending = [];
    if (this.timer) {
      clearTimeout(this.timer as any);
      this.timer = null;
    }
  }

  private scheduleClear(): void {
    if (this.timer) clearTimeout(this.timer as any);
    this.timer = setTimeout(() => {
      if (this.pendingHandler) {
        try { this.pendingHandler(); } catch (_) {}
        this.pendingHandler = null;
      }
      this.pending = [];
      this.timer = null;
    }, this.timeoutMs) as any;
  }

  // Feed a key event. Returns true if the chord-system consumed the event
  feed(key: KeyInfo | string): boolean {
    const k = normalizeKey(key);
    // if there is an in-flight pending short-handler timer, cancel it
    if (this.timer) {
      clearTimeout(this.timer as any);
      this.timer = null;
      this.pendingHandler = null;
    }

    const nextPending = [...this.pending, k];

    // Walk trie to see if any sequence starts with nextPending
    let node: Map<string, any> = this.trie;
    let matched = true;
    for (const p of nextPending) {
      if (!node.has(p)) { matched = false; break; }
      node = node.get(p) as Map<string, any>;
    }

    if (!matched) {
      // No prefix matches — reset pending and return false (not consumed)
      this.reset();
      return false;
    }

    // At least a prefix matches. If a handler is present on this node, it's a full match.
    this.pending = nextPending;
    // If this node has a handler and also has children, defer invocation to allow longer matches
    const hasHandler = typeof (node as any).__handler === 'function';
    const childCount = Array.from(node.keys()).filter(k => k !== '__handler').length;
    if (hasHandler) {
      if (childCount > 0) {
        this.pendingHandler = (node as any).__handler as Handler;
        this.scheduleClear();
        return true;
      }
      // no children: invoke immediately
      try { (node as any).__handler(); } catch (_) {}
      this.reset();
      return true;
    }

    // Partial match — consume event so caller can avoid treating it as ordinary keypress
    return true;
  }
}

export default ChordHandler;
