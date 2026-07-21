export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS)[number];
export type CardColor = "black" | "red";
export type Card = { color: CardColor; rank: Rank };
export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export type Suit = (typeof SUITS)[number];
export type VirtualCard = Card & { id: string; suit: Suit };
export type VirtualDeckState = { drawPile: VirtualCard[]; discardPile: VirtualCard[] };
export type MatchResult = {
  kind: "run" | "runbit" | "pass" | "wideopen" | "breakaway" | "stuff" | "sack" | "interception" | "fumble" | "tie";
  gain?: number;
  turnoverType?: "interception";
};

export function valueOf(rank: Rank) {
  if (rank === "A") return 20;
  if (["J", "Q", "K"].includes(rank)) return 12;
  return Number(rank);
}

export function buildVirtualDeck(): VirtualCard[] {
  return RANKS.flatMap((rank) => SUITS.map((suit) => ({
    id: `${rank}-${suit}`, rank, suit,
    color: (suit === "♠" || suit === "♣" ? "black" : "red") as CardColor,
  })));
}

export function shuffleCards<T>(cards: T[], random: () => number = Math.random) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealVirtualDeck(random: () => number = Math.random) {
  const drawPile = shuffleCards(buildVirtualDeck(), random), p1Hand: VirtualCard[] = [], p2Hand: VirtualCard[] = [];
  for (let i = 0; i < 5; i += 1) { p1Hand.push(drawPile.pop()!); p2Hand.push(drawPile.pop()!); }
  return { drawPile, discardPile: [] as VirtualCard[], p1Hand, p2Hand };
}

export function drawOneVirtual(state: VirtualDeckState, random: () => number = Math.random) {
  let drawPile = [...state.drawPile], discardPile = [...state.discardPile], reshuffled = false;
  if (!drawPile.length) { drawPile = shuffleCards(discardPile, random); discardPile = []; reshuffled = true; }
  const card = drawPile.pop();
  if (!card) throw new Error("Virtual deck has no card available.");
  return { card, drawPile, discardPile, reshuffled };
}

export function resolveMatch(offense: Card, defense: Card): MatchResult {
  if (offense.rank === defense.rank) return { kind: "tie" };
  const ov = valueOf(offense.rank);
  const dv = valueOf(defense.rank);
  if (offense.rank === "A") {
    if (offense.color === "red" && defense.color === "red") return { kind: "interception", turnoverType: "interception" };
    if (offense.color === "black" && defense.color === "black") return { kind: "fumble" };
    return { kind: "breakaway", gain: 20 + dv };
  }
  if (offense.color === "black" && defense.color === "black") {
    return dv >= ov ? { kind: "stuff", gain: 0 } : { kind: "run", gain: ov - dv };
  }
  if (offense.color === "black") return { kind: "runbit", gain: ov + dv };
  if (defense.color === "red") {
    return dv >= ov ? { kind: "sack", gain: -5 } : { kind: "pass", gain: ov - dv };
  }
  return { kind: "wideopen", gain: ov + dv };
}

export function interceptionStart(ballPos: number) {
  return ballPos >= 80 ? 20 : 80 - ballPos;
}

export function fumbleStart(ballPos: number) {
  return 100 - ballPos;
}

export function fgMinRank(ballPos: number): Rank | null {
  if (ballPos >= 80) return "4";
  if (ballPos >= 70) return "5";
  if (ballPos >= 60) return "7";
  if (ballPos >= 50) return "9";
  if (ballPos >= 40) return "J";
  return null;
}

export function fieldGoalGood(ballPos: number, rank: Rank) {
  const minimum = fgMinRank(ballPos);
  return minimum !== null && RANKS.indexOf(rank) >= RANKS.indexOf(minimum);
}

export function extraPointGood(rank: Rank) {
  return RANKS.indexOf(rank) >= RANKS.indexOf("4");
}

export function puntDistance(rank: Rank) {
  return rank === "A" ? 70 : valueOf(rank) * 5;
}

export function ordinal(n: number) {
  return (["", "1ST", "2ND", "3RD", "4TH"] as const)[n] ?? `${n}TH`;
}

