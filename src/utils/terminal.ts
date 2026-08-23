/*
 * Terminal I/O: colour, output streams, the CLI error type, and an interactive
 * prompt.
 *
 * Human-facing chatter goes to stderr so stdout can carry machine-readable data
 * (JSON) that callers can pipe.
 */

import { createInterface } from "node:readline";

/* Keyed to stderr, which is where every coloured line goes; stdout carries
 * pipeable data and is routinely redirected while the terminal is still there. */
const useColor = process.stderr.isTTY && process.env.NO_COLOR === undefined;
const paint = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

export const color = {
  dim: (text: string): string => paint("2", text),
  bold: (text: string): string => paint("1", text),
  green: (text: string): string => paint("32", text),
  red: (text: string): string => paint("31", text),
  yellow: (text: string): string => paint("33", text),
  cyan: (text: string): string => paint("36", text),
};

export function out(message: string = ""): void {
  process.stderr.write(`${message}\n`);
}

export function emit(dataLine: string): void {
  process.stdout.write(`${dataLine}\n`);
}

export class CliError extends Error {}

export function fail(message: string): never {
  throw new CliError(message);
}

export function ask(
  question: string,
  { hidden = false }: { hidden?: boolean } = {},
): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;
  const rl = createInterface({ input, output });

  /* Repaint the prompt over each keystroke so the password never appears. */
  const mask = (): void => {
    output.write(`\x1b[2K\x1b[200D${question}`);
  };
  if (hidden) input.on("data", mask);

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (hidden) {
        input.off("data", mask);
        output.write("\n");
      }
      rl.close();
      resolve(answer.trim());
    });
  });
}
