/**
 * Password policy, pure functions (BUILD-BRIEF.md §8 local unit).
 *
 * No dependencies, no I/O, no hashing, never throws, never logs, never rejects
 * on a denylist lookup. All string comparisons are case-insensitive.
 */

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 256;

export type PolicyFailure =
  | "too_short"
  | "too_long"
  | "whitespace_only"
  | "contains_email_local_part"
  | "single_character_class"
  | "sequential_run"
  | "repeated_run";

/** Unicode NFKC normalization, trimming nothing else. */
export function normalizePassword(p: string): string {
  return p.normalize("NFKC");
}

function classOf(ch: string): "lower" | "upper" | "digit" | "symbol" {
  if (ch >= "a" && ch <= "z") return "lower";
  if (ch >= "A" && ch <= "Z") return "upper";
  if (ch >= "0" && ch <= "9") return "digit";
  return "symbol";
}

/** 4+ consecutive ascending or descending characters (abcd, 4321). */
function hasSequentialRun(s: string): boolean {
  for (let i = 0; i + 3 < s.length; i++) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    const d = s.charCodeAt(i + 3);
    if (b - a === 1 && c - b === 1 && d - c === 1) return true;
    if (a - b === 1 && b - c === 1 && c - d === 1) return true;
  }
  return false;
}

/** 4+ identical characters. */
function hasRepeatedRun(s: string): boolean {
  for (let i = 0; i + 3 < s.length; i++) {
    if (s[i] === s[i + 1] && s[i] === s[i + 2] && s[i] === s[i + 3]) return true;
  }
  return false;
}

export interface CheckPasswordResult {
  ok: boolean;
  failures: PolicyFailure[];
}

export function checkPassword(
  password: string,
  context?: { email?: string },
): CheckPasswordResult {
  const p = normalizePassword(password);
  const failures: PolicyFailure[] = [];

  if (p.length < MIN_LENGTH) failures.push("too_short");
  if (p.length > MAX_LENGTH) failures.push("too_long");
  if (p.trim().length === 0) failures.push("whitespace_only");

  const lower = p.toLowerCase();

  const email = context?.email;
  if (email) {
    const local = email.split("@")[0].toLowerCase();
    if (local.length >= 4 && lower.includes(local)) {
      failures.push("contains_email_local_part");
    }
  }

  const classes = new Set<string>();
  for (const ch of p) {
    if (ch.trim() === "") continue; // ignore whitespace for class detection
    classes.add(classOf(ch));
  }
  if (classes.size === 1) failures.push("single_character_class");

  if (hasSequentialRun(lower)) failures.push("sequential_run");
  if (hasRepeatedRun(lower)) failures.push("repeated_run");

  return { ok: failures.length === 0, failures };
}
