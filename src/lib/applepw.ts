/**
 * Contraseñas específicas para apps de Apple: 16 letras, que Apple enseña como
 * "abcd-efgh-ijkl-mnop". Se aceptan pegadas con guiones, espacios o en mayúsculas.
 */
export const APPLE_APP_PASSWORDS_URL = "https://account.apple.com/account/manage/section/security";

export type AppPasswordCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "incomplete" | "looks-like-normal-password" };

/** Normaliza lo que se pega y dice si parece un código válido. */
export function checkAppPassword(input: string): AppPasswordCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty" };
  const letters = raw.replace(/[\s-]/g, "");
  if (/^[a-z]{16}$/i.test(letters)) return { ok: true, value: formatAppPassword(letters) };
  // Números, símbolos o longitud rara: casi seguro es la contraseña normal del Apple ID.
  if (/[^a-z\s-]/i.test(raw) || letters.length > 16) return { ok: false, reason: "looks-like-normal-password" };
  return { ok: false, reason: "incomplete" };
}

/** "ABCDefghijklmnop" → "abcd-efgh-ijkl-mnop" (también con códigos a medio escribir). */
export function formatAppPassword(input: string): string {
  const letters = input.replace(/[^a-z]/gi, "").toLowerCase().slice(0, 16);
  return letters.match(/.{1,4}/g)?.join("-") ?? "";
}
