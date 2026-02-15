import { useMemo, useState, type FocusEvent, type ReactNode } from "react";
import { InputAdornment, TextField, Typography } from "@mui/material";

import Autocomplete, {
  type AutocompleteInputChangeReason,
} from "@mui/material/Autocomplete";

import type { FilterOptionsState } from "@mui/material/useAutocomplete";

import type { Athlete } from "../types/athlete";

export type AthleteFilterOptions = (options: Athlete[], state: FilterOptionsState<Athlete>) => Athlete[];

type Props = {
  value: Athlete | null;
  inputValue: string;
  options: Athlete[];
  inputRef?: React.Ref<HTMLInputElement>;

  filterOptions: AthleteFilterOptions;
  formatOption: (a: Athlete) => string;
  resolveByBib: (bibText: string) => Athlete | null;

  onInputValueChange: (nextInput: string, reason: AutocompleteInputChangeReason) => void;
  onSelect: (next: Athlete | null) => void;

  /** Called when user presses Enter in the input. */
  onEnter?: () => void;

  /** Optional UI */
  placeholder?: string;
  nameAdornmentMaxWidth?: number;
  disabled?: boolean;
};

function athleteName(a: Athlete): string {
  return `${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

export default function PointsBibField({
  value,
  inputValue,
  options,
  inputRef,
  filterOptions,
  formatOption,
  resolveByBib,
  onInputValueChange,
  onSelect,
  onEnter,
  placeholder = "Startnummer",
  nameAdornmentMaxWidth = 160,
  disabled = false,
}: Props) {
  const [isFocused, setIsFocused] = useState(false);

  const nameText = useMemo(() => (value ? athleteName(value) : ""), [value]);

  const nameAdornment: ReactNode =
    !isFocused && nameText ? (
      <InputAdornment position="end">
        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: nameAdornmentMaxWidth }}>
          {nameText}
        </Typography>
      </InputAdornment>
    ) : null;

  return (
    <Autocomplete
      size="small"
      disabled={disabled}
      options={options}
      value={value}
      inputValue={inputValue}
      open={Boolean(inputValue.trim()) && !value}
      onInputChange={(_, v, reason) => onInputValueChange(v, reason)}
      onChange={(_, v) => {
        const next = (typeof v === "string" ? resolveByBib(v) : v) as Athlete | null;
        onSelect(next);
      }}
      filterOptions={filterOptions}
      autoHighlight
      openOnFocus={false}
      freeSolo
      isOptionEqualToValue={(o, v) => o.id === v.id}
      getOptionLabel={(o) => (typeof o === "string" ? o : String(o.bib ?? ""))}
      renderOption={(props, o) => <li {...props}>{formatOption(o)}</li>}
      renderInput={(params) => {
        const { inputProps, InputProps, InputLabelProps, ...rest } = params;

        return (
          <TextField
            {...rest}
            inputRef={inputRef}
            placeholder={placeholder}
            slotProps={{
              input: {
                ...InputProps,
                endAdornment: (
                  <>
                    {nameAdornment}
                    {InputProps?.endAdornment}
                  </>
                ),
              },
              inputLabel: InputLabelProps,
              htmlInput: {
                ...inputProps,
                inputMode: "numeric",
                onFocus: (e: FocusEvent<HTMLInputElement>) => {
                  (inputProps as any).onFocus?.(e);
                  setIsFocused(true);
                },
                onBlur: (e: FocusEvent<HTMLInputElement>) => {
                  (inputProps as any).onBlur?.(e);
                  setIsFocused(false);
                },
              },
            }}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return;
              onEnter?.();
            }}
          />
        );
      }}
    />
  );
}
