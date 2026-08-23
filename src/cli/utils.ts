/*
 * The CLI framework's helpers: the argument parser, typed readers for parsed
 * options, the not-logged-in guard every session-bearing command starts with,
 * and the renderers that turn typed rows into human terminal lines.
 */

import { loadSession, type Session } from "#src/session.ts";
import { config } from "#src/config.ts";
import { reloginFromConfig } from "#src/api/auth/auth.ts";
import { asString, asNumber } from "#src/utils/guards.ts";
import { color, fail } from "#src/utils/terminal.ts";
import type { Visitor, VisitorPass } from "#src/api/visitors/types.ts";
import type {
  OptionValue,
  OptionSpec,
  ParsedArgs,
  CommandSpec,
} from "#src/cli/types.ts";

/*
 * Parsed option values are `OptionValue | undefined`; these narrow one to the
 * type a command expects, so commands read options without an `as` cast.
 */
export function optString(
  options: Record<string, OptionValue | undefined>,
  name: string,
): string | undefined {
  return asString(options[name]);
}

export function optNumber(
  options: Record<string, OptionValue | undefined>,
  name: string,
): number | undefined {
  return asNumber(options[name]);
}

export function optBool(
  options: Record<string, OptionValue | undefined>,
  name: string,
): boolean {
  return options[name] === true;
}

/*
 * The cached session, or — when none is usable but ANACITY_USERNAME/PASSWORD are
 * set — a fresh one logged in from those credentials. Only fails when there is
 * nothing to log in with.
 */
export async function requireSession(): Promise<Session> {
  const session = loadSession();
  if (session?.cookies.acsession) return session;
  if (config.username && config.password) return reloginFromConfig();
  fail(
    "not logged in — run `anacity login`, or set ANACITY_USERNAME/ANACITY_PASSWORD",
  );
}

/* Coerces a raw string to the option's declared type. `where` names the source
 * (the flag or the env var) so a bad number reports where it came from. */
function coerceOptionValue(
  option: OptionSpec,
  raw: string,
  where: string,
): OptionValue {
  if (option.type !== "number") return raw;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) fail(`${where} expects a number, got "${raw}"`);
  return parsed;
}

/* Maps every --name and -alias to its spec for O(1) flag lookup. */
function indexOptions(spec: CommandSpec): Map<string, OptionSpec> {
  const byName = new Map<string, OptionSpec>();
  for (const option of spec.options ?? []) {
    byName.set(`--${option.name}`, option);
    if (option.alias) byName.set(`-${option.alias}`, option);
  }
  return byName;
}

/* First pass: split argv into explicitly-set options and positional values.
 * Returns help=true the moment --help/-h appears, short-circuiting the rest. */
function tokenizeArgs(
  argv: ReadonlyArray<string>,
  optionByName: Map<string, OptionSpec>,
): {
  options: Record<string, OptionValue | undefined>;
  positionalValues: Array<string>;
  help: boolean;
} {
  const options: Record<string, OptionValue | undefined> = {};
  const positionalValues: Array<string> = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--help" || token === "-h")
      return { options: {}, positionalValues: [], help: true };

    if (!token.startsWith("-") || token === "-") {
      positionalValues.push(token);
      continue;
    }

    let name = token;
    let inlineValue: string | null = null;
    const equals = token.indexOf("=");
    if (equals !== -1) {
      name = token.slice(0, equals);
      inlineValue = token.slice(equals + 1);
    }
    const option = optionByName.get(name);
    if (!option) fail(`unknown option: ${name}`);
    if (option.type === "boolean") {
      options[option.name] = true;
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined) fail(`option ${name} needs a value`);
    options[option.name] = coerceOptionValue(option, value, `option ${name}`);
  }

  return { options, positionalValues, help: false };
}

/* Binds positional values to declared args in order, rejecting any extras. */
function bindPositionals(
  spec: CommandSpec,
  positionalValues: ReadonlyArray<string>,
): Record<string, string> {
  const positionals: Record<string, string> = {};
  const args = spec.args ?? [];
  args.forEach((argSpec, order) => {
    const value = positionalValues[order];
    if (value !== undefined) positionals[argSpec.name] = value;
  });
  if (positionalValues.length > args.length) {
    fail(`unexpected argument: ${positionalValues[args.length]}`);
  }
  return positionals;
}

/* Fills unset options from the fallback tiers, strongest first: an explicit
 * flag already wins, then the option's env var, then its declared default.
 * An absent boolean is false — there is no tier below it. */
function applyOptionFallbacks(
  spec: CommandSpec,
  options: Record<string, OptionValue | undefined>,
): void {
  for (const option of spec.options ?? []) {
    if (options[option.name] !== undefined) continue;
    const envValue = option.env ? process.env[option.env] : undefined;
    if (envValue && option.env) {
      options[option.name] = coerceOptionValue(option, envValue, option.env);
    } else if (option.default !== undefined) {
      options[option.name] = option.default;
    } else if (option.type === "boolean") {
      options[option.name] = false;
    }
  }
}

function checkRequired(
  spec: CommandSpec,
  options: Record<string, OptionValue | undefined>,
  positionals: Record<string, string>,
): void {
  for (const argSpec of spec.args ?? []) {
    if (argSpec.required && positionals[argSpec.name] === undefined) {
      fail(`missing required argument: <${argSpec.name}>`);
    }
  }
  for (const option of spec.options ?? []) {
    if (option.required && options[option.name] === undefined) {
      fail(`missing required option: --${option.name}`);
    }
  }
}

/* Supports --flag value, --flag=value, -a value, and boolean flags. */
export function parseArgs(
  argv: ReadonlyArray<string>,
  spec: CommandSpec,
): ParsedArgs {
  const { options, positionalValues, help } = tokenizeArgs(
    argv,
    indexOptions(spec),
  );
  if (help) return { positionals: {}, options: {}, help: true };

  const positionals = bindPositionals(spec, positionalValues);
  applyOptionFallbacks(spec, options);
  checkRequired(spec, options, positionals);
  return { positionals, options, help: false };
}

/* ---- row renderers ------------------------------------------------------- */

export function describeVisitor(visitor: Visitor): string {
  const name = visitor.vis_name || visitor.visitor_name || "(unnamed)";
  const gate = visitor.gate_pass_id || "?";
  const unit = visitor.ru_num || visitor.ru_id || visitor.flat || "";
  return `${color.bold(name)} ${color.dim(`gate_pass_id=${gate}${unit ? ` unit=${unit}` : ""}`)}`;
}

export function describePass(pass: VisitorPass): string {
  const name = pass.visitor_name || pass.to_meet || "(unnamed)";
  const org = pass.visitor_org ? ` ${color.cyan(pass.visitor_org)}` : "";
  const when =
    pass.visit_dates_range || pass.visit_date_time || pass.visit_date || "";
  const status = pass.pass_status
    ? ` ${color.dim(`[${pass.pass_status}]`)}`
    : "";
  const unit = pass.ru_num ? ` unit=${pass.ru_num}` : "";
  const ids = color.dim(
    `gate_pass_id=${pass.gate_pass_id || "?"} guid=${pass.guid || "?"}`,
  );
  return `${color.bold(name)}${org}${status} ${color.dim(when)}${color.dim(unit)}\n    ${ids}`;
}
