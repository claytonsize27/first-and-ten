import type { GameResult, PlayerGameStats, PlayerProfile } from "./game-engine.ts";
import { CPU_PROFILES, type CpuId } from "./cpu-engine.ts";

export type PersistedPlayerProfile = PlayerProfile;
export type PersistedGameResult = GameResult;
export type PersistedCloudState = { players: PersistedPlayerProfile[]; gameResults: PersistedGameResult[] };

export class PersistenceValidationError extends Error {
  readonly code: string;
  readonly path: string;
  readonly recordId?: string;

  constructor(code: string, path: string, message: string, recordId?: string) {
    super(`${message} (${path})`);
    this.name = "PersistenceValidationError";
    this.code = code;
    this.path = path;
    this.recordId = recordId;
  }
}

const invalid = (code: string, path: string, message: string, recordId?: string): never => {
  throw new PersistenceValidationError(code, path, message, recordId);
};
const finite = (value: unknown, path: string, recordId?: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid("CLOUD_PAYLOAD_INVALID_NUMBER", path, "Expected a finite number", recordId);
  return value as number;
};
const text = (value: unknown, path: string, recordId?: string, allowEmpty = false): string => {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalid("CLOUD_PAYLOAD_INVALID_STRING", path, "Expected a non-empty string", recordId);
  return value as string;
};
const bool = (value: unknown, path: string, recordId?: string): boolean => {
  if (typeof value !== "boolean") invalid("CLOUD_PAYLOAD_INVALID_BOOLEAN", path, "Expected a boolean", recordId);
  return value as boolean;
};

export function sanitizeFirestorePlainData<T>(value: T, path = "cloudState"): T {
  const visit = (current: unknown, currentPath: string, inArray = false): unknown => {
    if (current === undefined) {
      if (inArray) invalid("CLOUD_PAYLOAD_UNDEFINED_ARRAY_ELEMENT", currentPath, "Undefined array elements are not supported");
      return undefined;
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalid("CLOUD_PAYLOAD_INVALID_NUMBER", currentPath, "Non-finite numbers are not supported");
      return current;
    }
    if (typeof current === "function" || typeof current === "symbol" || typeof current === "bigint") {
      invalid("CLOUD_PAYLOAD_UNSUPPORTED_VALUE", currentPath, `Unsupported ${typeof current} value`);
    }
    if (Array.isArray(current)) return current.map((item, index) => visit(item, `${currentPath}[${index}]`, true));
    if (typeof current === "object") {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) invalid("CLOUD_PAYLOAD_UNSUPPORTED_INSTANCE", currentPath, "Expected a plain object");
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(current)) {
        if (item !== undefined) result[key] = visit(item, `${currentPath}.${key}`);
      }
      return result;
    }
    return invalid("CLOUD_PAYLOAD_UNSUPPORTED_VALUE", currentPath, "Unsupported value");
  };
  return visit(value, path) as T;
}

export function assertFirestoreSafePlainData(value: unknown, path = "cloudState"): void {
  sanitizeFirestorePlainData(value, path);
}

export function toPersistedPlayerProfile(profile: PlayerProfile, index?: number): PersistedPlayerProfile {
  const path = index === undefined ? "player" : `players[${index}]`;
  return {
    id: text(profile?.id, `${path}.id`),
    name: text(profile?.name, `${path}.name`),
    createdAt: finite(profile?.createdAt, `${path}.createdAt`),
  };
}

export function toPersistedPlayerGameStats(stats: PlayerGameStats, path = "stats", recordId?: string): PlayerGameStats {
  if (!stats || typeof stats !== "object") invalid("CLOUD_PAYLOAD_INVALID_STATS", path, "Expected player statistics", recordId);
  if (!Array.isArray(stats.fieldGoals)) invalid("CLOUD_PAYLOAD_INVALID_FIELD_GOALS", `${path}.fieldGoals`, "Expected a field-goal array", recordId);
  return {
    runYards: finite(stats.runYards, `${path}.runYards`, recordId),
    passYards: finite(stats.passYards, `${path}.passYards`, recordId),
    turnovers: finite(stats.turnovers, `${path}.turnovers`, recordId),
    fieldGoals: stats.fieldGoals.map((attempt, index) => ({
      distance: finite(attempt?.distance, `${path}.fieldGoals[${index}].distance`, recordId),
      made: bool(attempt?.made, `${path}.fieldGoals[${index}].made`, recordId),
    })),
    twoPointMade: finite(stats.twoPointMade, `${path}.twoPointMade`, recordId),
    twoPointMissed: finite(stats.twoPointMissed, `${path}.twoPointMissed`, recordId),
    extraPointMade: finite(stats.extraPointMade, `${path}.extraPointMade`, recordId),
    extraPointMissed: finite(stats.extraPointMissed, `${path}.extraPointMissed`, recordId),
    onsideRecoveries: finite(stats.onsideRecoveries, `${path}.onsideRecoveries`, recordId),
    points: finite(stats.points, `${path}.points`, recordId),
  };
}

