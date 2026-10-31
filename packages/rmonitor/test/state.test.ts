/**
 * Port of the Java entity tests (CompetitorTest, RaceTest, RaceClassTest) plus the RaceManager
 * rules that the golden tests showed (race change, flag mapping, displayed race).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseDuration, parseLine, RaceStateStore, toRaceTO, type CompetitorState } from "../src/index.js";

const REG = "1234BE";

function feed(store: RaceStateStore, ...lines: string[]) {
  for (const line of lines) store.apply(parseLine(line));
}

describe("Competitor (CompetitorTest)", () => {
  let store: RaceStateStore;
  const competitor = (): CompetitorState => store.current.competitors.get(REG) as CompetitorState;
  const playLapMessages = () =>
    feed(
      store,
      `$G,3,"${REG}",1,"00:01:47.872"`,
      `$J,"${REG}","00:01:47.872","00:01:47.872"`,
      `$J,"${REG}","00:01:46.749","00:03:34.621"`,
      `$G,2,"${REG}",2,"00:03:34.621"`,
    );

  beforeEach(() => {
    store = new RaceStateStore();
    feed(store, `$A,"${REG}","12X",52474,"John","Johnson","USA",5`);
  });

  it("adds laps", () => {
    playLapMessages();
    const [lap1, lap2] = competitor().lapList;
    expect(lap1).toEqual({
      lapNumber: 1,
      position: 3,
      lapTimeMs: parseDuration("00:01:47.872"),
      totalTimeMs: parseDuration("00:01:47.872"),
    });
    expect(lap2).toEqual({
      lapNumber: 2,
      position: 2,
      lapTimeMs: parseDuration("00:01:46.749"),
      totalTimeMs: parseDuration("00:03:34.621"),
    });
  });

  it("calculates the average lap", () => {
    expect(competitor().avgLapMs).toBe(0);
    playLapMessages();
    expect(competitor().avgLapMs).toBeCloseTo(parseDuration("00:01:47.3105"), 6);
  });

  it("finds a competitor by position, the fastest lap and the position in class", () => {
    playLapMessages();
    expect(store.current.getCompetitorByPosition(2)).toBe(competitor());
    expect(store.current.fastestLapMs).toBe(parseDuration("00:01:46.749"));
    expect(store.current.calcPositionInClass(competitor())).toBe(1);
  });

  it("updates from $A", () => {
    feed(store, `$A,"${REG}","123",54321,"Jack","Jackson","MX",6`);
    expect(competitor()).toMatchObject({
      number: "123",
      transNumber: "54321",
      firstName: "Jack",
      lastName: "Jackson",
      nationality: "MX",
      classId: 6,
    });
  });

  it("keeps nationality when $COMP sends it empty", () => {
    feed(store, `$COMP,"${REG}","12X",5,"John","Johnson","",""`);
    expect(competitor().nationality).toBe("USA");
  });

  it("updates from $SP", () => {
    feed(store, `$SP,3,"${REG}",2,"00:01:33.894",76682`);
    expect(competitor().lapList.find((l) => l.lapNumber === 2)?.lapTimeMs).toBe(parseDuration("00:01:33.894"));
    feed(store, `$SP,3,"${REG}",3,"00:01:31.123",76682`);
    expect(competitor().bestLapMs).toBe(parseDuration("00:01:31.123"));
  });

  it("updates from $J", () => {
    feed(store, `$J,"${REG}","01:12:47.872","01:12:47.872"`);
    expect(competitor().lastLapMs).toBe(parseDuration("01:12:47.872"));
    expect(competitor().totalTimeMs).toBe(parseDuration("01:12:47.872"));
  });

  it("updates from $H", () => {
    feed(store, `$H,1,"${REG}",1,"01:12:47.872"`);
    expect(competitor().bestLapMs).toBe(parseDuration("01:12:47.872"));
    expect(competitor().qualiPosition).toBe(1);
  });

  it("updates from $G", () => {
    feed(store, `$G,3,"${REG}",14,"01:12:47.872"`);
    expect(competitor()).toMatchObject({ position: 3, lapsComplete: 14, totalTimeMs: parseDuration("01:12:47.872") });
  });
});

describe("Race (RaceTest)", () => {
  let store: RaceStateStore;
  beforeEach(() => {
    store = new RaceStateStore();
  });

  it("applies the heartbeat", () => {
    feed(store, '$F,14,"00:12:45","13:34:23","00:09:47","Green"');
    const race = store.current;
    expect(race.elapsedMs).toBe(parseDuration("00:09:47"));
    expect(race.lapsToGo).toBe(14);
    expect(race.timeToGoMs).toBe(parseDuration("00:12:45"));
    expect(race.scheduledTimeMs).toBe(parseDuration("00:22:32"));
    expect(race.timeOfDayMs).toBe(parseDuration("13:34:23"));
    expect(race.flagStatus).toBe("GREEN");
  });

  it("counts competitor changes in rev", () => {
    const before = store.rev;
    feed(store, `$G,3,"${REG}",14,"01:12:47.872"`);
    expect(store.rev).toBe(before + 1);
  });

  it("applies run info", () => {
    feed(store, '$B,5,"Friday free practice"');
    expect(store.current.name).toBe("Friday free practice");
    expect(store.current.id).toBe(5);
  });

  it("applies settings", () => {
    feed(store, '$E,"TRACKNAME","Indianapolis Motor Speedway"', '$E,"TRACKLENGTH","2.500"');
    expect(store.current.trackName).toBe("Indianapolis Motor Speedway");
    expect(store.current.trackLength).toBe(2.5);
  });

  it("ignores an unparsable track length", () => {
    feed(store, '$E,"TRACKLENGTH","0.200"', '$E,"TRACKLENGTH","abc"');
    expect(store.current.trackLength).toBe(0.2);
  });
});

describe("classes (RaceClassTest)", () => {
  it("updates the class name", () => {
    const store = new RaceStateStore();
    expect(store.getClassName(5)).toBe("");
    feed(store, '$C,5,"Formula 300"');
    expect(store.getClassName(5)).toBe("Formula 300");
    feed(store, '$C,5,"Formula 1000"');
    expect(store.getClassName(5)).toBe("Formula 1000");
  });
});

describe("RaceManager rules", () => {
  let store: RaceStateStore;
  beforeEach(() => {
    store = new RaceStateStore();
  });

  it.each([
    ["Green ", "GREEN"],
    ["yellow", "YELLOW"],
    ["Red", "RED"],
    ["Finish", "FINISH"],
    ["Purple", "PURPLE"],
    ["      ", "PURPLE"],
    ["Test", "PURPLE"],
  ])("maps flag %j to %s", (flag, expected) => {
    feed(store, '$B,7,"Race"', `$F,0,"00:00:00","12:00:00","00:00:00","${flag}"`);
    expect(store.current.flagStatus).toBe(expected);
  });

  it("maps an empty flag to NONE only for race id 0 without a name", () => {
    feed(store, '$B,0,""', '$F,0,"00:00:00","12:00:00","00:00:00","      "');
    expect(store.current.flagStatus).toBe("NONE");
  });

  it("$B sets the flag to PURPLE (empty flag after the name is set)", () => {
    feed(store, '$F,0,"00:00:00","12:00:00","00:00:00","Green "', '$B,7,"Race"');
    expect(store.current.flagStatus).toBe("PURPLE");
  });

  it("a new $B id finishes the old race and makes it previous", () => {
    feed(store, '$B,1,"First"', '$A,"1","1",T1,"A","B","GER",1', '$B,2,"Second"');
    expect(store.current.id).toBe(2);
    expect(store.current.competitors.size).toBe(0);
    expect(store.previous?.id).toBe(1);
    expect(store.previous?.flagStatus).toBe("FINISH");
    expect(store.all.map((r) => r.id)).toEqual([1, 2]);
  });

  it("a repeated $B with the same id keeps the race", () => {
    feed(store, '$B,1,"First"', '$A,"1","1",T1,"A","B","GER",1', '$B,1,"First (renamed)"');
    expect(store.current.competitors.size).toBe(1);
    expect(store.current.name).toBe("First (renamed)");
  });

  it("$I always starts a new race; the REST race falls back to the previous one", () => {
    feed(store, '$B,1,"First"', '$I,"12:00:00","1 jan 20"');
    expect(store.current.id).toBe(-1);
    expect(store.previous?.id).toBe(1);
    expect(store.displayRace.id).toBe(1);
    feed(store, '$I,"12:00:00","1 jan 20"', '$A,"9","9",T9,"Lost","Rider","GER",1', '$B,2,"Second"');
    // Competitors between $I and a $B with a new id are dropped, exactly like Java.
    expect(store.current.id).toBe(2);
    expect(store.current.competitors.size).toBe(0);
    expect(store.previous?.id).toBe(1);
  });

  it("$G position 1 sets the race laps", () => {
    feed(store, '$B,1,"R"', '$G,2,"5",3,"00:01:00"', '$G,1,"6",4,"00:01:00"');
    expect(store.current.lapsComplete).toBe(4);
  });

  it("ignores unknown and invalid lines without changing rev", () => {
    const rev = store.rev;
    expect(store.apply(parseLine('$RMS,"x"')).changed).toBe(false);
    expect(store.apply(parseLine("$B,x")).changed).toBe(false);
    expect(store.rev).toBe(rev);
  });

  it("caps the number of stored races but keeps current and previous", () => {
    const small = new RaceStateStore({ maxRaces: 3 });
    for (let id = 1; id <= 6; id++) feed(small, `$B,${id},"R${id}"`);
    expect(small.all.map((r) => r.id)).toEqual([4, 5, 6]);
    expect(small.previous?.id).toBe(5);
  });
});

describe("toRaceTO", () => {
  it("produces the Java RaceTO field order and sorts by position (unclassified last)", () => {
    const store = new RaceStateStore();
    feed(
      store,
      '$B,3,"Elimination"',
      '$E,"TRACKNAME","Groß-Gerau"',
      '$E,"TRACKLENGTH","0.200"',
      '$A,"1","11",T1,"Max","Muster (GER)","GER",1',
      '$A,"2","12",T2,"Erika","Muster (GER)","GER",1',
      '$A,"3","13",T3,"Nobody","Yet","GER",1',
      '$G,2,"1",3,"00:01:02.500"',
      '$G,1,"2",3,"00:01:02.000"',
      '$F,7,"00:00:00","14:03:22","00:04:12","Green "',
    );
    const to = toRaceTO(store.current);
    expect(Object.keys(to)).toEqual([
      "raceName",
      "raceID",
      "flagStatus",
      "elapsedTime",
      "timeOfDay",
      "lapsComplete",
      "lapsToGo",
      "trackName",
      "trackLength",
      "competitors",
    ]);
    expect(to).toMatchObject({
      raceName: "Elimination",
      raceID: 3,
      flagStatus: "GREEN",
      elapsedTime: "4:12",
      timeOfDay: "14:03:22",
      lapsComplete: 3,
      lapsToGo: 7,
      trackName: "Groß-Gerau",
      trackLength: 0.2,
    });
    expect(to.competitors.map((c) => c.number)).toEqual(["12", "11", "13"]);
    expect(Object.keys(to.competitors[0] ?? {})).toEqual([
      "number",
      "position",
      "lapsComplete",
      "firstName",
      "lastName",
      "totalTime",
      "bestLap",
      "lastLap",
      "qualiPosition",
    ]);
    expect(to.competitors[2]).toMatchObject({ totalTime: "0:00", bestLap: "0:00", lastLap: "0:00", position: 0 });
  });
});
