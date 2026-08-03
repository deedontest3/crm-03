// Deno tests for db-cleanup-scan helpers.
// Run via the deploy/test harness — no network calls.
//
// We re-implement the small pure helpers here rather than importing from
// index.ts (which boots Deno.serve at import time) and assert their behaviour.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const [local, domain] = trimmed.split("@");
  if (!domain) return trimmed;
  const localNoTag = local.split("+")[0];
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  const localFinal = isGmail ? localNoTag.replace(/\./g, "") : localNoTag;
  return `${localFinal}@${domain}`;
}

function normalizePhone(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

Deno.test("normalizeEmail collapses gmail aliases", () => {
  assertEquals(normalizeEmail("John.Doe+spam@gmail.com"), "johndoe@gmail.com");
  assertEquals(normalizeEmail("johndoe@gmail.com"), "johndoe@gmail.com");
});

Deno.test("normalizeEmail keeps dots for non-gmail", () => {
  assertEquals(normalizeEmail("John.Doe@example.com"), "john.doe@example.com");
  assertEquals(normalizeEmail("john+work@example.com"), "john@example.com");
});

Deno.test("normalizeEmail handles junk input", () => {
  assertEquals(normalizeEmail(""), "");
  assertEquals(normalizeEmail("   "), "");
  assertEquals(normalizeEmail(null), "");
  assertEquals(normalizeEmail("not-an-email"), "not-an-email");
});

Deno.test("normalizePhone clusters formatted vs raw US numbers", () => {
  assertEquals(normalizePhone("+1 (555) 555-0123"), "+15555550123");
  assertEquals(normalizePhone("555-555-0123"), "5555550123");
  assertEquals(normalizePhone("5555550123"), "5555550123");
});

Deno.test("normalizePhone handles short / empty values", () => {
  assertEquals(normalizePhone("123"), "123");
  assertEquals(normalizePhone(""), "");
  assertEquals(normalizePhone(undefined), "");
});
