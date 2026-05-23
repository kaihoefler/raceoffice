/**
 * Reference-frame tests for the p3parser package.
 *
 * Why this file is called "golden":
 * - "golden tests" compare parser/builder output against known-good reference frames
 * - these references come from documented captures (Notizen_Analyse.txt) and must stay stable
 *
 * What this suite verifies:
 * 1) Outbound UDP discovery builders emit the exact expected wire hex
 * 2) Captured UDP discovery replies are parsed into the intended typed records
 * 3) Newly typed wrapper TORs remain stable at parser level
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  P3Parser,
  P3_TOR,
  buildP3Request,
  buildUdpBroadcastDiscoveryRequest21ByteObserved,
  buildUdpBroadcastDiscoveryRequest23ByteObserved,
  buildUdpBroadcastDiscoveryRequest25Byte,
  buildUdpBroadcastDiscoveryRequest32ByteObserved,
} from "../dist/index.js";

const parser = new P3Parser();

// Verifies outbound builder stability: request bytes must remain exactly as documented.
test("golden: observed UDP discovery requests match documented wire hex", () => {
  const req25 = buildUdpBroadcastDiscoveryRequest25Byte();
  const req32 = buildUdpBroadcastDiscoveryRequest32ByteObserved();
  const req23 = buildUdpBroadcastDiscoveryRequest23ByteObserved();
  const req21 = buildUdpBroadcastDiscoveryRequest21ByteObserved();

  assert.equal(req25.escapedFrameHex, "8E001900A53900000300010002000300040008000A000C008F");
  assert.equal(req32.escapedFrameHex, "8E001F00DD8DAF000036000100020003000400050006000700080009000A008F");
  assert.equal(req23.escapedFrameHex, "8E001700A7F600004A000100020003000400050006008F");
  assert.equal(req21.escapedFrameHex, "8E001500338000001200010002000300040005008F");

  assert.equal(req25.usageScenario, "udp-broadcast-discovery");
  assert.equal(req32.usageScenario, "udp-broadcast-discovery");
  assert.equal(req23.usageScenario, "udp-broadcast-discovery");
  assert.equal(req21.usageScenario, "udp-broadcast-discovery");
});

// Verifies parsing of a documented capture for TOR 0x0016 into the dedicated typed record.
test("golden: observed NETWORK_SETTINGS response (TOR 0x0016) parses as typed record", () => {
  const record = parser.parseRecord(
    "8E024100106C0000160002043BC9A8C0070101030400FFFFFF040401C9A8C005040808080806010008043BC9A8C0090400FFFFFF0A0401C9A8C0810492030C008F",
  );

  assert.equal(record.kind, "network-settings");
  assert.equal(record.tor, P3_TOR.NETWORK_SETTINGS);
  assert.equal(record.decoderId, "00-0C-03-92");
  assert.equal(record.ipAddress, "192.168.201.59");
  assert.equal(record.netmask, "255.255.255.0");
  assert.equal(record.defaultGateway, "192.168.201.1");
  assert.equal(record.dnsServer, "8.8.8.8");
});

// Verifies refined semantic mapping for network settings from observed field evidence.
test("golden: NETWORK_SETTINGS maps ip/netmask/gateway/dns semantic aliases", () => {
  const record = parser.parseRecord(
    "8E023C0083950000160005040000000006010008049700A8C0090400FFFFFF0A040100A8C08104F801040083042501030085080A01010A000000008F",
  );

  assert.equal(record.kind, "network-settings");
  assert.equal(record.decoderId, "00-04-01-F8");
  assert.equal(record.ipAddress, "192.168.0.151");
  assert.equal(record.netmask, "255.255.255.0");
  assert.equal(record.defaultGateway, "192.168.0.1");
  assert.equal(record.dnsServer, "0.0.0.0");
});

// Verifies parsing of a documented capture for observed TOR 0x0012.
test("golden: observed TOR 0x0012 response parses as typed record", () => {
  const record = parser.parseRecord("8E0223009FD600001200030428000000040428000000050428000000810492030C008F");

  assert.equal(record.kind, "tor-0012-observed");
  assert.equal(record.tor, P3_TOR.TOR_0012_OBSERVED);
  assert.equal(record.decoderId, "00-0C-03-92");
  assert.equal(record.observedField03, 40);
  assert.equal(record.observedField04, 40);
  assert.equal(record.observedField05, 40);
});

// Verifies parsing of a documented TIMELINE capture, including timeline name extraction.
test("golden: observed TIMELINE response (TOR 0x004A) parses as typed record", () => {
  const record = parser.parseRecord(
    "8E022B0046F100004A000106534620506974020401040000030403000000040404000000810492030C008F",
  );

  assert.equal(record.kind, "timeline");
  assert.equal(record.tor, P3_TOR.TIMELINE);
  assert.equal(record.timelineName, "SF Pit");
  assert.equal(record.decoderId, "00-0C-03-92");
  assert.equal(record.observedField02, 1025);
  assert.equal(record.observedField03, 3);
  assert.equal(record.observedField04, 4);
});

// Verifies that the generic typed wrappers for additional TORs remain wired and parseable.
// We build valid frames (incl. CRC) and assert record kind + decoder-id extraction.
test("golden: additional typed TOR wrappers (settings/signals/gps-info/first-contact)", () => {
  const settingsFrame = buildP3Request({
    name: "settings-sample",
    version: 0x02,
    tor: P3_TOR.SERVER_SETTINGS,
    body: "01024869810401020304",
  });
  const signalsFrame = buildP3Request({
    name: "signals-sample",
    version: 0x02,
    tor: P3_TOR.SIGNALS,
    body: "01024F4B810401020304",
  });
  const gpsInfoFrame = buildP3Request({
    name: "gps-info-sample",
    version: 0x02,
    tor: P3_TOR.GPS_INFO,
    body: "01024750810401020304",
  });
  const firstContactFrame = buildP3Request({
    name: "first-contact-sample",
    version: 0x02,
    tor: P3_TOR.FIRST_CONTACT,
    body: "01024643810401020304",
  });

  const settingsRecord = parser.parseRecord(settingsFrame.escapedFrame);
  const signalsRecord = parser.parseRecord(signalsFrame.escapedFrame);
  const gpsInfoRecord = parser.parseRecord(gpsInfoFrame.escapedFrame);
  const firstContactRecord = parser.parseRecord(firstContactFrame.escapedFrame);

  assert.equal(settingsRecord.kind, "settings");
  assert.equal(settingsRecord.decoderId, "04-03-02-01");
  assert.equal(signalsRecord.kind, "signals");
  assert.equal(signalsRecord.decoderId, "04-03-02-01");
  assert.equal(gpsInfoRecord.kind, "gps-info");
  assert.equal(gpsInfoRecord.decoderId, "04-03-02-01");
  assert.equal(firstContactRecord.kind, "first-contact");
  assert.equal(firstContactRecord.decoderId, "04-03-02-01");
});