export function downDistanceLabel(down: number, ballPos: number, lineToGain: number, twoPoint = false) {
  if (twoPoint) return "Two-point try · 2 yards";
  const label = (["", "1st", "2nd", "3rd", "4th"] as const)[down] ?? `${down}th`;
  if (lineToGain >= 100) return `${label} and Goal`;
  return `${label} and ${Math.max(1, lineToGain - ballPos)}`;
}

export function compareOpeningCards(human: VirtualCard, cpu: VirtualCard) {
  return Math.sign(RANKS.indexOf(human.rank) - RANKS.indexOf(cpu.rank));
}

export function openingReceiverForChoice(winner: "p1" | "p2", choice: "receive" | "kick") {
  return choice === "receive" ? winner : winner === "p1" ? "p2" : "p1";
}

export function yd(n: number) {
  return `${n} ${n === 1 ? "yard" : "yards"}`;
}

export function cardStr(card: Card) {
  return `${card.rank}${card.color === "black" ? "♠" : "♥"}`;
}

export function displaySpot(ballPos: number) {
  if (ballPos === 50) return "midfield";
  return `${ballPos < 50 ? "own" : "opp"} ${Math.min(ballPos, 100 - ballPos)}`;
}

// The playable field occupies the middle 90%; each end zone gets 5%.
export function fieldPercent(position: number) {
  return 5 + Math.max(0, Math.min(100, position)) * 0.9;
}

export type PlayerProfile = { id: string; name: string; createdAt: number };
export type FieldGoalAttempt = { distance: number; made: boolean };
export type PlayerGameStats = {
  runYards: number; passYards: number; turnovers: number;
  fieldGoals: FieldGoalAttempt[]; twoPointMade: number; twoPointMissed: number;
  extraPointMade: number; extraPointMissed: number; onsideRecoveries: number; points: number;
};
export const emptyPlayerGameStats = (points = 0): PlayerGameStats => ({
  runYards: 0, passYards: 0, turnovers: 0, fieldGoals: [],
  twoPointMade: 0, twoPointMissed: 0, extraPointMade: 0, extraPointMissed: 0, onsideRecoveries: 0, points,
});
export function recordExtraPointResult(stats: PlayerGameStats, made: boolean) {
  if (made) stats.extraPointMade = (Number.isFinite(stats.extraPointMade) ? stats.extraPointMade : 0) + 1;
  else stats.extraPointMissed = (Number.isFinite(stats.extraPointMissed) ? stats.extraPointMissed : 0) + 1;
}
export type GameResult = {
  id: string; playedAt: number; p1PlayerId: string; p2PlayerId: string;
  p1Name: string; p2Name: string; p1Score: number; p2Score: number;
  winnerPlayerId: string; overtime: boolean; finalPossessionNum: number;
  stats?: { p1: PlayerGameStats; p2: PlayerGameStats };
  gameMode?: "physical" | "virtual"; opponentType?: "human" | "cpu";
  cpuId?: string; cpuName?: string; cpuDifficulty?: string; cpuStars?: number;
  mercyRuleEnabled?: boolean; endReason?: "regulation" | "overtime" | "mathematical_mercy";
  mercyAtPossession?: number; mercyLeaderId?: string; mercyTrailerId?: string;
  mercyDeficit?: number; mercyRemainingPossessions?: number; mercyNextOffenseId?: string;
  mercyMaximumComeback?: number; mercyBestFinalDifferential?: number; mercyExplanation?: string;
};

export type MercyTeam = "p1" | "p2";
export type MercyEvaluationInput = {
  scores: Record<MercyTeam, number>; completedPossession: number;
  nextOffense: MercyTeam | null; firstHalfOpener: MercyTeam;
  enabled: boolean; overtime: boolean;
};
export type MercyEvaluation = {
  shouldEnd: boolean; leader: MercyTeam | null; trailer: MercyTeam | null;
  deficit: number; remainingPossessions: number; nextOffense: MercyTeam | null;
  maximumComeback: number; bestFinalDifferential: number;
  viablePathSummary: string; eliminationReason: string;
};

const otherMercyTeam = (team: MercyTeam): MercyTeam => team === "p1" ? "p2" : "p1";

