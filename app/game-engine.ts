export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS)[number];
export type CardColor = "black" | "red";
export type Card = { color: CardColor; rank: Rank };
export type MatchResult = {
  kind: "run" | "runbit" | "pass" | "wideopen" | "breakaway" | "stuff" | "sack" | "interception" | "tie";
  gain?: number;
  turnoverType?: "interception";
};

export function valueOf(rank: Rank) {
  if (rank === "A") return 20;
  if (["J", "Q", "K"].includes(rank)) return 12;
  return Number(rank);
}

export function resolveMatch(offense: Card, defense: Card): MatchResult {
  if (offense.rank === defense.rank) return { kind: "tie" };
  const ov = valueOf(offense.rank);
  const dv = valueOf(defense.rank);
  if (offense.rank === "A") {
    return offense.color === defense.color
      ? { kind: "interception", turnoverType: "interception" }
      : { kind: "breakaway", gain: 20 + dv };
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

export function puntDistance(rank: Rank) {
  return rank === "A" ? 70 : valueOf(rank) * 5;
}

export function ordinal(n: number) {
  return (["", "1ST", "2ND", "3RD", "4TH"] as const)[n] ?? `${n}TH`;
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
export type GameResult = {
  id: string; playedAt: number; p1PlayerId: string; p2PlayerId: string;
  p1Name: string; p2Name: string; p1Score: number; p2Score: number;
  winnerPlayerId: string; overtime: boolean; finalPossessionNum: number;
};

export function playerStats(playerId: string, games: GameResult[]) {
  const played = games.filter((g) => g.p1PlayerId === playerId || g.p2PlayerId === playerId);
  const wins = played.filter((g) => g.winnerPlayerId === playerId).length;
  return { gamesPlayed: played.length, wins, losses: played.length - wins, winPct: played.length ? Math.round(100 * wins / played.length) : null };
}
