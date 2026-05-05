# Feature-Plan

---

## Feature 1: „Änderungen seit den letzten Messungen"

### Was es ist
Ein Widget direkt unter dem Gesundheitsstatus-Widget auf dem Dashboard. Es erscheint nur wenn es tatsächlich neue Messungen von bereits früher gemessenen Werten gibt. Es zeigt eine Liste der geänderten Werte mit Deltas und eine KI-Bewertung.

### 5-Tage-Fenster-Logik
- Kommen neue Dokumente rein, die **bereits gemessene Werte** erneut liefern (Überschneidung per LOINC-Code oder display_name), öffnet sich ein 5-Tage-Fenster ab dem Zeitpunkt des ersten solchen Uploads.
- Alle weiteren Uploads **innerhalb dieser 5 Tage**, die ebenfalls bekannte Werte updaten, werden zur selben „Messsession" gezählt.
- Das Widget vergleicht immer: alle Werte aus dem aktiven Fenster **vs.** die jeweils letzten Werte von davor.
- Nach 5 Tagen schließt das Fenster. Die Werte aus dem Fenster gelten fortan als „alte Werte". Das nächste überschneidende Upload öffnet ein neues Fenster.

### Datenbank
Neue Tabelle `measurement_sessions`:
```sql
id            uuid primary key default gen_random_uuid()
started_at    timestamptz not null
ends_at       timestamptz not null  -- started_at + 5 Tage
```

### Ablauf bei Extraktion (in extract/[id]/route.ts)
1. Nach dem Einfügen der neuen Observations: prüfen ob irgendeine davon einen LOINC-Code oder display_name hat, der bereits in einem **anderen** Dokument existiert.
2. Wenn ja: aktive Session suchen (`ends_at > now()`).
   - Keine aktive Session → neue anlegen (`started_at = now()`, `ends_at = now() + 5d`).
   - Aktive Session vorhanden → nichts tun (Fenster läuft bereits).
3. Wenn nein (nur neue, noch nie gemessene Werte) → nichts tun.

### API: GET /api/changes
Gibt zurück:
- `session`: aktive oder zuletzt abgeschlossene Session (oder `null` wenn noch nie eine)
- `changes`: Array mit je `{ display_name, unit, old_value, new_value, delta_absolute, delta_percent, status }`
- `summary`: KI-generierter Bewertungstext (gecacht in DB, wird bei Session-Änderung neu generiert)

**Logik für „old_value" vs „new_value":**
- new_value = neuester Wert mit `measured_at >= session.started_at`
- old_value = neuester Wert mit `measured_at < session.started_at`
- Nur Werte einschließen bei denen beide vorhanden sind

### KI-Prompt (für summary)
- Liste der Änderungen als Text übergeben
- Claude bewertet: was ist gut, was ist schlecht, motivierender Ton
- Kurz: 3–5 Sätze

### Widget-Aufbau (in page.tsx, unter Gesundheitsstatus)
```
┌─────────────────────────────────────────────┐
│ Änderungen seit den letzten Messungen        │
│ (Datum der Session)                          │
│                                              │
│  Ruhepuls          68 → 61 bpm   −10 %  ✓  │
│  Bauchumfang       94 → 91 cm    −3 cm   ✓  │
│  LDL-Cholesterin   3.8 → 4.1     +8 %   ✗  │
│  ...                                         │
│                                              │
│  [KI-Bewertungstext]                         │
└─────────────────────────────────────────────┘
```
- Positive Deltas bei Werten die besser sein sollten (z.B. Gewicht, LDL): rot
- Positive Deltas bei Werten die steigen sollten (z.B. Vitamin D): grün
- Status-Logik: `clinical_severity` des neuen Werts bestimmt die Ampelfarbe

### Caching
`summary`-Text in einer neuen Tabelle `changes_summary` speichern (`session_id`, `summary`, `generated_at`). Nur neu generieren wenn sich die Session geändert hat.

---

## Feature 2: Messwert-Verlaufsgraph (Modal)

### Was es ist
Auf jeder Messwert-Karte im Messwerte-Tab: kleiner Button (Chart-Icon) rechts oben. Nur aktiv wenn der Wert **mindestens 2× gemessen** wurde. Bei einmaligen Werten: Button ausgegraut oder gar nicht anzeigen.

Klick öffnet ein Modal (zentral, mit Margin auf allen Seiten, Rest gedimmt).

### Modal-Inhalt
- Titel: display_name + unit
- Liniendiagramm:
  - X-Achse: Messdaten (chronologisch)
  - Y-Achse: Werte — Achse so skalieren dass die Datenpunkte zentral liegen (nicht zwingend bei 0 starten), ggf. mit etwas Padding über/unter Min/Max
  - Optional: horizontale Referenzbereich-Linien (reference_range_low / high) in Hellgrün/Hellrot
- Schließen per Klick außerhalb oder X-Button

### Bibliothek
**Recharts** — passt gut zu React/Next.js, leichtgewichtig, keine Canvas-Abhängigkeit.
`npm install recharts`

