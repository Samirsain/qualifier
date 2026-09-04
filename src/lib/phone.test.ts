import assert from "node:assert/strict";
import test from "node:test";
import { parsePhone } from "./phone";

test("an explicit country code is honoured unchanged", () => {
  const r = parsePhone("+919876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, false);
});

test("a foreign number keeps its own country code", () => {
  const r = parsePhone("+14155552671");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+14155552671");
  assert.equal(r.assumedCountry, false);
});

test("a bare ten-digit Indian mobile gets +91 and is flagged as assumed", () => {
  for (const n of ["9876543210", "6123456789", "7000000000", "8999999999"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, true, `${n} should parse`);
    if (!r.ok) continue;
    assert.equal(r.e164, `+91${n}`);
    assert.equal(r.assumedCountry, true);
  }
});

test("a leading zero is dropped", () => {
  const r = parsePhone("09876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, true);
});

test("a bare 91-prefixed number is treated as explicit, not assumed", () => {
  const r = parsePhone("919876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, false);
});

test("spaces, dashes, dots and brackets are ignored", () => {
  for (const n of ["98765 43210", "98765-43210", "(98765) 43210", "98765.43210"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, true, `${n} should parse`);
    if (r.ok) assert.equal(r.e164, "+919876543210");
  }
});

test("a ten-digit number that is not a mobile prefix is rejected, never prefixed", () => {
  for (const n of ["1234567890", "5555555555", "0123456789"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, false, `${n} must be rejected`);
  }
});

test("wrong lengths are rejected with a stated reason", () => {
  assert.equal(parsePhone("987654321").ok, false);
  assert.equal(parsePhone("98765432101").ok, false);
  const r = parsePhone("987654321");
  if (!r.ok) assert.match(r.reason, /10 digits/);
});

test("letters and empty input are rejected", () => {
  assert.equal(parsePhone("98765abcde").ok, false);
  assert.equal(parsePhone("").ok, false);
  assert.equal(parsePhone("   ").ok, false);
});

test("an explicit + number that is malformed is rejected", () => {
  assert.equal(parsePhone("+9").ok, false);
  assert.equal(parsePhone("+0123456789").ok, false);
});

test("an explicit +91 number must still be a valid Indian mobile", () => {
  // Truncated: only 8 national digits.
  assert.equal(parsePhone("+9198765432").ok, false);
  // National part starts with 1, not 6-9.
  assert.equal(parsePhone("+91123456789").ok, false);
  // Correct ones still pass.
  assert.equal(parsePhone("+919876543210").ok, true);
});

test("a non-Indian country code is not held to Indian mobile rules", () => {
  // We only know India's national format; other countries pass on E.164 shape.
  assert.equal(parsePhone("+14155552671").ok, true);
  assert.equal(parsePhone("+442071838750").ok, true);
});
