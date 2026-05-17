# P3 Test Client Notes (Session/Resend, Decoder ID, Unknown Fields)

This note documents practical behavior that caused confusion during diagnostics.

## 1) Decoder ID display vs wire order

The decoder frequently reports its ID in payload bytes like:

- `92 03 0C 00`

In parsed UI output this is shown (Pascal-style reversed text) as:

- `00-0C-03-92`

For `SESSION` and `RESEND` requests, sending the decoder-id in the *display* order can fail on some setups.
The frontend therefore now reverses to wire byte order before sending:

- display: `00-0C-03-92`
- sent: `92-03-0C-00`

## 2) Why RESEND could appear as `kind: "unknown"`

Earlier, TOR `0x0004` (RESEND) was intentionally left as unknown because only request building was implemented.

Current behavior:

- TOR `0x0004` is parsed as `kind: "resend"`
- mapped fields:
  - `0x01` → `fromPassingNumber` (u32 little-endian)
  - `0x02` → `toPassingNumber` (u32 little-endian)
  - `0x81` → `decoderId` (Pascal-style text form)

## 3) Unknown fields handling

`unknownFields` should only contain TLVs not mapped to typed properties.
For RESEND, the known types are now:

- `0x01`, `0x02`, `0x81`

So in a normal RESEND echo/response, these are no longer shown as unknown.

## 4) Type `0x81` in your example

Yes — in the RESEND payload shape, type `0x81` is the decoder-id field.

Example payload body:

- `0104BD6600000204C6660000810492030C00`

contains:

- `01 04 BD660000` → from passing
- `02 04 C6660000` → to passing
- `81 04 92030C00` → decoder id

## 5) Frontend convenience behavior

The standalone `p3test-frontend` now includes:

- auto-fill decoder id from incoming records
- automatic wire-order reversal for `SESSION` and `RESEND`
- `RESEND last N` button using latest known passing/session index
