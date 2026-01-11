import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type { Race } from "../types/race";
import type { AgeGroup } from "../types/agegroup";

type Props = {
    races: Race[];
    ageGroups: AgeGroup[];
    value: string;
    onChange: (raceId: string) => void;
    label?: string;
    size?: "small" | "medium";
    disabled?: boolean;
};

function sortRacesLikeActiveEvent(races: Race[], ageGroups: AgeGroup[]) {
    const agIndex = new Map<string, number>();
    ageGroups.forEach((ag, idx) => agIndex.set(ag.id, idx));

    // Sortierung: zuerst nach Reihenfolge der AgeGroups im Event, dann nach Race-Name
    return [...races].sort((a, b) => {
        const ai = agIndex.get(a.ageGroupId) ?? Number.MAX_SAFE_INTEGER;
        const bi = agIndex.get(b.ageGroupId) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
    });
}

export default function RaceSelector({
    races,
    ageGroups,
    value,
    onChange,
    label = "Race",
    size = "small",
    disabled,
}: Props) {
    const sorted = sortRacesLikeActiveEvent(races, ageGroups);

    const handleChange = (e: SelectChangeEvent<string>) => {
        const next = e.target.value;
        if (!next) return;
        onChange(next);
    };

    return (
        <FormControl size={size} sx={{ minWidth: 260 }} disabled={disabled}>
            <InputLabel id="race-selector-label">{label}</InputLabel>
            <Select
                labelId="race-selector-label"
                value={value}
                label={label}
                onChange={handleChange}
            >
                {sorted.map((r) => (
                    <MenuItem key={r.id} value={r.id} >
                        {r.name} ({r.raceStarters?.length ?? 0})
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}
