import { describe, expect, it } from "vitest";
import { formatCsv, parseCsv, parseCsvLine, splitCsvLines } from "./csv";

describe("parseCsvLine", () => {
  it("handles quotes, commas and escaped quotes", () => {
    expect(parseCsvLine('a,b,c')).toEqual(["a", "b", "c"]);
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(parseCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
    expect(parseCsvLine("a,,b")).toEqual(["a", "", "b"]);
  });
});

describe("splitCsvLines", () => {
  it("splits on LF, CRLF and lone CR, but not inside quotes", () => {
    expect(splitCsvLines("a,b\nc,d\r\ne,f\rg")).toEqual(["a,b", "c,d", "e,f", "g"]);
    expect(splitCsvLines('a,"x\r\ny",b\n"say ""hi"", ok",c\n')).toEqual(['a,"x\r\ny",b', '"say ""hi"", ok",c']);
    expect(splitCsvLines("a\n\nb\r\n")).toEqual(["a", "", "b"]);
    expect(splitCsvLines("")).toEqual([]);
  });

  it("keeps whole-row-wrapped lines intact", () => {
    expect(splitCsvLines('x,y\n"1,""a\nb"",3"\n"4,5"')).toEqual(["x,y", '"1,""a\nb"",3"', '"4,5"']);
  });
});

describe("parseCsv", () => {
  it("keys rows by the header", () => {
    const rows = parseCsv("x,y\n1,2\n3,4");
    expect(rows).toEqual([
      { x: "1", y: "2" },
      { x: "3", y: "4" },
    ]);
  });

  it("recovers rows that were wrapped in a single pair of quotes", () => {
    // An export that quotes the whole line: one field that is really several.
    const rows = parseCsv('x,y,z\n"1,""a,b"",3"');
    expect(rows).toEqual([{ x: "1", y: "a,b", z: "3" }]);
  });

  it("tolerates CRLF and short rows", () => {
    expect(parseCsv("x,y\r\n1\r\n")).toEqual([{ x: "1", y: "" }]);
  });
});

describe("formatCsv", () => {
  it("round-trips values that need quoting", () => {
    const header = ["a", "b"];
    const rows = [{ a: 'x,"y"', b: "z" }];
    expect(parseCsv(formatCsv(header, rows))).toEqual(rows);
  });
});
