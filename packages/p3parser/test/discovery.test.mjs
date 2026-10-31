/**
 * Loopback tests for P3DecoderDiscovery.
 *
 * A fake decoder (UDP socket on 127.0.0.1) answers the first discovery request
 * with captured reply frames (see golden.test.mjs). Decoders answer with
 * NETWORK_SETTINGS / TIMELINE rather than VERSION_DECODER, so the result must
 * be assembled from those.
 */
import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";

import { P3DecoderDiscovery } from "../dist/index.js";

const NETWORK_SETTINGS_REPLY =
  "8E024100106C0000160002043BC9A8C0070101030400FFFFFF040401C9A8C005040808080806010008043BC9A8C0090400FFFFFF0A0401C9A8C0810492030C008F";
const TIMELINE_REPLY = "8E022B0046F100004A000106534620506974020401040000030403000000040404000000810492030C008F";

async function startFakeDecoder(replies) {
  const socket = dgram.createSocket("udp4");
  const requests = [];
  socket.on("message", (msg, rinfo) => {
    requests.push(msg.toString("hex").toUpperCase());
    if (requests.length > 1) return;
    for (const reply of replies) socket.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return { socket, port: socket.address().port, requests };
}

test("discovery: builds decoder from NETWORK_SETTINGS + TIMELINE replies, keyed by source ip", async () => {
  const fake = await startFakeDecoder([
    Buffer.from(NETWORK_SETTINGS_REPLY, "hex"),
    Buffer.from(TIMELINE_REPLY, "hex"),
    Buffer.from("DEADBEEF", "hex"),
  ]);
  const parseErrors = [];

  try {
    const decoders = await new P3DecoderDiscovery(
      { onParseError: (error) => parseErrors.push(error) },
      { port: fake.port, localPort: 0, broadcastAddresses: ["127.0.0.1"] },
    ).run(300);

    // All request variants are sent.
    assert.equal(fake.requests.length, 5);

    assert.equal(decoders.length, 1);
    const [decoder] = decoders;
    assert.equal(decoder.ip, "127.0.0.1");
    assert.equal(decoder.port, fake.port);
    assert.equal(decoder.decoderId, "00-0C-03-92");
    assert.equal(decoder.timelineName, "SF Pit");
    assert.equal(decoder.decoderType, null);
    assert.deepEqual(decoder.network, {
      ipAddress: "192.168.201.59",
      netmask: "255.255.255.0",
      defaultGateway: "192.168.201.1",
      dnsServer: "8.8.8.8",
    });
    assert.equal(decoder.responseCount, 2);
    assert.equal(decoder.torNames.length, 2);

    assert.equal(parseErrors.length, 1);
  } finally {
    fake.socket.close();
  }
});

test("discovery: run() rejects when the local reply port is already bound", async () => {
  const blocker = dgram.createSocket("udp4");
  await new Promise((resolve) => blocker.bind(0, "0.0.0.0", resolve));

  try {
    await assert.rejects(
      P3DecoderDiscovery.scan(300, { localPort: blocker.address().port, broadcastAddresses: ["127.0.0.1"] }),
      (error) => error.code === "EADDRINUSE",
    );
  } finally {
    blocker.close();
  }
});

import { decoderIdToRequestOrder } from "../dist/index.js";

test("decoderIdToRequestOrder reverses the display order for SESSION/RESEND", () => {
  assert.equal(decoderIdToRequestOrder("00-0C-03-92"), "92-03-0C-00");
  assert.equal(decoderIdToRequestOrder("40240400"), "00-04-24-40");
  assert.equal(decoderIdToRequestOrder("abc"), "abc");
});