function maximumFutureDifferential(completedPossession: number, nextOffense: MercyTeam, firstHalfOpener: MercyTeam, trailer: MercyTeam) {
  const memo = new Map<string, number>();
  const search = (possession: number, offense: MercyTeam): number => {
    if (possession > 8) return 0;
    const key = `${possession}:${offense}`; const cached = memo.get(key); if (cached !== undefined) return cached;
    const defense = otherMercyTeam(offense), endOfHalf = possession === 4, endOfRegulation = possession === 8;
    const finish = (pointsDelta: number, candidateNext: MercyTeam) => {
      if (endOfRegulation) return pointsDelta;
      const actualNext = endOfHalf ? otherMercyTeam(firstHalfOpener) : candidateNext;
      return pointsDelta + search(possession + 1, actualNext);
    };
    const differential = (team: MercyTeam, points: number) => team === trailer ? points : -points;
    const outcomes: number[] = [finish(0, defense), finish(differential(defense, 2), defense)];
    for (const points of [3, 6, 7, 8]) {
      const delta = differential(offense, points);
      outcomes.push(finish(delta, defense));
      if (!endOfHalf && !endOfRegulation) outcomes.push(finish(delta, offense));
    }
    const best = Math.max(...outcomes); memo.set(key, best); return best;
  };
  return search(completedPossession + 1, nextOffense);
}

export function evaluateMathematicalMercy(input: MercyEvaluationInput): MercyEvaluation {
  const safeContinue: MercyEvaluation = { shouldEnd:false,leader:null,trailer:null,deficit:0,remainingPossessions:Math.max(0,8-input.completedPossession),nextOffense:input.nextOffense,maximumComeback:0,bestFinalDifferential:0,viablePathSummary:"Game continues.",eliminationReason:"No mathematical elimination proof was established." };
  try {
    if (!input.enabled || input.overtime || input.completedPossession < 1 || input.completedPossession >= 8) return safeContinue;
    if (!Number.isFinite(input.scores.p1) || !Number.isFinite(input.scores.p2) || !input.nextOffense || !["p1","p2"].includes(input.nextOffense)) return safeContinue;
    if (input.scores.p1 === input.scores.p2) return safeContinue;
    const leader: MercyTeam = input.scores.p1 > input.scores.p2 ? "p1" : "p2", trailer = otherMercyTeam(leader);
    const deficit = input.scores[leader] - input.scores[trailer], remainingPossessions = 8 - input.completedPossession;
    const maximumComeback = maximumFutureDifferential(input.completedPossession,input.nextOffense,input.firstHalfOpener,trailer);
    const bestFinalDifferential = maximumComeback - deficit, shouldEnd = bestFinalDifferential < 0;
    const trailerStarts = input.nextOffense === trailer;
    const viablePathSummary = trailerStarts
      ? `The trailer can use touchdowns with conversions and eligible onside recoveries across the remaining ${remainingPossessions} possession${remainingPossessions===1?"":"s"}.`
      : remainingPossessions === 1
        ? `The leader owns the final possession, so the trailer's only favorable scoring path is a 2-point defensive safety; regulation ends before another possession can begin.`
        : `The leader owns the next possession; a defensive safety and the resulting possession were included in the trailer's best legal path.`;
    const eliminationReason = shouldEnd
      ? `The best legal comeback is ${maximumComeback} point${maximumComeback===1?"":"s"}, leaving the trailer ${Math.abs(bestFinalDifferential)} point${Math.abs(bestFinalDifferential)===1?"":"s"} behind.`
      : `A legal path can ${bestFinalDifferential===0?"tie the game":"give the trailer the lead"}.`;
    return {shouldEnd,leader,trailer,deficit,remainingPossessions,nextOffense:input.nextOffense,maximumComeback,bestFinalDifferential,viablePathSummary,eliminationReason};
  } catch { return safeContinue; }
}

export function formatMercyExplanation(result: MercyEvaluation, names: Record<MercyTeam,string>, scores: Record<MercyTeam,number>, completedPossession: number) {
  if (!result.shouldEnd || !result.leader || !result.trailer) return "";
  const next = result.nextOffense ? `${names[result.nextOffense]} would have owned the next possession. ` : "";
  const boundary = completedPossession === 7 && result.nextOffense === result.trailer ? "No onside kick is available after possession 8. " : "";
  return `${names[result.leader]} leads ${names[result.trailer]} ${scores[result.leader]}–${scores[result.trailer]} after ${completedPossession} possession${completedPossession===1?"":"s"}. ${names[result.trailer]} trails by ${result.deficit} with ${result.remainingPossessions} regulation possession${result.remainingPossessions===1?"":"s"} remaining. ${next}${result.viablePathSummary} ${boundary}The maximum net comeback is ${result.maximumComeback}, so ${names[result.trailer]} could neither tie nor take the lead. Overtime is impossible.`;
}

