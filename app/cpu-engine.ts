import { buildVirtualDeck, fgMinRank, resolveMatch, valueOf, type CardColor, type VirtualCard } from "./game-engine.ts";

export const CPU_IDS = ["cpu_rookie_riley", "cpu_coach_morgan", "cpu_captain_harper", "cpu_commissioner"] as const;
export type CpuId = (typeof CPU_IDS)[number];
export type CpuDifficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";
export type CpuProfile = {
  id: CpuId; name: string; stars: 2 | 3 | 4 | 5; difficulty: CpuDifficulty;
  description: string; strategy: string;
};

export const CPU_PROFILES: readonly CpuProfile[] = [
  { id: "cpu_rookie_riley", name: "Rookie Riley", stars: 2, difficulty: "EASY", description: "Knows the fundamentals and plays sensibly, but doesn't always plan ahead.", strategy: "Focuses on the current down, conserves obvious power cards, and occasionally becomes predictable." },
  { id: "cpu_coach_morgan", name: "Coach Morgan", stars: 3, difficulty: "MEDIUM", description: "Plays balanced football and manages cards with the whole drive in mind.", strategy: "Balances immediate results with the remaining downs and adjusts to basic Run/Pass tendencies." },
  { id: "cpu_captain_harper", name: "Captain Harper", stars: 4, difficulty: "HARD", description: "Studies tendencies, counts the deck, and carefully manages risk.", strategy: "Uses public card counts, situational tendencies, and drive-level planning to protect field position." },
  { id: "cpu_commissioner", name: "The Commissioner", stars: 5, difficulty: "EXPERT", description: "Uses every legal piece of information to maximize the chance of winning.", strategy: "Estimates matchup and win-value probabilities from public information without seeing hidden cards." },
] as const;

export const getCpuProfile = (id: string | null | undefined) => CPU_PROFILES.find((cpu) => cpu.id === id) ?? null;
export const isCpuId = (id: string | null | undefined): id is CpuId => Boolean(getCpuProfile(id));

export type PublicHumanPlay = { color: CardColor; down: number; distance: number };
export type CpuCardContext = {
  role: "offense" | "defense"; down: number; distance: number; ballPos: number;
  cpuScore: number; humanScore: number; possessionNum: number; overtime: boolean; twoPoint: boolean;
  publicCards: VirtualCard[]; humanPlayHistory: PublicHumanPlay[];
  decisionSeed: number; decisionIndex: number;
};

type CpuTuning = { planning: number; conserve: number; turnover: number; counting: boolean; tendency: number; mistakeRate: number; maxMistakeRank: number };
const TUNING: Record<CpuId, CpuTuning> = {
  cpu_rookie_riley: { planning: .25, conserve: .46, turnover: 20, counting: false, tendency: .1, mistakeRate: .225, maxMistakeRank: 2 },
  cpu_coach_morgan: { planning: .58, conserve: .62, turnover: 25, counting: false, tendency: .45, mistakeRate: .125, maxMistakeRank: 2 },
  cpu_captain_harper: { planning: .82, conserve: .74, turnover: 31, counting: true, tendency: .72, mistakeRate: .045, maxMistakeRank: 1 },
  cpu_commissioner: { planning: 1, conserve: .82, turnover: 36, counting: true, tendency: 1, mistakeRate: 0, maxMistakeRank: 0 },
};

function hashUnit(seed: number, index: number, salt: string) {
  let h = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
  for (let i = 0; i < salt.length; i += 1) h = Math.imul(h ^ salt.charCodeAt(i), 16777619) >>> 0;
  h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
  return (h >>> 0) / 4294967296;
}

function possibleOpponentCards(hand: VirtualCard[], context: CpuCardContext, counting: boolean) {
  if (!counting) return buildVirtualDeck();
  const unavailable = new Set([...hand, ...context.publicCards].map((card) => card.id));
  const remaining = buildVirtualDeck().filter((card) => !unavailable.has(card.id));
  return remaining.length ? remaining : buildVirtualDeck();
}

function humanRedRate(context: CpuCardContext) {
  const plays = context.humanPlayHistory;
  if (!plays.length) return .5;
  const sameDown = plays.filter((play) => play.down === context.down);
  const sample = sameDown.length >= 2 ? sameDown : plays;
  return sample.filter((play) => play.color === "red").length / sample.length;
}

