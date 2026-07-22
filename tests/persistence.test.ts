import assert from "node:assert/strict";
import test from "node:test";
import { CPU_PROFILES } from "../app/cpu-engine.ts";
import { emptyPlayerGameStats, type GameResult } from "../app/game-engine.ts";
import {
  mergeCloudStates, mergePersistedCollectionById, normalizeCloudStateForRuntime, PersistenceValidationError, recoverLegacyPendingState, sanitizeFirestorePlainData,
  toPersistedCloudState, toPersistedGameResult,
} from "../app/persistence.ts";

const currentGame = (overrides: Partial<GameResult> = {}): GameResult => ({
  id: "game-1", playedAt: 1_750_000_000_000,
  p1PlayerId: "player-1", p2PlayerId: "player-2", p1Name: "Austin", p2Name: "Clayton",
  p1Score: 7, p2Score: 6, winnerPlayerId: "player-1", overtime: false, finalPossessionNum: 8,
  stats: { p1: emptyPlayerGameStats(7), p2: emptyPlayerGameStats(6) },
  gameMode: "virtual", opponentType: "human", mercyRuleEnabled: true, endReason: "regulation",
  ...overrides,
});

test("sanitizer omits undefined object fields and preserves meaningful falsy values", () => {
  const result = sanitizeFirestorePlainData({ missing: undefined, no: false, zero: 0, blank: "", array: [], object: {} });
  assert.deepEqual(result, { no: false, zero: 0, blank: "", array: [], object: {} });
  assert.equal("missing" in result, false);
});

test("sanitizer reports undefined array members with an exact path", () => {
  assert.throws(() => sanitizeFirestorePlainData({ values: [1, undefined] }), (error) => {
    assert.ok(error instanceof PersistenceValidationError);
    assert.equal(error.code, "CLOUD_PAYLOAD_UNDEFINED_ARRAY_ELEMENT");
    assert.equal(error.path, "cloudState.values[1]");
    return true;
  });
});

test("sanitizer rejects functions, symbols, class instances, and non-finite numbers", () => {
  for (const value of [() => 1, Symbol("bad"), new Date(), Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sanitizeFirestorePlainData({ value } as object), PersistenceValidationError);
  }
});

test("current Human-vs-Human regulation mapping omits CPU and mercy proof keys", () => {
  const result = toPersistedGameResult(currentGame(), { requireCurrent: true });
  assert.equal(result.opponentType, "human");
  assert.equal(result.mercyRuleEnabled, true);
  assert.equal(result.endReason, "regulation");
  for (const key of ["cpuId", "cpuName", "cpuDifficulty", "cpuStars", "mercyAtPossession", "mercyExplanation"]) {
    assert.equal(key in result, false);
  }
});

test("all built-in CPU profiles map with valid metadata and no mercy proof keys", () => {
  for (const cpu of CPU_PROFILES) {
    const result = toPersistedGameResult(currentGame({
      id: `game-${cpu.id}`, p2PlayerId: cpu.id, p2Name: cpu.name, opponentType: "cpu",
      cpuId: cpu.id, cpuName: cpu.name, cpuDifficulty: cpu.difficulty, cpuStars: cpu.stars,
    }), { requireCurrent: true });
    assert.equal(result.cpuId, cpu.id);
    assert.equal("mercyAtPossession" in result, false);
  }
});

test("mathematical-mercy mapping requires and preserves its proof", () => {
  const result = toPersistedGameResult(currentGame({
    endReason: "mathematical_mercy", finalPossessionNum: 7,
    mercyAtPossession: 7, mercyLeaderId: "player-1", mercyTrailerId: "player-2",
    mercyDeficit: 9, mercyRemainingPossessions: 1, mercyNextOffenseId: "player-2",
    mercyMaximumComeback: 8, mercyBestFinalDifferential: -1,
    mercyExplanation: "The trailer has no legal path to tie or take the lead.",
  }), { requireCurrent: true });
  assert.equal(result.mercyDeficit, 9);
  assert.equal(result.mercyBestFinalDifferential, -1);
  assert.throws(() => toPersistedGameResult(currentGame({ endReason: "mathematical_mercy" }), { requireCurrent: true }), PersistenceValidationError);
});

test("overtime result preserves zero statistics without undefined mercy details", () => {
  const result = toPersistedGameResult(currentGame({ overtime: true, endReason: "overtime", finalPossessionNum: 10 }), { requireCurrent: true });
  assert.equal(result.stats?.p1.runYards, 0);
  assert.equal(result.stats?.p1.extraPointMade, 0);
  assert.equal("mercyExplanation" in result, false);
});

