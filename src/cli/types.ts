/* The CLI framework's vocabulary: the argument parser and command registry. */

type OptionType = "string" | "boolean" | "number";
export type OptionValue = string | number | boolean;

export interface OptionSpec {
  name: string;
  alias?: string;
  type?: OptionType;
  default?: OptionValue;
  env?: string;
  desc?: string;
  required?: boolean;
}

export interface ArgSpec {
  name: string;
  required?: boolean;
  desc?: string;
}

export interface ParsedArgs {
  positionals: Record<string, string>;
  options: Record<string, OptionValue | undefined>;
  help: boolean;
}

export interface CommandSpec {
  summary: string;
  args?: ReadonlyArray<ArgSpec>;
  options?: ReadonlyArray<OptionSpec>;
  subcommands?: Record<string, CommandSpec>;
  run?(parsed: ParsedArgs): Promise<void> | void;
}
