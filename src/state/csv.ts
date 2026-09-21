/** RFC 4180 style CSV reading and writing, with no dependencies. */

/** Split one line of CSV, honouring quotes and doubled quotes inside them. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function formatCsvLine(fields: readonly string[]): string {
  return fields
    .map((field) =>
      /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field,
    )
    .join(",");
}

/**
 * Split a CSV document into lines, treating newlines inside quoted fields as content.
 * Handles LF and CRLF.
 */
export function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      line += char;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      lines.push(line);
      line = "";
    } else {
      line += char;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Read a CSV document as records keyed by its header row.
 *
 * Some exports wrap every data row in a single pair of quotes, which strictly means
 * "one field containing commas". A row that collapses to one field when the header has
 * many is re-read as CSV, which recovers those files rather than rejecting them.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    let fields = parseCsvLine(line);
    if (fields.length === 1 && header.length > 1) {
      fields = parseCsvLine(fields[0]);
    }
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = fields[i] ?? "";
    });
    return record;
  });
}

export function formatCsv(
  header: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  return [
    formatCsvLine(header),
    ...rows.map((row) => formatCsvLine(header.map((name) => row[name] ?? ""))),
  ].join("\n");
}