type GameMappingOptions = { requireCurrent?: boolean; index?: number };

export function toPersistedGameResult(game: GameResult, options: GameMappingOptions = {}): PersistedGameResult {
  const path = options.index === undefined ? "gameResult" : `gameResults[${options.index}]`;
  const recordId = typeof game?.id === "string" ? game.id : undefined;
  const base: GameResult = {
    id: text(game?.id, `${path}.id`, recordId),
    playedAt: finite(game?.playedAt, `${path}.playedAt`, recordId),
    p1PlayerId: text(game?.p1PlayerId, `${path}.p1PlayerId`, recordId),
    p2PlayerId: text(game?.p2PlayerId, `${path}.p2PlayerId`, recordId),
    p1Name: text(game?.p1Name, `${path}.p1Name`, recordId),
    p2Name: text(game?.p2Name, `${path}.p2Name`, recordId),
    p1Score: finite(game?.p1Score, `${path}.p1Score`, recordId),
    p2Score: finite(game?.p2Score, `${path}.p2Score`, recordId),
    winnerPlayerId: text(game?.winnerPlayerId, `${path}.winnerPlayerId`, recordId),
    overtime: bool(game?.overtime, `${path}.overtime`, recordId),
    finalPossessionNum: finite(game?.finalPossessionNum, `${path}.finalPossessionNum`, recordId),
  };

  if (game.stats) base.stats = {
    p1: toPersistedPlayerGameStats(game.stats.p1, `${path}.stats.p1`, recordId),
    p2: toPersistedPlayerGameStats(game.stats.p2, `${path}.stats.p2`, recordId),
  };
  else if (options.requireCurrent) invalid("CLOUD_PAYLOAD_MISSING_REQUIRED_FIELD", `${path}.stats`, "Current game results require statistics", recordId);

  if (game.gameMode !== undefined) {
    if (game.gameMode !== "physical" && game.gameMode !== "virtual") invalid("CLOUD_PAYLOAD_INVALID_GAME_MODE", `${path}.gameMode`, "Invalid game mode", recordId);
    base.gameMode = game.gameMode;
  } else if (options.requireCurrent) invalid("CLOUD_PAYLOAD_MISSING_REQUIRED_FIELD", `${path}.gameMode`, "Current game results require a game mode", recordId);

  if (game.opponentType !== undefined) {
    if (game.opponentType !== "human" && game.opponentType !== "cpu") invalid("CLOUD_PAYLOAD_INVALID_OPPONENT", `${path}.opponentType`, "Invalid opponent type", recordId);
    base.opponentType = game.opponentType;
  } else if (options.requireCurrent) invalid("CLOUD_PAYLOAD_MISSING_REQUIRED_FIELD", `${path}.opponentType`, "Current game results require an opponent type", recordId);

  if (game.mercyRuleEnabled !== undefined) base.mercyRuleEnabled = bool(game.mercyRuleEnabled, `${path}.mercyRuleEnabled`, recordId);
  else if (options.requireCurrent) invalid("CLOUD_PAYLOAD_MISSING_REQUIRED_FIELD", `${path}.mercyRuleEnabled`, "Current game results require the mercy setting", recordId);

  if (game.endReason !== undefined) {
    if (!["regulation", "overtime", "mathematical_mercy"].includes(game.endReason)) invalid("CLOUD_PAYLOAD_INVALID_END_REASON", `${path}.endReason`, "Invalid end reason", recordId);
    base.endReason = game.endReason;
  } else if (options.requireCurrent) invalid("CLOUD_PAYLOAD_MISSING_REQUIRED_FIELD", `${path}.endReason`, "Current game results require an end reason", recordId);

  if (game.opponentType === "cpu" || game.cpuId !== undefined) {
    const cpu = CPU_PROFILES.find((profile) => profile.id === game.cpuId);
    if (!cpu) invalid("CLOUD_PAYLOAD_INVALID_CPU_ID", `${path}.cpuId`, "Unknown CPU opponent", recordId);
    base.cpuId = cpu!.id;
    base.cpuName = text(game.cpuName, `${path}.cpuName`, recordId);
    base.cpuDifficulty = text(game.cpuDifficulty, `${path}.cpuDifficulty`, recordId);
    base.cpuStars = finite(game.cpuStars, `${path}.cpuStars`, recordId);
  }

  if (game.endReason === "mathematical_mercy") {
    base.mercyAtPossession = finite(game.mercyAtPossession, `${path}.mercyAtPossession`, recordId);
    base.mercyLeaderId = text(game.mercyLeaderId, `${path}.mercyLeaderId`, recordId);
    base.mercyTrailerId = text(game.mercyTrailerId, `${path}.mercyTrailerId`, recordId);
    base.mercyDeficit = finite(game.mercyDeficit, `${path}.mercyDeficit`, recordId);
    base.mercyRemainingPossessions = finite(game.mercyRemainingPossessions, `${path}.mercyRemainingPossessions`, recordId);
    base.mercyMaximumComeback = finite(game.mercyMaximumComeback, `${path}.mercyMaximumComeback`, recordId);
    base.mercyBestFinalDifferential = finite(game.mercyBestFinalDifferential, `${path}.mercyBestFinalDifferential`, recordId);
    base.mercyExplanation = text(game.mercyExplanation, `${path}.mercyExplanation`, recordId);
    if (game.mercyNextOffenseId !== undefined) base.mercyNextOffenseId = text(game.mercyNextOffenseId, `${path}.mercyNextOffenseId`, recordId);
  }

  return sanitizeFirestorePlainData(base, path);
}

