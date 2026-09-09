import assert from "node:assert/strict";
import test from "node:test";
import { fillPlaceholders, unfilledPlaceholders } from "./placeholders";

test("a name is substituted, spacing and repeats included", () => {
  assert.equal(
    fillPlaceholders("Hello {{name}}, {{ name }} — welcome", { name: "Priya" }),
    "Hello Priya, Priya — welcome",
  );
});

test("a missing name falls back to a greeting that still reads", () => {
  assert.equal(fillPlaceholders("Hello {{name}}", { name: null }), "Hello there");
  assert.equal(fillPlaceholders("Hello {{name}}", { name: "  " }), "Hello there");
});

test("an unknown placeholder is left alone, so the sender can refuse", () => {
  const text = fillPlaceholders("Details: {{details}}", { name: "Priya" });
  assert.equal(text, "Details: {{details}}");
  assert.deepEqual(unfilledPlaceholders(text), ["{{details}}"]);
  assert.deepEqual(unfilledPlaceholders("Hello there"), []);
});