test("legacy cloud reads supply stat defaults without inventing newer metadata", () => {
  const legacy = currentGame();
  delete legacy.stats; delete legacy.gameMode; delete legacy.opponentType; delete legacy.mercyRuleEnabled; delete legacy.endReason;
  const normalized = normalizeCloudStateForRuntime({ players: [], gameResults: [legacy] });
  assert.equal(normalized.rejectedGameIds.length, 0);
  assert.equal(normalized.state.gameResults[0].stats?.p1.points, 7);
  assert.equal(normalized.state.gameResults[0].extraPointMade, undefined);
  assert.equal("gameMode" in normalized.state.gameResults[0], false);
});

test("legacy CPU identity metadata remains available to matchup filters", () => {
  const cpu = CPU_PROFILES[0];
  const legacyCpu = currentGame({ p2PlayerId: cpu.id, p2Name: cpu.name, cpuId: cpu.id, cpuName: cpu.name, cpuDifficulty: cpu.difficulty, cpuStars: cpu.stars });
  delete legacyCpu.opponentType;
  const normalized = normalizeCloudStateForRuntime({ players: [], gameResults: [legacyCpu] });
  assert.equal(normalized.state.gameResults[0].cpuId, cpu.id);
});

test("retry merging preserves authoritative records and de-duplicates stable local IDs", () => {
  const cloudGame = currentGame({ id: "cloud" });
  const revised = currentGame({ id: "shared", p1Score: 14 });
  const merged = mergeCloudStates(
    { players: [{ id: "cloud-player", name: "Cloud", createdAt: 1 }], gameResults: [cloudGame, currentGame({ id: "shared" })] },
    { players: [{ id: "local-player", name: "Local", createdAt: 2 }], gameResults: [revised] },
  );
  assert.deepEqual(merged.gameResults.map((game) => game.id), ["cloud", "shared"]);
  assert.equal(merged.gameResults.find((game) => game.id === "shared")?.p1Score, 14);
  assert.equal(merged.players.length, 2);
});

test("legacy failed saves recover only missing IDs with same-account evidence", () => {
  const profile = { id: "player-1", name: "Austin", createdAt: 1 };
  const cloud = { players: [profile], gameResults: [currentGame()] };
  const localOnly = currentGame({ id: "local-only", p1Score: 21 });
  const recovered = recoverLegacyPendingState(cloud, { players: [profile], gameResults: [currentGame({ p1Score: 99 }), localOnly] });
  assert.deepEqual(recovered?.gameResults.map((game) => game.id), ["game-1", "local-only"]);
  assert.equal(recovered?.gameResults[0].p1Score, 7, "authoritative copy must not be overwritten");
  assert.equal(recoverLegacyPendingState(cloud, { players: [{ id: "other", name: "Other", createdAt: 2 }], gameResults: [] }), null);
});

test("whole-document writes append new IDs without replacing authoritative records", () => {
  const cloudCopy = currentGame({ id: "shared", p1Score: 7 });
  const staleLocalCopy = currentGame({ id: "shared", p1Score: 99 });
  const localOnly = currentGame({ id: "new", p1Score: 14 });
  const merged = mergePersistedCollectionById([cloudCopy], [staleLocalCopy, localOnly]) as GameResult[];
  assert.deepEqual(merged.map((game) => game.id), ["shared", "new"]);
  assert.equal(merged.find((game) => game.id === "shared")?.p1Score, 7);
});

test("legacy recovery can recognize recreated profiles by normalized name without auto-writing", () => {
  const cloud = { players: [{ id: "new-austin", name: "Austin", createdAt: 2 }], gameResults: [] };
  const cached = { players: [{ id: "old-austin", name: " austin ", createdAt: 1 }], gameResults: [currentGame({ id: "old-game", p1PlayerId: "old-austin" })] };
  assert.equal(recoverLegacyPendingState(cloud, cached)?.gameResults[0].id, "old-game");
});

test("cloud mapping removes nested undefined without losing valid records", () => {
  const game = currentGame() as GameResult & { futureOptional?: string };
  game.futureOptional = undefined;
  const state = toPersistedCloudState([{ id: "player-1", name: "Austin", createdAt: 1 }], [game]);
  assert.equal(state.gameResults.length, 1);
  assert.equal("futureOptional" in state.gameResults[0], false);
});

test("invalid required fields identify their record and precise path", () => {
  assert.throws(() => toPersistedCloudState([], [currentGame({ playedAt: Number.NaN })]), (error) => {
    assert.ok(error instanceof PersistenceValidationError);
    assert.equal(error.recordId, "game-1");
    assert.equal(error.path, "gameResults[0].playedAt");
    return true;
  });
});

test("read normalization quarantines only malformed games", () => {
  const normalized = normalizeCloudStateForRuntime({ players: [], gameResults: [currentGame(), { ...currentGame({ id: "bad" }), p1Name: "" }] });
  assert.deepEqual(normalized.rejectedGameIds, ["bad"]);
  assert.deepEqual(normalized.state.gameResults.map((game) => game.id), ["game-1"]);
});
