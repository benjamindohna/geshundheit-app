import { supabase } from './supabase'
import { anthropic } from './anthropic'

const BIRTH_DATE = new Date('1975-07-11')

function getActualAge(): number {
  const today = new Date()
  let age = today.getFullYear() - BIRTH_DATE.getFullYear()
  const m = today.getMonth() - BIRTH_DATE.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < BIRTH_DATE.getDate())) age--
  return age
}

type ObsRow = {
  display_name: string
  value: number | null
  value_text: string | null
  unit: string | null
  status: string
  clinical_severity: number
  measured_at: string
  reference_range_low: number | null
  reference_range_high: number | null
  reference_range_text: string | null
}

export async function fetchObsText(): Promise<string> {
  const { data } = await supabase
    .from('observations')
    .select('display_name,value,value_text,unit,status,clinical_severity,measured_at,reference_range_low,reference_range_high,reference_range_text')
    .order('measured_at', { ascending: false })

  if (!data || data.length === 0) return ''

  const seen = new Set<string>()
  const deduped = (data as ObsRow[]).filter((o) => {
    if (seen.has(o.display_name)) return false
    seen.add(o.display_name)
    return true
  })

  return deduped.map((o) => {
    const val = o.value != null ? `${o.value}${o.unit ? ' ' + o.unit : ''}` : (o.value_text ?? '–')
    const ref = o.reference_range_text
      || (o.reference_range_low != null ? `${o.reference_range_low}–${o.reference_range_high}` : null)
    return `${o.display_name}: ${val}${ref ? ` (Ref: ${ref})` : ''} [${o.status}, Schwere ${o.clinical_severity}/10, ${o.measured_at}]`
  }).join('\n')
}

async function generateSummary(obs: string, existing: string | null): Promise<string> {
  const basePrompt = `Du bist Chefarzt mit Jahrzehnten klinischer Erfahrung. Du hast hunderte Patienten in dieser Lebenslage gesehen und kennst die Verläufe genau. Jetzt gibst du Nikolaus (ca. ${getActualAge()} Jahre, männlich) eine ehrliche Einschätzung seines Gesundheitszustands.

Aktuelle Messwerte:
${obs}

Schreibe eine Zustandsbeschreibung (max. 200 Wörter).

Was du vermitteln willst: das Gesamtbild — nicht einzelne Zahlen. Nenne möglichst wenige konkrete Werte. Stattdessen: Was ist der Zustand, den diese Werte gemeinsam ergeben? Was ist das Muster? Welches Bild entsteht, wenn man alles zusammennimmt?

Nikolaus ist Laie. Beschreibe seinen Zustand so, dass er sich etwas darunter vorstellen kann — mit Bildern, greifbaren Konsequenzen. Nicht "dein LDL ist 177", sondern was bedeutet das Gesamtbild für seinen Körper, sein Energielevel, seine Zukunft? Was spürt jemand in diesem Zustand? Wohin entwickelt sich das, wenn nichts passiert?

Zeige auch was gut läuft — das Gesamtbild ist selten nur schwarz.

Ton: erfahren, direkt, ohne Beschönigung — aber auch ohne Zahlenbombardement. Ein Arzt der das Wesentliche auf den Punkt bringt.
Keine Empfehlungen, keine Vorschläge. Du-Form. Kein Markdown, nur Fließtext.`

  const prompt = existing
    ? `${basePrompt}

Bestehende Zusammenfassung:
${existing}

Überprüfe die bestehende Zusammenfassung anhand der aktuellen Werte. Passe an was sich verändert hat, behalte was noch stimmt. Antworte NUR mit dem fertigen Text — keine Erklärung, keine Einleitung, kein Kommentar.`
    : basePrompt

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  return text || existing || ''
}

async function generateBodyAge(obs: string): Promise<number> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16,
    messages: [{
      role: 'user',
      content: `Schätze das biologische Alter (in Jahren) von Nikolaus (ca. ${getActualAge()} Jahre, männlich) anhand dieser klinischen Messwerte.

Bewertungsschema – gewichte diese Kategorien gleichmäßig soweit Daten vorhanden:
1. Stoffwechsel & Glukose (HbA1c, Nüchternglukose, Insulin)
2. Lipide (LDL, HDL, Triglyzeride, LDL/HDL-Verhältnis)
3. Entzündung & Oxidation (CRP, Homocystein, Harnsäure)
4. Organfunktion (Leber, Niere, Schilddrüse)
5. Körperzusammensetzung (BMI, Körperfett, Muskelmasse)
6. Vitalparameter (Blutdruck, Ruhepuls)
7. Mikronährstoffe (Vitamin D, B12, Ferritin, Magnesium)
8. Aerobe Fitness (VO2max, Herzfrequenzwerte) – nur wenn klinisch valide Werte vorhanden

Wichtig: Schätze konservativ. Einzelne sehr gute oder sehr schlechte Werte sollen das Gesamtergebnis nicht dominieren – nimm den gewichteten Durchschnitt aller verfügbaren Kategorien.

Messwerte:
${obs}

Antworte ausschließlich mit einer ganzen Zahl.`,
    }],
  })
  const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : String(getActualAge())
  const age = parseInt(raw.replace(/\D/g, ''), 10)
  return isNaN(age) ? getActualAge() : Math.max(20, Math.min(90, age))
}

export async function updateProfile(): Promise<void> {
  const obs = await fetchObsText()
  if (!obs) return

  const { data: existing } = await supabase
    .from('health_profile')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [summary, body_age] = await Promise.all([
    generateSummary(obs, existing?.summary ?? null),
    generateBodyAge(obs),
  ])

  const payload = { summary, body_age, updated_at: new Date().toISOString() }

  if (existing) {
    await supabase.from('health_profile').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('health_profile').insert(payload)
  }
}
