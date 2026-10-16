import { describe, expect, it } from "vitest";
import { checkAppPassword, formatAppPassword } from "./applepw";

describe("contraseña específica para apps", () => {
  it.each(["abcd-efgh-ijkl-mnop", "abcdefghijklmnop", "ABCD EFGH IJKL MNOP", "  abcd-efgh-ijkl-mnop\n"])("acepta %j", (s) =>
    expect(checkAppPassword(s)).toEqual({ ok: true, value: "abcd-efgh-ijkl-mnop" }),
  );
  it("detecta la contraseña normal del Apple ID", () => {
    expect(checkAppPassword("MiContraseña2026!")).toEqual({ ok: false, reason: "looks-like-normal-password" });
    expect(checkAppPassword("Verano2024")).toEqual({ ok: false, reason: "looks-like-normal-password" });
  });
  it("código incompleto o vacío", () => {
    expect(checkAppPassword("abcd-efgh")).toEqual({ ok: false, reason: "incomplete" });
    expect(checkAppPassword("")).toEqual({ ok: false, reason: "empty" });
  });
  it("da formato mientras se escribe", () => {
    expect(formatAppPassword("abcdef")).toBe("abcd-ef");
    expect(formatAppPassword("ABCD-EFGH-IJKL-MNOPQR")).toBe("abcd-efgh-ijkl-mnop");
  });
});
