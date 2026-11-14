/**
 * Incremental parser for the line-based record format the research prompts ask for:
 *
 *   FINDING
 *   TITLE: Short title
 *   SUMMARY: One or two sentences.
 *   STATUS: verified
 *
 * Text is pushed in arbitrary chunks (token deltas). Values of streamed fields
 * are forwarded character-by-character as they arrive, so a node can render
 * provisional text before the record is complete; every completed record is
 * returned for schema validation.
 */
export type ParsedRecord = { kind: string; index: number; fields: Record<string, string> };

export function createRecordStream({
  kinds,
  streamedFields,
  onRecordStart,
  onFieldDelta,
  onRecordEnd,
}: {
  kinds: string[];
  streamedFields: string[];
  onRecordStart: (record: ParsedRecord) => void;
  onFieldDelta: (record: ParsedRecord, field: string, delta: string) => void;
  onRecordEnd: (record: ParsedRecord) => void;
}) {
  const records: ParsedRecord[] = [];
  let current: ParsedRecord | null = null;
  let line = ""; // unparsed start of the current line
  let field: string | null = null; // field whose value is currently streaming
  let streamingLine = false;

  // Deltas are batched per field and flushed once per pushed chunk, so one
  // model token becomes one update rather than one per character.
  let pending = "";
  let pendingTarget: [ParsedRecord, string] | null = null;
  const flush = () => {
    if (pendingTarget && pending) onFieldDelta(pendingTarget[0], pendingTarget[1], pending);
    pending = "";
    pendingTarget = null;
  };

  const close = () => {
    flush();
    if (current) onRecordEnd(current);
    current = null;
  };

  const append = (delta: string) => {
    if (!current || !field || !delta) return;
    current.fields[field] = (current.fields[field] ?? "") + delta;
    if (!streamedFields.includes(field)) return;
    if (pendingTarget && (pendingTarget[0] !== current || pendingTarget[1] !== field)) flush();
    pendingTarget = [current, field];
    pending += delta;
  };

  /** Called once the start of a line is long enough to classify it. */
  const classify = (text: string, complete: boolean): boolean => {
    const trimmed = text.trim();
    const header = kinds.find((k) => trimmed === k);
    if (header && complete) {
      close();
      current = { kind: header, index: records.length, fields: {} };
      records.push(current);
      onRecordStart(current);
      field = null;
      return true;
    }
    const match = /^([A-Z_]+):\s?/.exec(text);
    if (match && current) {
      field = match[1];
      current.fields[field] = "";
      streamingLine = true;
      append(text.slice(match[0].length));
      return true;
    }
    if (complete) {
      // Continuation of a multi-line value, or chatter outside a record.
      if (field && trimmed) append(` ${trimmed}`);
      return true;
    }
    return false;
  };

  return {
    push(chunk: string) {
      for (const ch of chunk) {
        if (ch === "\n") {
          if (!streamingLine) classify(line, true);
          line = "";
          streamingLine = false;
          continue;
        }
        if (streamingLine) {
          append(ch);
          continue;
        }
        line += ch;
        // A "KEY: " prefix is enough to start streaming the value.
        if (/^[A-Z_]+:\s$/.test(line) || (/^[A-Z_]+:\S/.test(line) && line.length > 2)) classify(line, false);
      }
      flush();
    },
    end(): ParsedRecord[] {
      if (line && !streamingLine) classify(line, true);
      close();
      return records;
    },
  };
}
