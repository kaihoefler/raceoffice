import { describe, expect, it } from "vitest";

import { normalizeAmmPayloadToPassing } from "./ammParser.js";

describe("ammParser", () => {
  it("applies positive decoder timestamp offset", () => {
    const normalized = normalizeAmmPayloadToPassing({
      payload: {
        msg: "passing",
        rtc_time: "2026-01-01T10:00:00.000Z",
        transponder: "12345",
      },
      timingPoint: {
        id: "tp-1",
        decoderId: "dec-1",
        decoderTimestampOffsetSecs: 3600,
      },
    });

    expect(normalized?.passing.timestamp).toBe("2026-01-01T11:00:00.000Z");
  });

  it("applies negative decoder timestamp offset", () => {
    const normalized = normalizeAmmPayloadToPassing({
      payload: {
        msg: "passing",
        rtc_time: "2026-01-01T10:00:00.000Z",
        transponder: "12345",
      },
      timingPoint: {
        id: "tp-1",
        decoderId: "dec-1",
        decoderTimestampOffsetSecs: -120,
      },
    });

    expect(normalized?.passing.timestamp).toBe("2026-01-01T09:58:00.000Z");
  });
});
