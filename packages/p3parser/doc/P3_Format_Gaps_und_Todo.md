# P3-Format: Gaps & TODO (belegt, nicht erfunden)

## Zweck

Diese Datei listet den aktuell bekannten Abstand zwischen:
- vorhandener Analyse/Dokumentation in `packages/p3parser/doc/`
- implementiertem Stand in `packages/p3parser/src/`

Es werden nur Punkte aufgenommen, die durch die vorhandenen Quellen belegt sind.

---

## 1) Discovery-Frames aus Feldanalyse vs. Builder-API

### Belegt in `packages/p3parser/doc/Notizen_Analyse.txt`

Für UDP Broadcast (`255.255.255.255`, Port `5303 -> 5403`) sind mehrere Request-Varianten notiert:

- 25 Byte:
  - `8e001900a53900000300010002000300040008000a000c008f`
- 32 Byte:
  - `8e001f00dd8daf000036000100020003000400050006000700080009000a008f`
- 23 Byte:
  - `8e001700a7f600004a000100020003000400050006008f`
- 21 Byte:
  - `8e001500338000001200010002000300040005008f`

### Aktuell in `packages/p3parser/src/builder.ts`

Jetzt vorhanden (sauber als Broadcast-Use-Case gekennzeichnet):
- `buildUdpBroadcastDiscoveryRequest25Byte()`
- `buildUdpBroadcastDiscoveryRequest32ByteObserved()`
- `buildUdpBroadcastDiscoveryRequest23ByteObserved()`
- `buildUdpBroadcastDiscoveryRequest21ByteObserved()`
- `buildDecoderSearchSmartDecoderBugRequest()`

Zusätzlich:
- `buildDecoderSearchRequest()` bleibt als rückwärtskompatibler Alias erhalten und verweist auf die 25-Byte-Broadcast-Variante.
- `P3BuiltRequest.usageScenario` trennt Nutzungsszenarien klar:
  - `udp-broadcast-discovery`
  - `direct-decoder-query`
  - `direct-decoder-control`

### TODO

- [ ] Optional: Golden-Tests für alle Broadcast-Builder ergänzen (Wire-Hex und de-escaped Frame prüfen).

---

## 2) SmartDecoder-Antwortframes aus Notizen

### Belegt in `packages/p3parser/doc/Notizen_Analyse.txt`

Notiert sind u. a. Antworten auf Discovery-Requests (z. B. 65/35/43 Byte Beispiel-Frames).

### Aktuell in Implementierung

- Parser (`packages/p3parser/src/parser.ts`) hat jetzt dedizierte Records für die beobachteten Antwort-TORs:
  - `0x0016` -> `P3NetworkSettingsRecord`
  - `0x0012` -> `P3Tor0012ObservedRecord`
  - `0x004A` -> `P3TimelineRecord`
- Für `0x0016` sind jetzt belegte semantische Felder ergänzt:
  - `ipAddress` (0x08)
  - `netmask` (0x09)
  - `defaultGateway` (0x0A)
  - `dnsServer` (0x05)
- Nicht belegte Felder bleiben über `unknownFields` erhalten.
- Es gibt weiterhin noch keine expliziten Golden-Testfälle, die genau die Notizen-Frames als Regressionsfälle absichern.

### TODO

- [ ] Golden-Tests mit exakt den in `Notizen_Analyse.txt` notierten Antwortframes anlegen.
- [ ] Parser-Output (bekannte Felder + `unknownFields`) in Test-Snapshots festhalten.

---

## 3) STATUS-Felder: vorhanden, aber bewusst nur teilweise typisiert

### Belegt

In `packages/p3parser/doc/DecoderInterface.pas` sind u. a. diese STATUS-Feldkonstanten sichtbar:
- `STATUS_SATINUSE (0x0A)`
- `STATUS_LOOP_TRIGGERS (0x0B)`

### Aktuell in Implementierung

