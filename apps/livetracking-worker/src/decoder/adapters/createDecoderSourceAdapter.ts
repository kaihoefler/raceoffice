import type { LiveTrackingTimingPoint } from "@raceoffice/domain";
import { AmmcDecoderSourceAdapter } from "./ammcDecoderSourceAdapter.js";
import type { DecoderBackendKind, DecoderHealthPatch, DecoderSourceAdapter, NormalizedPassing } from "./decoderSourceAdapter.js";
import { P3ParserDecoderSourceAdapter } from "../p3/p3ParserDecoderSourceAdapter.js";

type AdapterCallbacks = {
  onPassing: (passing: NormalizedPassing) => void;
  onWarning: (message: string) => void;
  onHealth: (update: DecoderHealthPatch) => void;
};

export function createDecoderSourceAdapter(
  backend: DecoderBackendKind,
  timingPoints: LiveTrackingTimingPoint[],
  callbacks: AdapterCallbacks,
): DecoderSourceAdapter {
  switch (backend) {
    case "ammc":
      return new AmmcDecoderSourceAdapter(timingPoints, callbacks);
    case "p3parser":
      return new P3ParserDecoderSourceAdapter(timingPoints, callbacks);
  }
}