export function toPersistedCloudState(players: PlayerProfile[], games: GameResult[]): PersistedCloudState {
  if (!Array.isArray(players)) invalid("CLOUD_PAYLOAD_INVALID_PLAYERS", "players", "Expected a player array");
  if (!Array.isArray(games)) invalid("CLOUD_PAYLOAD_INVALID_GAMES", "gameResults", "Expected a game-result array");
  const result = {
    players: players.map((player, index) => toPersistedPlayerProfile(player, index)),
    gameResults: games.map((game, index) => toPersistedGameResult(game, { index })),
  };
  return sanitizeFirestorePlainData(result);
}

const safeNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const normalizeStats = (value: unknown, points: number): PlayerGameStats => {
  const source = value && typeof value === "object" ? value as Partial<PlayerGameStats> : {};
  return {
    runYards: safeNumber(source.runYards), passYards: safeNumber(source.passYards), turnovers: safeNumber(source.turnovers),
    fieldGoals: Array.isArray(source.fieldGoals) ? source.fieldGoals.filter((attempt) => attempt && typeof attempt.distance === "number" && Number.isFinite(attempt.distance) && typeof attempt.made === "boolean").map((attempt) => ({ distance: attempt.distance, made: attempt.made })) : [],
    twoPointMade: safeNumber(source.twoPointMade), twoPointMissed: safeNumber(source.twoPointMissed),
    extraPointMade: safeNumber(source.extraPointMade), extraPointMissed: safeNumber(source.extraPointMissed),
    onsideRecoveries: safeNumber(source.onsideRecoveries), points: safeNumber(source.points, points),
  };
};

export function normalizeCloudStateForRuntime(data: unknown): { state: { players: PlayerProfile[]; gameResults: GameResult[] }; rejectedGameIds: string[] } {
  const source = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const players: PlayerProfile[] = [];
  for (const candidate of Array.isArray(source.players) ? source.players : []) {
    try { players.push(toPersistedPlayerProfile(candidate as PlayerProfile)); } catch { /* quarantine invalid profile */ }
  }
  const gameResults: GameResult[] = [], rejectedGameIds: string[] = [];
  for (const candidate of Array.isArray(source.gameResults) ? source.gameResults : []) {
    try {
      const raw = candidate as GameResult;
      const mapped = toPersistedGameResult(raw);
      mapped.stats = { p1: normalizeStats(raw.stats?.p1, mapped.p1Score), p2: normalizeStats(raw.stats?.p2, mapped.p2Score) };
      gameResults.push(mapped);
    } catch { rejectedGameIds.push(typeof (candidate as GameResult)?.id === "string" ? (candidate as GameResult).id : "unknown"); }
  }
  return { state: { players, gameResults }, rejectedGameIds };
}

export function mergeCloudStates(authoritative: { players: PlayerProfile[]; gameResults: GameResult[] }, pending: { players: PlayerProfile[]; gameResults: GameResult[] }) {
  const mergeById = <T extends { id: string }>(cloud: T[], local: T[]) => {
    const merged = new Map(cloud.map((item) => [item.id, item]));
    for (const item of local) merged.set(item.id, item);
    return [...merged.values()];
  };
  return { players: mergeById(authoritative.players, pending.players), gameResults: mergeById(authoritative.gameResults, pending.gameResults) };
}

export const isCpuIdForPersistence = (value: string): value is CpuId => CPU_PROFILES.some((profile) => profile.id === value);