`packages/p3parser/src/parser.ts` mappt in `parseStatus(...)` derzeit typisiert:
- Noise (`0x01`)
- GPS (`0x06`)
- Temperature (`0x07`)
- InputVoltage (`0x0C`)
- DecoderId (`0x81`)

Weitere Felder bleiben als `unknownFields` erhalten.

### TODO

- [ ] Entscheidung dokumentieren, ob `0x0A`/`0x0B` künftig als feste Properties im `P3StatusRecord` ergänzt werden sollen.
- [ ] Falls ja: erst mit ausreichend belegten Beispiel-Frames + Testfällen.

---

## 4) TOR-Abdeckung erweitern (nur evidenzbasiert)

### Belegt

`packages/p3parser/src/types.ts` enthält mehrere TOR-Konstanten.

### Aktuell in Implementierung

Typisiert geparst sind derzeit:
- PASSING (`0x0001`)
- STATUS (`0x0002`)
- VERSION_DECODER (`0x0003`)
- RESEND (`0x0004`)
- TOR `0x0012` (observed discovery response)
- SETTINGS (`0x0013` und `0x0028`, evidenzbasiert als observed/raw)
- SESSION (`0x0015`)
- NETWORK_SETTINGS (`0x0016`)
- GET_TIME (`0x0024`)
- SIGNALS (`0x002D`, evidenzbasiert als observed/raw)
- GPS_INFO (`0x0030`, evidenzbasiert als observed/raw)
- FIRST_CONTACT (`0x0045`, evidenzbasiert als observed/raw)
- TIMELINE (`0x004A`)

Andere TORs gehen weiterhin als `kind: "unknown"` durch.

### TODO

- [ ] Weitere TORs nur dann typisiert ergänzen, wenn die Feldsemantik durch Referenzcode oder stabile Capture-Daten ausreichend belegt ist.
- [ ] Für die neu ergänzten observed/raw TORs (`0x0013`, `0x0028`, `0x002D`, `0x0030`, `0x0045`) konkrete Capture-Beispiele sammeln und Feldsemantik schrittweise schärfen.
- [ ] Für jede neue TOR-Dekodierung mindestens einen nachvollziehbaren Test-Frame dokumentieren.

---

## 5) Test-/Qualitätslücken

### Aktuell sichtbar

Ein erster Golden-Testkatalog ist jetzt vorhanden (`packages/p3parser/test/golden.test.mjs`) und deckt Broadcast-Requests sowie zentrale observed Response-Frames ab.

### TODO

- [ ] Testabdeckung weiter ausbauen:
  - [ ] CRC korrekt / CRC mismatch als explizite Einzeltests
  - [ ] Escape/De-Escape Roundtrip als expliziter Einzeltest
  - [ ] weitere bekannte TOR-Beispiele (PASSING/STATUS/GET_TIME/SESSION/RESEND)
  - [ ] Recovery-Verhalten in `P3StreamDecoder`

---

## 6) Dokumentationslücke: `.docx`-Spezifikation konsolidieren

### Aktuell

`packages/p3parser/doc/P3_Protocol_Specification_Enhanced.docx` liegt vor, ist aber nicht Teil des direkt diffbaren Markdown-Wissensstandes.

### TODO

- [ ] Relevante, belegbare Inhalte aus der `.docx` in eine versionierbare `.md` überführen.
- [ ] Jede übernommene Aussage mit Quelle markieren (Pascal / Feldcapture / Spezifikation).

---

## Priorisierte Next Steps (praktisch)

1. **Golden-Tests für Notizen-Frames** (hoher Nutzen, geringes Risiko)
2. **Golden-Tests für Broadcast-Builder** (32/23/21/25 Byte + SmartDecoderBug)
3. **STATUS 0x0A/0x0B typisieren** (nur nach ausreichender Evidenz)
4. **DOCX-Inhalte in Markdown überführen** (Wissenssicherung)
