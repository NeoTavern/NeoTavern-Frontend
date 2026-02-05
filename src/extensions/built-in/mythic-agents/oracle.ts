import { generateFullRandomEvent } from './event-generator';
import type {
  EventGenerationData,
  EventMeaningResult,
  FateChartData,
  FateRollResult,
  MythicOdds,
  Scene,
  UNESettings,
} from './types';

function d10(): number {
  return Math.floor(Math.random() * 10) + 1;
}

export function rollFate(
  odds: MythicOdds,
  chaos: number,
  fateChart: FateChartData,
  scene: Scene,
  eventGenerationData: EventGenerationData,
  uneSettings: UNESettings,
): { fateRollResult: FateRollResult; randomEvent?: EventMeaningResult } {
  const roll = d10() + d10();
  const chaosDie = d10();
  const chaosKey = chaos.toString();

  const rankData = fateChart[chaosKey];
  if (!rankData) {
    throw new Error(`Invalid chaos rank in Fate Chart: ${chaos}`);
  }

  const chartEntry = rankData[odds];
  if (!chartEntry) {
    // Fallback if odds string doesn't match exactly (e.g. case sensitivity)
    // Try to find case-insensitive match
    const key = Object.keys(rankData).find((k) => k.toLowerCase() === odds.toLowerCase());
    if (!key || !rankData[key]) {
      throw new Error(`Invalid odds in Fate Chart: ${odds}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chartEntry as any) = rankData[key];
  }

  let outcome: 'Yes' | 'No' | 'Exceptional Yes' | 'Exceptional No';
  let exceptional = false;

  if (roll <= chartEntry.exceptional_yes) {
    outcome = 'Exceptional Yes';
    exceptional = true;
  } else if (roll >= chartEntry.exceptional_no) {
    outcome = 'Exceptional No';
    exceptional = true;
  } else if (roll <= chartEntry.chance) {
    outcome = 'Yes';
  } else {
    outcome = 'No';
  }

  const fateRollResult: FateRollResult = {
    roll,
    chaosDie,
    outcome,
    exceptional,
  };

  let randomEvt: EventMeaningResult | undefined;
  if (chaosDie <= chaos) {
    randomEvt = generateFullRandomEvent(scene, eventGenerationData, uneSettings);
  }

  return { fateRollResult, randomEvent: randomEvt };
}

export async function askOracle(
  analysis: { extracted_question: string; odds: MythicOdds; requires_fate_roll: boolean; justification: string },
  chaos: number,
  fateChart: FateChartData,
  scene: Scene,
  eventGenerationData: EventGenerationData,
  uneSettings: UNESettings,
): Promise<{
  analysis: { extracted_question: string; odds: MythicOdds; requires_fate_roll: boolean; justification: string };
  fateRollResult: FateRollResult;
  randomEvent?: EventMeaningResult;
}> {
  const { fateRollResult, randomEvent } = rollFate(
    analysis.odds,
    chaos,
    fateChart,
    scene,
    eventGenerationData,
    uneSettings,
  );

  return { analysis, fateRollResult, randomEvent };
}
