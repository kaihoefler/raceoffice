import { describe, expect, it } from "vitest";

import { normalizeTimingPoints, validateLiveTrackingTrack, type LiveTrackingTrack } from "./setup.js";

describe("livetracking/setup", () => {
    it("normalizes order, derived positions and decoder timestamp offset defaults", () => {

    const normalized = normalizeTimingPoints([
      {
        id: "tp-3",
        name: "Split 2",
        decoderId: "d3",
        decoderIp: "10.0.0.3",
        websocketPortAMM: 5030,
        order: 3,
        distanceFromPreviousM: 70,
        absolutePositionM: 9999,
        role: "split",
        enabled: true,
      },
      {
        id: "tp-1",
        name: "Start/Finish",
        decoderId: "d1",
        decoderIp: "10.0.0.1",
        websocketPortAMM: 5010,
        decoderTimestampOffsetSecs: 1.234,
        order: 1,

        distanceFromPreviousM: 50,
        absolutePositionM: 9999,
        role: "start_finish",
        enabled: true,
      },
      {
        id: "tp-2",
        name: "Split 1",
        decoderId: "d2",
        decoderIp: "10.0.0.2",
        websocketPortAMM: 5020,
        order: 2,
        distanceFromPreviousM: 50,
        absolutePositionM: 9999,
        role: "split",
        enabled: true,
      },
    ]);

    expect(normalized.map((x) => x.id)).toEqual(["tp-1", "tp-2", "tp-3"]);
    expect(normalized.map((x) => x.order)).toEqual([1, 2, 3]);
        expect(normalized.map((x) => x.absolutePositionM)).toEqual([0, 50, 120]);
    expect(normalized[0].distanceFromPreviousM).toBe(0);
        expect(normalized.map((x) => x.decoderTimestampOffsetSecs)).toEqual([1.234, 0, 0]);
  });

  it("normalizes decoder timestamp offset to millisecond precision", () => {
    const normalized = normalizeTimingPoints([
      {
        id: "tp-1",
        name: "Start/Finish",
        decoderId: "d1",
        decoderIp: "10.0.0.1",
        websocketPortAMM: 5010,
        decoderTimestampOffsetSecs: 1.23456,
        order: 1,
        distanceFromPreviousM: 0,
        absolutePositionM: 0,
        role: "start_finish",
        enabled: true,
      },
    ]);

    expect(normalized[0].decoderTimestampOffsetSecs).toBe(1.235);
  });



  it("validates exactly one enabled start_finish", () => {
    const track: LiveTrackingTrack = {
      id: "track-1",
      name: "Track",
      lengthM: 200,
      timingPoints: [
        {
          id: "a",
          name: "A",
          decoderId: "d1",
          decoderIp: "10.0.0.1",
          websocketPortAMM: 5001,
          order: 1,
          distanceFromPreviousM: 0,
          absolutePositionM: 0,
          role: "start_finish",
          enabled: true,
        },
        {
          id: "b",
          name: "B",
          decoderId: "d2",
          decoderIp: "10.0.0.2",
          websocketPortAMM: 5002,
          order: 2,
          distanceFromPreviousM: 100,
          absolutePositionM: 100,
          role: "start_finish",
          enabled: true,
        },
      ],
    };

    const issues = validateLiveTrackingTrack(track);
    expect(issues.some((x) => x.code === "timing_point_start_finish_count")).toBe(true);
  });

  it("validates order duplicates and gaps", () => {
    const track: LiveTrackingTrack = {
      id: "track-1",
      name: "Track",
      lengthM: 500,
      timingPoints: [
        {
          id: "a",
          name: "A",
          decoderId: "d1",
          decoderIp: "10.0.0.1",
          websocketPortAMM: 5001,
          order: 1,
          distanceFromPreviousM: 0,
          absolutePositionM: 0,
          role: "start_finish",
          enabled: true,
        },
        {
          id: "b",
          name: "B",
          decoderId: "d2",
          decoderIp: "10.0.0.2",
          websocketPortAMM: 5002,
          order: 3,
          distanceFromPreviousM: 100,
          absolutePositionM: 100,
          role: "split",
          enabled: true,
        },
        {
          id: "c",
          name: "C",
          decoderId: "d3",
          decoderIp: "10.0.0.3",
          websocketPortAMM: 5003,
          order: 3,
          distanceFromPreviousM: 100,
          absolutePositionM: 200,
          role: "split",
          enabled: true,
        },
      ],
    };

    const issues = validateLiveTrackingTrack(track);
    expect(issues.some((x) => x.code === "timing_point_order_duplicate")).toBe(true);
    expect(issues.some((x) => x.code === "timing_point_order_not_contiguous")).toBe(true);
  });

    it("validates decoder timestamp offset bounds", () => {
    const track: LiveTrackingTrack = {
      id: "track-1",
      name: "Track",
      lengthM: 500,
      timingPoints: [
        {
          id: "a",
          name: "A",
          decoderId: "d1",
          decoderIp: "10.0.0.1",
          websocketPortAMM: 5001,
          decoderTimestampOffsetSecs: 90_000,
          order: 1,
          distanceFromPreviousM: 0,
          absolutePositionM: 0,
          role: "start_finish",
          enabled: true,
        },
      ],
    };

    const issues = validateLiveTrackingTrack(track);
    expect(issues.some((x) => x.code === "timing_point_decoder_time_offset_invalid")).toBe(true);
  });

  it("validates distance plausibility and absolute position against track length", () => {

    const track: LiveTrackingTrack = {
      id: "track-1",
      name: "Track",
      lengthM: 100,
      timingPoints: [
        {
          id: "a",
          name: "A",
          decoderId: "d1",
          decoderIp: "10.0.0.1",
          websocketPortAMM: 5001,
          order: 1,
          distanceFromPreviousM: 5,
          absolutePositionM: 5,
          role: "start_finish",
          enabled: true,
        },
        {
          id: "b",
          name: "B",
          decoderId: "d2",
          decoderIp: "10.0.0.2",
          websocketPortAMM: 5002,
          order: 2,
          distanceFromPreviousM: 120,
          absolutePositionM: 125,
          role: "split",
          enabled: true,
        },
      ],
    };

    const issues = validateLiveTrackingTrack(track);
    expect(issues.some((x) => x.code === "timing_point_absolute_position_exceeds_track_length")).toBe(true);
  });
});
