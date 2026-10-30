/**
 * Port of the Java JUnit parser tests (message/*Test.java, MessageFactoryTest, FactoryTest)
 * plus the Java error behavior (invalid lines are dropped, never thrown).
 */
import { describe, expect, it } from "vitest";
import { parseDuration, parseLine, tokenize, type RMonitorMessage } from "../src/index.js";

function parse<K extends RMonitorMessage["kind"]>(line: string, kind: K): Extract<RMonitorMessage, { kind: K }> {
  const msg = parseLine(line);
  expect(msg.kind).toBe(kind);
  return msg as Extract<RMonitorMessage, { kind: K }>;
}

describe("tokenize (MessageFactoryTest)", () => {
  it("keeps a comma inside quotes", () => {
    expect(tokenize('$E,"TRACKNAME","Arena, Geisingen"')).toEqual(["$E", "TRACKNAME", "Arena, Geisingen"]);
  });

  it("handles a quoted last token", () => {
    expect(tokenize('$E,"TRACKNAME","Arena Geisingen"')).toEqual(["$E", "TRACKNAME", "Arena Geisingen"]);
  });

  it("handles an unquoted last token and quoted empty tokens", () => {
    expect(tokenize('$A,"1","1",1001,"","","",1')).toEqual(["$A", "1", "1", "1001", "", "", "", "1"]);
  });

  it("keeps unquoted empty tokens", () => {
    expect(tokenize('$SR,40,"40",,"00:00:00",0')).toEqual(["$SR", "40", "40", "", "00:00:00", "0"]);
  });

  it("keeps whitespace, escaped quotes and a trailing empty token", () => {
    expect(tokenize('$F,0,"00:00:00","13:51:48","00:00:00","      "')[5]).toBe("      ");
    expect(tokenize('$B,1,"Say ""hi"""')).toEqual(["$B", "1", 'Say "hi"']);
    expect(tokenize("$C,1,")).toEqual(["$C", "1", ""]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("parsers (JUnit ports)", () => {
  it("$C ClassInfo", () => {
    const m = parse('$C,5,"Formula 300"', "classInfo");
    expect(m.classId).toBe(5);
    expect(m.description).toBe("Formula 300");
  });

  it("$A CompInfo", () => {
    const m = parse('$A,"1234BE","12X",52474,"John","Johnson","USA",5', "compInfo");
    expect(m).toMatchObject({
      source: "$A",
      regNumber: "1234BE",
      number: "12X",
      transNumber: "52474",
      firstName: "John",
      lastName: "Johnson",
      nationality: "USA",
      classId: 5,
      addData: null,
    });
  });

  it("$COMP CompInfo", () => {
    const m = parse('$COMP,"1234BE","12X",5,"John","Johnson","USA","CAMEL"', "compInfo");
    expect(m).toMatchObject({
      source: "$COMP",
      regNumber: "1234BE",
      number: "12X",
      transNumber: null,
      firstName: "John",
      lastName: "Johnson",
      nationality: "USA",
      classId: 5,
      addData: "CAMEL",
    });
  });

  it("$F Heartbeat (flag trimmed, case kept)", () => {
    const m = parse('$F,14,"00:12:45","13:34:23","00:09:47","Green "', "heartbeat");
    expect(m.lapsToGo).toBe(14);
    expect(m.timeToGoMs).toBe(parseDuration("00:12:45"));
    expect(m.timeOfDayMs).toBe(parseDuration("13:34:23"));
    expect(m.raceTimeMs).toBe(parseDuration("00:09:47"));
    expect(m.flag).toBe("Green");
  });

  it("$I InitRecord", () => {
    const m = parse('$I,"16:36:08.000","12 jan 01"', "initRecord");
    expect(m.timeOfDayMs).toBe(parseDuration("16:36:08.000"));
    expect(m.date).toBe("12 jan 01");
  });

  it("$SP LapInfo", () => {
    const m = parse('$SP,3,"2",2,"00:01:33.894",76682', "lapInfo");
    expect(m).toMatchObject({ source: "$SP", position: 3, regNumber: "2", lapNumber: 2 });
    expect(m.lapTimeMs).toBe(parseDuration("00:01:33.894"));
  });

  it("$SR LapInfo with empty lap number → 0", () => {
    const m = parse('$SR,1,"857",,"00:00:00",0', "lapInfo");
    expect(m.lapNumber).toBe(0);
  });

  it("$J PassingInfo", () => {
    const m = parse('$J,"1234BE","00:02:03.826","01:42:17.672"', "passingInfo");
    expect(m.regNumber).toBe("1234BE");
    expect(m.lapTimeMs).toBe(parseDuration("00:02:03.826"));
    expect(m.totalTimeMs).toBe(parseDuration("01:42:17.672"));
  });

  it("$H QualiInfo", () => {
    const m = parse('$H,2,"1234BE",3,"00:02:17.872"', "qualiInfo");
    expect(m).toMatchObject({ position: 2, regNumber: "1234BE", bestLap: 3 });
    expect(m.bestLapTimeMs).toBe(parseDuration("00:02:17.872"));
  });

  it("$G RaceInfo, empty laps → 0", () => {
    const m = parse('$G,3,"1234BE",14,"01:12:47.872"', "raceInfo");
    expect(m).toMatchObject({ position: 3, regNumber: "1234BE", laps: 14 });
    expect(m.totalTimeMs).toBe(parseDuration("01:12:47.872"));
    expect(parse('$G,1,"679",,"00:00:00"', "raceInfo").laps).toBe(0);
  });

  it("$B RunInfo", () => {
    const m = parse('$B,5,"Friday free practice"', "runInfo");
    expect(m.uniqueId).toBe(5);
    expect(m.description).toBe("Friday free practice");
  });

  it("$E SettingInfo", () => {
    expect(parse('$E,"TRACKNAME","Indianapolis Motor Speedway"', "settingInfo")).toMatchObject({
      description: "TRACKNAME",
      value: "Indianapolis Motor Speedway",
    });
    expect(parse('$E,"TRACKLENGTH","2.500"', "settingInfo").value).toBe("2.500");
  });
});

describe("Java error behavior", () => {
  it("unknown prefix → unknown", () => {
    expect(parseLine('$RMS,"x"')).toEqual({ kind: "unknown", prefix: "$RMS", raw: '$RMS,"x"' });
  });

  it.each([
    ["missing field", "$B,5"],
    ["non-numeric integer", '$B,x,"Race"'],
    ["empty integer where Java has no default", '$F,,"00:00:00","13:00:00","00:00:00","Green"'],
    ["empty time", '$J,"12","","00:01:00"'],
    ["one-digit hour", '$J,"12","0:00:01","00:01:00"'],
    ["hour 24", '$I,"24:00:00","1 jan 20"'],
    ["empty line", ""],
  ])("%s → invalid", (_label, line) => {
    expect(parseLine(line).kind).toBe("invalid");
  });
});
