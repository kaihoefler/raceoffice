import { describe, expect, it } from "vitest";
import { applyClientWrite, parseClientWrite } from "./realtimeProtocol";

describe("parseClientWrite", () => {
  it("accepts { baseRev, patch }", () => {
    const patch = [{ op: "add", path: "/a", value: 1 }];
    expect(parseClientWrite(JSON.stringify({ baseRev: 3, patch }))).toEqual({ ok: true, baseRev: 3, patch });
  });

  it("rejects non-JSON as invalid_json without resync", () => {
    expect(parseClientWrite("{not json")).toMatchObject({ ok: false, code: "invalid_json", resync: false });
  });

  it.each([
    ["null", "null"],
    ["a number", "42"],
    ["missing baseRev", JSON.stringify({ patch: [] })],
    ["string baseRev", JSON.stringify({ baseRev: "1", patch: [] })],
    ["non-array patch", JSON.stringify({ baseRev: 1, patch: {} })],
  ])("rejects %s as invalid_payload", (_label, raw) => {
    expect(parseClientWrite(raw)).toMatchObject({ ok: false, code: "invalid_payload", resync: false });
  });
});

describe("applyClientWrite", () => {
  const current = { rev: 4, data: { title: "old", items: [1] } };

  it("applies the patch and increments rev without mutating the input", () => {
    const result = applyClientWrite(current, {
      baseRev: 4,
      patch: [{ op: "replace", path: "/title", value: "new" }],
    });

    expect(result).toEqual({ ok: true, next: { rev: 5, data: { title: "new", items: [1] } } });
    expect(current.data.title).toBe("old");
  });

  it("rejects a stale baseRev as rev_mismatch with the current rev", () => {
    expect(applyClientWrite(current, { baseRev: 3, patch: [] })).toMatchObject({
      ok: false,
      code: "rev_mismatch",
      resync: true,
      rev: 4,
    });
  });

  it.each([
    ["a failing test op", { op: "test", path: "/title", value: "other" }, "TEST_OPERATION_FAILED"],
    ["an unresolvable path", { op: "remove", path: "/missing" }, "OPERATION_PATH_UNRESOLVABLE"],
    ["an unknown op", { op: "frobnicate", path: "/title" }, "OPERATION_OP_INVALID"],
  ])("rejects %s as patch_apply_failed", (_label, op, causeCode) => {
    const result = applyClientWrite(current, { baseRev: 4, patch: [op as any] });

    expect(result).toMatchObject({ ok: false, code: "patch_apply_failed", resync: true, rev: 4 });
    expect((result as { message: string }).message.startsWith(`${causeCode}:`)).toBe(true);
  });
});
