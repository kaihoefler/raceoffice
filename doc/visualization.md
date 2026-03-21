# Visualization – skipped rows indicator (`...`)

## Zweck

Die Option `showSkippedRowsIndicator` steuert, ob in der Tabelle eine zusätzliche `...`-Zeile angezeigt wird, wenn Fahrer ohne darstellbares Resultat zwischen sichtbaren Ergebnissen liegen.

Darstellbares Resultat bedeutet in `VisualizerPage` aktuell z. B.:

- `dsq === true`
- `dnf !== false` (also `"dnf"` oder `"elimination"`)
- `finishRank > 0`
- `points !== 0`

## Konfiguration

Im `FullVisualization`-Dokument:

```json doc/visualization.md
{
  "showSkippedRowsIndicator": true
}
```

Oder über den Editor:

- **Visualization Editor** → **Show skipped rows indicator** → `Yes`

## Verhalten

Wenn `showSkippedRowsIndicator = true`:

- Fahrer ohne darstellbares Resultat werden weiterhin ausgeblendet.
- Für jeden zusammenhängenden Block solcher ausgeblendeten Fahrer wird genau **eine** `...`-Zeile eingefügt.
- In der Standardtabelle steht `...` in der Rank-Spalte.
- In dynamischen Spalten wird `...` nur in einer Spalte mit Titel `Rank` gerendert.

Wichtig für DNS:

- DNS-Zeilen werden **nie** angezeigt.
- DNS-Zeilen erzeugen **nie** eine `...`-Zeile.

## Beispiel

Sortierte Reihenfolge (vereinfacht):

1. Rank 1 (sichtbar)
2. Rank 2 (sichtbar)
3. Rank 3 (kein Resultat) → ausgeblendet
4. Rank 4 (kein Resultat) → ausgeblendet
5. Rank 5 (DNF/Elim) → sichtbar

Mit `showSkippedRowsIndicator = true` wird angezeigt:

1. Rank 1
2. Rank 2
3. `...`
4. Rank 5

Mit `showSkippedRowsIndicator = false` wird angezeigt:

1. Rank 1
2. Rank 2
3. Rank 5
