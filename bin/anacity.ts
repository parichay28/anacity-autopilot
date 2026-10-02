#!/usr/bin/env bun
/* anacity CLI entry point: hands argv to the CLI and renders errors; all
 * behaviour lives under ../src. Run `anacity --help` for commands. */

import { run } from "#src/cli/cli.ts";
import { color, out, CliError } from "#src/utils/terminal.ts";
import { errorDetail } from "#src/utils/errors.ts";
import { APIError } from "#src/http.ts";

run(process.argv.slice(2)).catch((error: unknown) => {
  /* Usage errors (CliError/APIError) show just the message; an unexpected error
   * is a bug, so errorDetail keeps its stack. */
  const message =
    error instanceof CliError || error instanceof APIError
      ? error.message
      : errorDetail(error);
  out(`${color.red("error")} ${message}`);
  process.exit(1);
});