function candidateUtility(cpuCard: VirtualCard, opponent: VirtualCard, context: CpuCardContext, tuning: CpuTuning) {
  const result = context.role === "offense" ? resolveMatch(cpuCard, opponent) : resolveMatch(opponent, cpuCard);
  const offenseCard = context.role === "offense" ? cpuCard : opponent;
  let gain = result.gain ?? 0, turnover = result.kind === "interception" || result.kind === "fumble";
  if (result.kind === "tie") { gain = valueOf(offenseCard.rank) / 2; turnover = true; }
  const firstDown = !turnover && gain >= context.distance;
  const touchdown = !turnover && gain >= 100 - context.ballPos;
  if (context.role === "offense") {
    let score = gain + (firstDown ? 12 + 6 * tuning.planning : 0) + (touchdown ? 35 : 0) - (turnover ? tuning.turnover : 0);
    if (context.twoPoint) score = turnover ? -45 : gain >= 2 ? 45 : -8;
    const urgent = context.down >= 3 || context.twoPoint || context.ballPos >= 80 || (context.possessionNum >= 7 && context.cpuScore < context.humanScore);
    score -= valueOf(cpuCard.rank) * tuning.conserve * (urgent ? .18 : 1);
    return score;
  }
  let score = -gain + (turnover ? tuning.turnover : 0) + (!firstDown ? 12 + 5 * tuning.planning : 0) + (!touchdown ? 0 : -32);
  if (context.twoPoint) score = turnover || gain < 2 ? 42 : -35;
  score -= valueOf(cpuCard.rank) * tuning.conserve * (context.down >= 3 || context.ballPos >= 80 ? .15 : .8);
  return score;
}

export function rankCpuCards(cpuId: CpuId, hand: VirtualCard[], context: CpuCardContext) {
  const tuning = TUNING[cpuId] ?? TUNING.cpu_rookie_riley;
  const opponents = possibleOpponentCards(hand, context, tuning.counting);
  const redRate = humanRedRate(context);
  return hand.map((card) => {
    let total = 0, weightTotal = 0;
    for (const opponent of opponents) {
      let weight = 1;
      if (tuning.tendency > 0) {
        const predicted = opponent.color === "red" ? redRate : 1 - redRate;
        weight = (1 - tuning.tendency) + 2 * tuning.tendency * predicted;
      }
      total += candidateUtility(card, opponent, context, tuning) * weight;
      weightTotal += weight;
    }
    const variety = (hashUnit(context.decisionSeed, context.decisionIndex, card.id) - .5) * (cpuId === "cpu_commissioner" ? .45 : 1.4);
    return { card, score: total / Math.max(1, weightTotal) + variety };
  }).sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
}

export function chooseCpuCard(cpuId: CpuId, hand: VirtualCard[], context: CpuCardContext) {
  if (!hand.length) return null;
  const ranked = rankCpuCards(cpuId, hand, context);
  const tuning = TUNING[cpuId] ?? TUNING.cpu_rookie_riley;
  const mistakeRoll = hashUnit(context.decisionSeed, context.decisionIndex, `${cpuId}:mistake`);
  if (mistakeRoll < tuning.mistakeRate && ranked.length > 1) {
    const depth = Math.min(ranked.length - 1, tuning.maxMistakeRank);
    const inferior = 1 + Math.floor(hashUnit(context.decisionSeed, context.decisionIndex, `${cpuId}:depth`) * depth);
    return ranked[inferior]?.card ?? ranked[0].card;
  }
  return ranked[0].card;
}

export type CpuSituation = Pick<CpuCardContext, "down" | "distance" | "ballPos" | "cpuScore" | "humanScore" | "possessionNum" | "overtime" | "decisionSeed" | "decisionIndex">;
export type CpuFourthDownChoice = "go" | "punt" | "fg";

export function chooseCpuFourthDown(cpuId: CpuId, situation: CpuSituation): CpuFourthDownChoice {
  const fgEligible = fgMinRank(situation.ballPos) !== null;
  const trailingLate = situation.possessionNum >= 7 && situation.cpuScore < situation.humanScore;
  const veryShort = situation.distance <= (cpuId === "cpu_rookie_riley" ? 2 : cpuId === "cpu_coach_morgan" ? 3 : 4);
  if (trailingLate && (veryShort || situation.ballPos >= 45)) return "go";
  if (fgEligible) {
    if (situation.ballPos >= 70) return "fg";
    if (situation.ballPos >= 50 && situation.distance > 2 && !trailingLate) return "fg";
  }
  if (veryShort && situation.ballPos >= (cpuId === "cpu_rookie_riley" ? 65 : 50)) return "go";
  if ((cpuId === "cpu_captain_harper" || cpuId === "cpu_commissioner") && situation.distance <= 2 && situation.ballPos >= 40) return "go";
  return "punt";
}

export function chooseCpuConversion(cpuId: CpuId, situation: CpuSituation): "xp" | "two" {
  const deficit = situation.humanScore - situation.cpuScore;
  const late = situation.possessionNum >= 6 || situation.overtime;
  if (late && (deficit === 2 || deficit === 5 || deficit >= 8)) return "two";
  if (cpuId !== "cpu_rookie_riley" && late && deficit === 1) return "two";
  return "xp";
}

export function chooseCpuKickoff(cpuId: CpuId, situation: CpuSituation): "deep" | "onside" {
  if (situation.overtime || situation.possessionNum === 4 || situation.possessionNum === 8) return "deep";
  const trailing = situation.cpuScore < situation.humanScore;
  const threshold = cpuId === "cpu_rookie_riley" ? 7 : 6;
  return trailing && situation.possessionNum >= threshold ? "onside" : "deep";
}
