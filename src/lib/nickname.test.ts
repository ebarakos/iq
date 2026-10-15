import { describe, expect, it } from "vitest";
import { checkNickname } from "./nickname";

describe("nickname rules", () => {
  it.each([
    ["  Ada   Lovelace ", "Ada Lovelace"],
    ["Claude", "Claude"],
    ["Ελένη", "Ελένη"],
    ["R2-D2", "R2-D2"],
    ["O'Brien", "O'Brien"],
    ["Ｗｉｄｅ", "Wide"],
    ["Scunthorpe", "Scunthorpe"],
    // Names that contain the letters of a blocked word, and are not it (Codex review, 2026-10-14).
    ["Ignazio", "Ignazio"],
    ["Nazir", "Nazir"],
    ["Nazim", "Nazim"],
    ["Nazih", "Nazih"],
    ["Nazia Khan", "Nazia Khan"],
  ])("accepts %j as %j", (raw, nickname) => {
    expect(checkNickname(raw)).toEqual({ ok: true, nickname });
  });

  it.each([
    ["", "between 2 and 24"],
    ["A", "between 2 and 24"],
    ["x".repeat(25), "between 2 and 24"],
    ["name\nline", "letters, numbers"],
    ["a​b", "letters, numbers"],
    ["evil‮eman", "letters, numbers"],
    ["me@example", "letters, numbers"],
    ["<b>bold</b>", "letters, numbers"],
    ["12345", "at least one letter"],
    ["visit evil.com", "web address"],
    ["www.example", "web address"],
    ["https now", "web address"],
    ["fuck", "not allowed"],
    ["sh1t head", "not allowed"],
    ["f u c k", "not allowed"],
    ["Nazi 88", "not allowed"],
    ["nazis", "not allowed"],
    ["neo-nazi", "not allowed"],
    ["Neonazi", "not allowed"],
    ["NaziFan", "not allowed"],
    ["n a z i", "not allowed"],
    ["HitlerFan", "not allowed"],
    ["KKK", "not allowed"],
  ])("refuses %j", (raw, reason) => {
    const check = checkNickname(raw);
    expect(check.ok).toBe(false);
    expect(check.ok ? "" : check.message).toContain(reason);
  });

  it("never names the word that matched", () => {
    const check = checkNickname("bitch");
    expect(check.ok ? "" : check.message.toLowerCase()).not.toContain("bitch");
  });
});