### Daten
Neuer API-Endpunkt `GET /api/observations/[name]/history` (oder per Query-Parameter an bestehenden Observations-Endpunkt):
- Gibt alle Observations mit diesem `display_name` oder `loinc_code` zurück, sortiert nach `measured_at` aufsteigend
- Nur Werte mit `value != null` (keine qualitativen Befunde)

### Umsetzung in page.tsx
- State: `historyModal: { name: string; loinc: string | null } | null`
- Button auf Karte: nur rendern wenn `multipleDataPoints` (vorab berechnen: wie oft kommt dieser Name/LOINC in `deduped`-Basis-Array vor — nein, eigentlich in allen `observations` inkl. Duplikate)
- Modal als absolutes Overlay über dem gesamten Viewport

---

---

## Feature 3: Trend-Indikator auf Messwert-Karten

### Was es ist
Auf Messwert-Karten im Messwerte-Tab, bei denen **mindestens 2 Messungen** vorliegen: ein kleines visuelles Symbol das anzeigt ob sich der Wert seit der letzten Messung **verbessert oder verschlechtert** hat. Kein Pfeil oben/unten (da richtungsabhängig), stattdessen ein einfaches Gut/Schlecht-Signal.

### Vorschlag für das visuelle Element
- Kleines Mini-Graph-Icon (2–3 Datenpunkte angedeutet): grün + steigend = besser, rot + fallend = schlechter
- Oder: grüner/roter Punkt mit Checkmark/X
- Platzierung: auf der Karte, z.B. neben dem Statusbadge oder unten rechts

### Logik: Was bedeutet „besser"?
Vergleich über Rohwert + Referenzbereich — präziser als `clinical_severity`, weil zwei leicht unterschiedliche Werte (z.B. LDL 4.5 vs. 4.2) oft dieselbe `clinical_severity`-Integer bekommen und der Trend dann unsichtbar bliebe.

**Primär: Referenzbereich-basiert**
- Wert **über** `reference_range_high` → Richtung sinken ist besser → neuer Wert < alter Wert = grün
- Wert **unter** `reference_range_low` → Richtung steigen ist besser → neuer Wert > alter Wert = grün
- Wert **im Referenzbereich** bei beiden Messungen → kein Indikator (beide normal)
- Wert **wechselt** von außerhalb in den Referenzbereich → immer grün
- Wert **wechselt** von innerhalb nach außerhalb → immer rot

**Fallback: `clinical_severity`**
Wenn kein Referenzbereich vorhanden (z.B. qualitative Befunde oder fehlende Range): `new_severity < old_severity` = grün, `>` = rot, gleich = kein Indikator.

### Daten
Kein neuer API-Aufruf nötig. Die `observations`-Liste enthält ohnehin alle Duplikate (vor Deduplizierung). Aus dieser Liste die zwei neuesten Einträge pro LOINC/name heraussuchen und `clinical_severity` vergleichen.

---

## Feature 4: Tages-Empfehlung im Schlachtplan

### Was es ist
Im Schlachtplan-Tab, **zwischen dem Summary-Widget und den vier Sub-Tabs**: ein kompaktes Widget das zeigt was man **heute** konkret tun sollte. Mindestens eine Übung und ein Supplement. Wechselt täglich.

### Aufbau
```
┌─────────────────────────────────────────────┐
│ Heute · Dienstag, 6. Mai                     │
│                                              │
│ 🏃 Nasenatemspaziergang  30–40 Min.          │
│ 💊 Magnesium (Citrat)    300 mg abends       │
└─────────────────────────────────────────────┘
```
Kleine, kompakte Karte. Kein separates Sub-Tab, keine Einstellungen.

### Rotationslogik (rein client-seitig, kein neues DB-Schema)
- Basis: **Day-of-year** (1–365) modulo Anzahl Items in der jeweiligen Kategorie
- `todayExercise = exercises[dayOfYear % exercises.length]`
- `todaySupplement = supplements[dayOfYear % supplements.length]`
- Ergibt eine deterministische, täglich wechselnde Auswahl die für jeden Tag reproduzierbar ist
- Bei Supplements: da 8 Einträge und 7 Wochentage → kein simples Wochentag-Muster, aber dayOfYear gibt trotzdem volle Rotation über alle Supplements

### Optionale Erweiterung (nicht für erste Version)
Habits und Ernährung ebenfalls rotieren. Oder: nicht nur 1 Übung sondern 1–2 je nachdem ob es eine Kraft- oder Ausdauerübung ist.

### Implementierung
- Rein in `page.tsx`, keine neue API-Route
- Nur anzeigen wenn `actionPlanItems.length > 0` und nicht `actionPlanGenerating`

---

## Reihenfolge / Priorität

1. Feature 2 (Verlaufsgraph) — einfacher, in sich abgeschlossen, kein neues DB-Schema nötig
2. Feature 3 (Trend-Indikator) — ebenfalls kein neues DB-Schema, nur Deduplizierungslogik nutzen
3. Feature 4 (Tages-Empfehlung) — rein client-seitig, schnell umsetzbar
4. Feature 1 (Änderungs-Widget) — komplexer wegen 5-Tage-Logik und neuem DB-Schema
