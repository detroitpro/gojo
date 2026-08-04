import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { CliError, ExitCode, printError as printCliError } from "@/transports/cli/errors";
import {
  printError,
  printOutput,
  printSection,
  printSuccess,
} from "@/transports/cli/output";
import { formatKeyValue } from "@/transports/cli/table";

describe("cli/errors", () => {
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
  });

  function captureStderr(): string[] {
    const lines: string[] = [];
    spies.push(
      spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );
    return lines;
  }

  test("CliError defaults to Usage and preserves nextStep", () => {
    const error = new CliError("bad flag", {
      code: ExitCode.NotFound,
      nextStep: "gojo help auth",
    });
    expect(error.name).toBe("CliError");
    expect(error.message).toBe("bad flag");
    expect(error.code).toBe(ExitCode.NotFound);
    expect(error.nextStep).toBe("gojo help auth");

    const fallback = new CliError("missing arg");
    expect(fallback.code).toBe(ExitCode.Usage);
    expect(fallback.nextStep).toBeUndefined();
  });

  test("printError writes JSON, yaml, and text envelopes", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    try {
      const jsonLines = captureStderr();
      printCliError("boom", "json", "retry later");
      expect(JSON.parse(jsonLines[0]!)).toEqual({
        error: { message: "boom", nextStep: "retry later" },
      });

      const yamlLines = captureStderr();
      printCliError("boom", "yaml");
      expect(yamlLines).toEqual(["error: boom"]);

      const textLines = captureStderr();
      printError("boom", "text", "retry later");
      expect(textLines[0]).toContain("Error: boom");
      expect(textLines[1]).toContain("Next: retry later");
    } finally {
      if (prev === undefined) {
        delete process.env["NO_COLOR"];
      } else {
        process.env["NO_COLOR"] = prev;
      }
    }
  });
});

describe("cli/output", () => {
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
  });

  function captureStdout(): string[] {
    const lines: string[] = [];
    spies.push(
      spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );
    return lines;
  }

  test("printOutput formats json, yaml, text primitives, arrays, and objects", () => {
    const jsonLines = captureStdout();
    printOutput("json", { ok: true });
    expect(JSON.parse(jsonLines[0]!)).toEqual({ ok: true });

    const yamlLines = captureStdout();
    printOutput("yaml", { ok: true });
    expect(yamlLines[0]).toContain("ok: true");

    const stringLines = captureStdout();
    printOutput("text", "ready");
    expect(stringLines).toEqual(["ready"]);

    const arrayLines = captureStdout();
    printOutput("text", ["one", { two: 2 }]);
    expect(arrayLines[0]).toBe("one");
    expect(arrayLines[1]).toBe('{"two":2}');

    const objectLines = captureStdout();
    printOutput("text", { name: "gojo", meta: { v: 1 } });
    expect(objectLines[0]).toContain("name:");
    expect(objectLines[0]).toContain("gojo");
    expect(objectLines[0]).toContain('{"v":1}');
  });

  test("printSuccess and printSection only emit in text mode", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    try {
      const silent = captureStdout();
      printSuccess("done", "json");
      printSection("Details", "yaml");
      expect(silent).toEqual([]);

      const text = captureStdout();
      printSuccess("done", "text");
      printSection("Details", "text");
      expect(text[0]).toContain("done");
      expect(text[1]).toContain("Details");
    } finally {
      if (prev === undefined) {
        delete process.env["NO_COLOR"];
      } else {
        process.env["NO_COLOR"] = prev;
      }
    }
  });

  test("formatKeyValue renders labels and empty values", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    try {
      const text = formatKeyValue([
        ["id", "run-1"],
        ["note", null],
        ["tags", ""],
      ]);
      expect(text).toContain("id:");
      expect(text).toContain("run-1");
      expect(text.match(/—/g)?.length).toBe(2);
    } finally {
      if (prev === undefined) {
        delete process.env["NO_COLOR"];
      } else {
        process.env["NO_COLOR"] = prev;
      }
    }
  });
});