export function isCpuGame(game: GameResult) {
  return game.opponentType === "cpu" || Boolean(game.cpuId) || game.p2PlayerId.startsWith("cpu_");
}

export function filterGameResults(games: GameResult[], filter = "all") {
  if (filter === "human") return games.filter((game) => !isCpuGame(game));
  if (filter === "cpu") return games.filter(isCpuGame);
  if (filter.startsWith("cpu_")) return games.filter((game) => isCpuGame(game) && (game.cpuId ?? game.p2PlayerId) === filter);
  return games;
}

export function gamePlayerStats(game: GameResult, team: "p1" | "p2") {
  const saved = game.stats?.[team];
  return saved ? { ...emptyPlayerGameStats(game[`${team}Score`]), ...saved, fieldGoals: Array.isArray(saved.fieldGoals) ? saved.fieldGoals : [], extraPointMade: Number.isFinite(saved.extraPointMade) ? saved.extraPointMade : 0, extraPointMissed: Number.isFinite(saved.extraPointMissed) ? saved.extraPointMissed : 0 } : emptyPlayerGameStats(game[`${team}Score`]);
}

export function cpuMatchupRecord(games: GameResult[], cpuId: string) {
  const matching = games.filter((game) => isCpuGame(game) && (game.cpuId ?? game.p2PlayerId) === cpuId);
  let wins = 0, losses = 0;
  for (const game of matching) {
    if (game.p1Score === game.p2Score) continue;
    const cpuPlayerId = game.cpuId ?? game.p2PlayerId;
    if (game.winnerPlayerId && game.winnerPlayerId === cpuPlayerId) wins += 1;
    else if (game.winnerPlayerId && game.p1PlayerId && game.winnerPlayerId === game.p1PlayerId) losses += 1;
    else if (game.p2Score > game.p1Score) wins += 1;
    else if (game.p1Score > game.p2Score) losses += 1;
  }
  return { played: matching.length, wins, losses };
}

export function gameSortMetric(game: GameResult, metric: string) {
  const p1 = gamePlayerStats(game, "p1"), p2 = gamePlayerStats(game, "p2");
  const both = [p1, p2];
  if (metric === "totalScore") return game.p1Score + game.p2Score;
  if (metric === "playerScore") return Math.max(game.p1Score, game.p2Score);
  if (metric === "turnovers") return p1.turnovers + p2.turnovers;
  if (metric === "yards") return p1.runYards + p1.passYards + p2.runYards + p2.passYards;
  if (metric === "passYards") return p1.passYards + p2.passYards;
  if (metric === "runYards") return p1.runYards + p2.runYards;
  if (metric === "fgAttempts") return p1.fieldGoals.length + p2.fieldGoals.length;
  if (metric === "fgMakes") return both.flatMap((s) => s.fieldGoals).filter((fg) => fg.made).length;
  if (metric === "fgMisses") return both.flatMap((s) => s.fieldGoals).filter((fg) => !fg.made).length;
  if (metric === "twoPointAttempts") return p1.twoPointMade + p1.twoPointMissed + p2.twoPointMade + p2.twoPointMissed;
  if (metric === "onsideRecoveries") return p1.onsideRecoveries + p2.onsideRecoveries;
  return game.playedAt;
}

export function sortGameResults(games: GameResult[], sort = "newest:desc") {
  const [metric, direction] = sort.split(":");
  return [...games].sort((a, b) => {
    const av = metric === "newest" ? a.playedAt : gameSortMetric(a, metric);
    const bv = metric === "newest" ? b.playedAt : gameSortMetric(b, metric);
    return (direction === "asc" ? av - bv : bv - av) || (b.playedAt - a.playedAt);
  });
}

export function playerStats(playerId: string, games: GameResult[]) {
  const played = games.filter((g) => g.p1PlayerId === playerId || g.p2PlayerId === playerId);
  const wins = played.filter((g) => g.winnerPlayerId === playerId).length;
  return { gamesPlayed: played.length, wins, losses: played.length - wins, winPct: played.length ? Math.round(100 * wins / played.length) : null };
}
