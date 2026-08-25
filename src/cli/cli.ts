/* CLI front-end: help rendering and dispatch over the command registry.
 * Commands are spec objects from ../commands; parsing in ./utils.ts. */

import { color, out, fail } from "#src/utils/terminal.ts";
import { config } from "#src/config.ts";
import { APIError } from "#src/http.ts";
import { reloginFromConfig } from "#src/api/auth/auth.ts";
import { MAX_RELOGIN_RETRIES } from "#src/api/constants.ts";
import { login, logout, whoami } from "#src/commands/auth.ts";
import { brands } from "#src/commands/brands.ts";
import { visitors } from "#src/commands/visitors.ts";
import { deliveries } from "#src/commands/deliveries.ts";
import { serve } from "#src/commands/serve.ts";
import { parseArgs } from "#src/cli/utils.ts";
import type { CommandSpec, ParsedArgs } from "#src/cli/types.ts";

const commands: Record<string, CommandSpec> = {
  login,
  logout,
  whoami,
  brands,
  visitors,
  deliveries,
  serve,
};

/* hasOwn guard: a bare index read would resolve inherited keys like
 * `toString`, silently dispatching instead of reporting unknown command. */
function lookup(
  registry: Record<string, CommandSpec>,
  name: string,
): CommandSpec | undefined {
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}

/* Runs a command, re-authenticating and retrying once on expiry when
 * ANACITY_USERNAME/PASSWORD are set; else the error surfaces for `anacity login`. */
async function dispatch(spec: CommandSpec, parsed: ParsedArgs): Promise<void> {
  /* Grouped specs carry subcommands, not a runner; there is nothing to run. */
  if (!spec.run) return;
  const runCommand = spec.run;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runCommand(parsed);
    } catch (error) {
      const canRetry =
        error instanceof APIError &&
        Boolean(config.username && config.password) &&
        attempt < MAX_RELOGIN_RETRIES;
      if (!canRetry) throw error;
      out(color.yellow("session expired — re-authenticating…"));
      await reloginFromConfig();
    }
  }
}

function printRootHelp(): void {
  out(
    `${color.bold("anacity")} — control ANACITY visitor approvals and delivery pre-auth\n`,
  );
  out("Usage: anacity <command> [subcommand] [options]\n");
  out("Commands:");
  for (const [name, command] of Object.entries(commands)) {
    out(`  ${name.padEnd(12)} ${color.dim(command.summary)}`);
    for (const [subName, sub] of Object.entries(command.subcommands ?? {})) {
      out(`  ${`  ${subName}`.padEnd(12)} ${color.dim(sub.summary)}`);
    }
  }
  out("\nRun `anacity <command> --help` for details.");
  out(
    color.dim(
      "\nEnv: ANACITY_USERNAME, ANACITY_PASSWORD, ANACITY_COUNTRY_CODE, ANACITY_HOST_ID, ANACITY_RU_ID",
    ),
  );
}

function printCommandHelp(path: string, spec: CommandSpec): void {
  out(`${color.bold(`anacity ${path}`)} — ${spec.summary}\n`);
  const argsUsage = (spec.args ?? [])
    .map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
    .join(" ");
  out(
    `Usage: anacity ${path}${argsUsage ? ` ${argsUsage}` : ""}${spec.options?.length ? " [options]" : ""}\n`,
  );
  if (spec.args?.length) {
    out("Arguments:");
    for (const arg of spec.args)
      out(`  ${arg.name.padEnd(18)} ${color.dim(arg.desc || "")}`);
    out("");
  }
  if (spec.options?.length) {
    out("Options:");
    for (const option of spec.options) {
      const flag = `--${option.name}${option.alias ? `, -${option.alias}` : ""}${option.type !== "boolean" ? " <value>" : ""}`;
      const envNote = option.env ? color.dim(` [${option.env}]`) : "";
      out(`  ${flag.padEnd(24)} ${color.dim(option.desc || "")}${envNote}`);
    }
    out("");
  }
  out(`  ${"--help, -h".padEnd(24)} ${color.dim("Show this help")}`);
}

export async function run(argv: ReadonlyArray<string>): Promise<void> {
  const [commandName, ...rest] = argv;
  if (
    !commandName ||
    commandName === "--help" ||
    commandName === "-h" ||
    commandName === "help"
  ) {
    printRootHelp();
    return;
  }
  const command = lookup(commands, commandName);
  if (!command) fail(`unknown command: ${commandName}\nrun \`anacity --help\``);

  if (command.subcommands) {
    const [subName, ...subRest] = rest;
    if (!subName || subName === "--help" || subName === "-h") {
      out(`${color.bold(`anacity ${commandName}`)} — ${command.summary}\n`);
      out("Subcommands:");
      for (const [name, sub] of Object.entries(command.subcommands)) {
        out(`  ${name.padEnd(12)} ${color.dim(sub.summary)}`);
      }
      out(`\nRun \`anacity ${commandName} <subcommand> --help\` for details.`);
      return;
    }
    const sub = lookup(command.subcommands, subName);
    if (!sub) fail(`unknown subcommand: ${commandName} ${subName}`);
    const parsed = parseArgs(subRest, sub);
    if (parsed.help) return printCommandHelp(`${commandName} ${subName}`, sub);
    return dispatch(sub, parsed);
  }

  const parsed = parseArgs(rest, command);
  if (parsed.help) return printCommandHelp(commandName, command);
  return dispatch(command, parsed);
}
