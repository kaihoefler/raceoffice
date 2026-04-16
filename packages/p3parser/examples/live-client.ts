import net, { type Socket } from "node:net";
import {
  P3Parser,
  P3StreamDecoder,
  buildDecoderSearchRequest,
  buildGetTimeRequest,
  buildSessionRequest,
  bytesToHex,
  toNodeBuffer,
  type P3BuiltRequest,
} from "../src/index.js";

const host = process.env.P3_HOST ?? "127.0.0.1";
const port = Number(process.env.P3_PORT ?? "5403");
const decoderId = process.env.P3_DECODER_ID;

const parser = new P3Parser({ strict: true, rejectOnCrcMismatch: false });
const stream = new P3StreamDecoder(parser);

const socket = net.createConnection({ host, port }, () => {
  console.log(`Connected to ${host}:${port}`);

  sendRequest(socket, buildDecoderSearchRequest());
  sendRequest(socket, buildGetTimeRequest());

  if (decoderId) {
    sendRequest(socket, buildSessionRequest(decoderId));
  }
});

socket.on("data", (chunk) => {
  const { records, bufferedHex } = stream.push(chunk);

  for (const record of records) {
    console.dir(record, { depth: null });

    if (record.unknownFields.length > 0) {
      console.log(
        "Undecoded TLVs:",
        record.unknownFields.map((field) => ({
          type: `0x${field.type.toString(16).padStart(2, "0")}`,
          length: field.length,
          rawHex: field.rawHex,
          reversedHex: field.reversedHex,
        })),
      );
    }
  }

  if (bufferedHex) {
    console.log(`Buffered tail: ${bufferedHex}`);
  }
});

socket.on("error", (error) => {
  console.error("Socket error:", error);
});

socket.on("close", () => {
  console.log("Disconnected");
});

function sendRequest(target: Socket, request: P3BuiltRequest): void {
  target.write(toNodeBuffer(request));
  console.log(`>> ${request.name}: ${request.escapedFrameHex}`);
  console.log(`   bytes=${bytesToHex(request.escapedFrame)}`);
}
