import { expect, it } from "vitest";
import { authCookie, hasAuthCookie, sha256Hex } from "./auth";

it("hashes deterministically", async () => {
  expect(await sha256Hex("123456")).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
});

it("accepts only the matching cookie", async () => {
  const hash = await sha256Hex("123456");
  expect(hasAuthCookie(`dash_auth=${hash}`, hash)).toBe(true);
  expect(hasAuthCookie(`other=1; dash_auth=${hash}`, hash)).toBe(true);
  expect(hasAuthCookie("dash_auth=wrong", hash)).toBe(false);
  expect(hasAuthCookie(null, hash)).toBe(false);
});

it("sets a hardened cookie", async () => {
  const cookie = authCookie("abc");
  expect(cookie).toContain("dash_auth=abc");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
});
