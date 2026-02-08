# Mythic Agents Preset Preparation Guide

This guide explains **exactly how to create a valid JSON preset** for the **Mythic Agents** extension. It customizes the Mythic Game Master Emulator (GME) tables for a specific **theme** (e.g., "Cyberpunk Noir", "High Fantasy", "Horror Survival").

Presets control:
- **Fate Chart**: Yes/No probabilities adjusted by Chaos (1-9).
- **Event Generation**: Random events (focuses, actions, subjects).
- **UNE (NPCs)**: Universal NPC Emulator tables for personalities/motivations.
- **Character Types**: Defines available character types for manual editing (NpcTab dropdown) and consistent scene tracking across LLM generation, UI, and events. Types are stored/matched in lowercase for case-insensitive and non-ASCII support.

## Preset Structure (Strict Zod Schema)
A preset is **always** this exact JSON shape. **Do not add/remove fields**.

```json
{
  "name": "Your Theme",
  "data": {
    "fateChart": {
      "1": {
        "Impossible": { "chance": 50, "exceptional_yes": 10, "exceptional_no": 91 },
        // ... all 11 odds for each chaos level "1" to "9"
      }
    },
    "eventGeneration": {
      "focuses": [
        { "min": 1, "max": 10, "focus": "Gang Turf War", "action": "random_gangster" }
        // Array must cover exactly 1-100 with no gaps/overlaps
      ],
      "actions": [ "Hack", "Betray" ],  // 50-100 themed entries
      "subjects": [ "Datastreams", "Corpos" ]  // 50-100 themed entries
    },
    "une": {
      "modifiers": [ "Glitchy", "Augmented" ],  // 100-200+ themed adjectives
      "nouns": [ "Fixer", "Netrunner" ],  // 100-200+ themed nouns
      "motivation_verbs": [ "Sabotage", "Decrypt" ],  // 100-200+ themed verbs
      "motivation_nouns": [ "Paydata", "Chrome" ]  // 100-200+ themed nouns
    },
    "characterTypes": [ "gangster", "decker", "exec" ]  // 5-20 themed types; all equal, lowercase for consistency
  }
}
```

## Key Field Explanations

### fateChart
- Outer keys: Chaos rank `"1"` (orderly) to `"9"` (chaotic).
- Inner keys: Exact odds enum: `"Impossible"`, `"No Way"`, `"Very Unlikely"`, `"Unlikely"`, `"50/50"`, `"Somewhat Likely"`, `"Likely"`, `"Very Likely"`, `"Near Sure Thing"`, `"A Sure Thing"`, `"Has to be"`.
- Values: `{ chance: number (d100 Yes threshold), exceptional_yes: number, exceptional_no: number }`.
- **Customization**: Minor tweaks for theme (e.g., grimdark: lower `chance`; heroic: higher). Higher chaos reduces effective `chance`.

### eventGeneration.focuses
- **Ranges**: d100 roll picks entry (`min/max` inclusive). **Must chain exactly 1-100 (sum(max-min+1)=100), sorted ascending, no gaps/overlaps.**
- `focus`: Descriptive label for logs/narration.
- **`action` (optional string)**: Triggers special logic in `generateFullRandomEvent`. Supports **complex expressions** parsed as JS AST (parentheses, `and`/`or`):
  - `or`: Randomly picks one branch (50/50).
  - `and`: Executes both branches (combines results).
  - Example: `"new_decker and (random_gangster or random_exec)"`.

**Simple Action Types** (all character types treated equally):
| Prefix | Effect |
|--------|--------|
| `random_thread` | Picks random from current `scene.threads`; adds to event.threads. Skips if none. |
| `random_<type>`<br>(e.g., `random_gangster`) | Picks random existing scene character matching `type.toLowerCase() === '<type>'` (underscores → spaces/lowercase). Adds `{name, type}` to event.characters. Skips if none. |
| `new_<type>`<br>(e.g., `new_decker`) | **Generates new UNE NPC**:<br>- Name: `${random modifier} ${random noun}`<br>- Profile: `${random motivation_verb} ${random motivation_noun}`<br>- Type: `'<type>'.replace(/_/g, ' ').toLowerCase()` (e.g., `"new_gangster"` → `"gangster"`)<br>Adds to event.new_npcs (integrated into scene later). Always succeeds. |

- **actions/subjects**: Randomly paired for event meaning (e.g., "Hack Datastreams").

### une
- Generates NPC profiles: `${modifier} ${noun}` who `${motivation_verb} ${motivation_noun}`.
- Uniform random pick from each array.

### characterTypes
- **All types equal**: Defines preset's character archetypes (e.g., `["gangster", "decker", "exec"]`).
- **Uses**:
  - NpcTab dropdown for manual adds/edits (adds `{type: selected}` to scene).
  - Guides LLM initialScene extraction for consistency.
  - Basis for `random_<type>` / `new_<type>` actions (match lowercase/spaced).
- **Best Practice**: 5-20 themed entries. Use these exact strings in `action` values (with underscores for spaces).

## Customization Rules for Themes
1. **Start with Defaults**: Copy exported "Default" preset.
2. **Rename**: `"name": "Your Theme"`.
3. **Theme Lists**:
   - `actions`/`subjects`: Replace 50-100% with 1-2 word theme phrases (keep 50-100 total).
   - `une`: 100-200+ themed words per array.
4. **characterTypes**: Theme-specific (e.g., cyberpunk: `["street samurai", "decker"]`).
5. **focuses `action`**:
   - Use your `characterTypes` (e.g., `random_decker`, `new_gangster`).
   - Chain for reliability: `"new_decker and random_decker"`.
   - ~30% events with actions; bias via range widths.
6. **fateChart**: Optional 10-20% tweaks.
7. **Validate**: JSON.parse; focuses 1-100; themed/varied lists.

## Example: "Cyberpunk Noir" Preset
```json
{
  "name": "Cyberpunk Noir",
  "data": {
    "fateChart": { /* Defaults or paranoia-biased (lower chances at high chaos) */ },
    "eventGeneration": {
      "focuses": [
        { "min": 1, "max": 5, "focus": "Neon Glitch" },
        { "min": 6, "max": 20, "focus": "Street Deal", "action": "random_gangster" },
        { "min": 21, "max": 30, "focus": "New Contact", "action": "new_decker" },
        { "min": 31, "max": 40, "focus": "Exec Intrigue", "action": "random_exec" },
        { "min": 41, "max": 50, "focus": "Samurai Clash", "action": "new_street_samurai and random_street_samurai" },
        { "min": 51, "max": 60, "focus": "Data Leak", "action": "random_thread" },
        { "min": 61, "max": 100, "focus": "Gang Ambush", "action": "(random_gangster or new_gangster) and random_decker" }
      ],
      "actions": [ "Hack", "Betray", "Implant", "Sabotage", "Overclock" /* +95 cyber-themed */ ],
      "subjects": [ "ICE", "Paydata", "Chrome", "Fixers", "Gangs" /* +95 cyber-themed */ ]
    },
    "une": {
      "modifiers": [ "Glitchy", "Augmented", "Burned-Out", "Paranoid" /* +196 more */ ],
      "nouns": [ "Netrunner", "Ripperdoc", "Solo", "Media" /* +396 more */ ],
      "motivation_verbs": [ "Jack-In", "Ghost", "Rip-Off" /* +197 more */ ],
      "motivation_nouns": [ "Net", "Street Cred", "Corpo Secrets" /* +396 more */ ]
    },
    "characterTypes": [ "street samurai", "decker", "exec", "gangster" ]
  }
}
```