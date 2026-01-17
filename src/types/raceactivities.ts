type GenericRaceActivity<Type extends string, Data = Record<PropertyKey, never>> = {
    id: string;

    //createdBy: string;
    /**
     * ISO 8601 timestamp
     */
    createdAt: string;

    type: Type;
    data: Data;
};

// points
export type RaceActivityPointsSprint = GenericRaceActivity<
    "pointsSprint",
    {
        lap: number;
        isDeleted: boolean;
        results: { bib: number; points: number; }[];
        history: {
            changedAt: string;
            lap: number;
            isDeleted: boolean;
            results: { bib: number; points: number; }[];
        }[];
    }
>;



// eliminations
export type RaceActivityElimination = GenericRaceActivity<
    "elimination",
    {
        lap: number;
        isDeleted: boolean;
        results: { bib: number; }[];
        history: {
            changedAt: string;
            lap: number;
            isDeleted: boolean;
            results: { bib: number }[];
        }[];
    }
>;


/*
// sanctions
export type DisqualificationType = "DSQ-TF" | "DSQ-SF" | "DSQ-DF";
export type Sanction = `W${number}` | `FS${number}` | DisqualificationType;


// automatic actions
export type RaceActivityRaceStarted = GenericRaceActivity<"race.started">;
export type RaceActivityRaceEnded = GenericRaceActivity<"race.ended">;
export type RaceActivityLapStarted = GenericRaceActivity<"lap.started", { lap: number }>;

// referee
export type RaceActivityNeutralizationStarted = GenericRaceActivity<"neutralization.started">;
export type RaceActivityNeutralizationEnded = GenericRaceActivity<"neutralization.ended">;

// warning
export type RaceActivityWarningAdded = GenericRaceActivity<
    "warning.added",
    { warningId: string; athleteId: string; reason: string | null }
>;
export type RaceActivityWarningChanged = GenericRaceActivity<
    "warning.changed",
    { warningId: string; reason: string | null }
>;
export type RaceActivityWarningRemoved = GenericRaceActivity<"warning.removed", { warningId: string }>;

// false start
export type RaceActivityFalseStartAdded = GenericRaceActivity<
    "falseStart.added",
    {
        falseStartId: string;
        athleteId: string;
    }
>;
export type RaceActivityFalseStartRemoved = GenericRaceActivity<"falseStart.removed", { falseStartId: string }>;

// disqualification
export type RaceActivityDisqualificationAdded = GenericRaceActivity<
    "disqualification.added",
    {
        disqualificationId: string;
        athleteId: string;
        disqualificationType: DisqualificationType;
        reason: string | null;
    }
>;
export type RaceActivityDisqualificationChanged = GenericRaceActivity<
    "disqualification.changed",
    {
        disqualificationId: string;
        disqualificationType: DisqualificationType;
        reason: string | null;
    }
>;
export type RaceActivityDisqualificationRemoved = GenericRaceActivity<
    "disqualification.removed",
    {
        disqualificationId: string;
    }
>;

// DNF
export type RaceActivityDNFAdded = GenericRaceActivity<
    "dnf.added",
    {
        dnfId: string;
        dnfType: "dnf" | "elimination";
        athletes: {
            athleteId: string;
            flagged: boolean;
        }[];
    }
>;
export type RaceActivityDNFChanged = GenericRaceActivity<
    "dnf.changed",
    {
        dnfId: string;
        dnfType: "dnf" | "elimination";
        athletes: {
            athleteId: string;
            flagged: boolean;
        }[];
    }
>;
export type RaceActivityDNFRemoved = GenericRaceActivity<"dnf.removed", { dnfId: string }>;
export type RaceActivityDNFReorder = GenericRaceActivity<"dnf.reorder", { order: string[] }>;
*/



export type RaceActivity =
    // | RaceActivityWarningAdded
    // | RaceActivityWarningChanged
    // | RaceActivityWarningRemoved
    // | RaceActivityFalseStartAdded
    // | RaceActivityFalseStartRemoved
    // | RaceActivityDisqualificationAdded
    // | RaceActivityDisqualificationChanged
    // | RaceActivityDisqualificationRemoved
    // | RaceActivityDNFAdded
    // | RaceActivityDNFChanged
    // | RaceActivityDNFRemoved
    // | RaceActivityDNFReorder
    | RaceActivityPointsSprint
    | RaceActivityElimination
//    | RaceActivityLapCountChanged
    ;

