import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlayerGameStats, extraPointGood, fieldGoalGood, fgMinRank, fieldPercent, gamePlayerStats, gameSortMetric, interceptionStart, playerStats, puntDistance, resolveMatch, sortGameResults, valueOf } from "../app/game-engine.ts";

test("resolution chart and card values", () => {
  assert.equal(resolveMatch({color:"black",rank:"5"},{color:"black",rank:"8"}).gain, 0);
  assert.equal(resolveMatch({color:"black",rank:"9"},{color:"black",rank:"4"}).gain, 5);
  assert.equal(resolveMatch({color:"black",rank:"6"},{color:"red",rank:"7"}).gain, 13);
  assert.equal(resolveMatch({color:"red",rank:"6"},{color:"red",rank:"9"}).gain, -5);
  assert.equal(resolveMatch({color:"red",rank:"10"},{color:"red",rank:"3"}).gain, 7);
  assert.equal(resolveMatch({color:"red",rank:"8"},{color:"black",rank:"5"}).gain, 13);
  assert.equal(resolveMatch({color:"red",rank:"K"},{color:"black",rank:"2"}).gain, 14);
  assert.equal(valueOf("A"), 20); assert.equal(valueOf("Q"), 12);
});

test("aces, ties and interception placement", () => {
  assert.equal(resolveMatch({color:"red",rank:"A"},{color:"red",rank:"6"}).kind, "interception");
  assert.equal(resolveMatch({color:"red",rank:"A"},{color:"black",rank:"6"}).gain, 26);
  assert.equal(resolveMatch({color:"black",rank:"8"},{color:"red",rank:"8"}).kind, "tie");
  assert.equal(interceptionStart(30), 50); assert.equal(interceptionStart(79), 1);
  assert.equal(interceptionStart(80), 20); assert.equal(interceptionStart(95), 20);
});

test("distance-scaled field goals", () => {
  const cases = [[85,"3",false],[85,"4",true],[75,"4",false],[75,"5",true],[65,"6",false],[65,"7",true],[55,"8",false],[55,"9",true],[45,"10",false],[45,"J",true],[49,"10",false],[49,"J",true],[50,"8",false],[50,"9",true]] as const;
  for (const [spot,rank,good] of cases) assert.equal(fieldGoalGood(spot,rank),good);
  assert.equal(fgMinRank(39), null);
});

test("extra points use rank 4 as the minimum without changing field goals", () => {
  assert.equal(extraPointGood("2"), false);
  assert.equal(extraPointGood("3"), false);
  for (const rank of ["4","5","6","7","8","9","10","J","Q","K","A"] as const) assert.equal(extraPointGood(rank), true);
  assert.equal(fieldGoalGood(75, "4"), false);
});

test("punt values and player records", () => {
  assert.equal(puntDistance("2"),10); assert.equal(puntDistance("10"),50);
  assert.equal(puntDistance("K"),60); assert.equal(puntDistance("A"),70);
  const games = [0,1,2].map((n)=>({id:String(n),playedAt:n,p1PlayerId:"a",p2PlayerId:"b",p1Name:"A",p2Name:"B",p1Score:n<2?7:0,p2Score:n<2?0:7,winnerPlayerId:n<2?"a":"b",overtime:false,finalPossessionNum:8}));
  assert.deepEqual(playerStats("a",games),{gamesPlayed:3,wins:2,losses:1,winPct:67});
});

test("field coordinates reserve visible end zones", () => {
  assert.equal(fieldPercent(0), 5);
  assert.equal(fieldPercent(90), 86);
  assert.equal(fieldPercent(100), 95);
  assert.equal(fieldPercent(100) - fieldPercent(90), 9);
});

test("saved game detail metrics and legacy compatibility", () => {
  const legacy = {id:"old",playedAt:1,p1PlayerId:"a",p2PlayerId:"b",p1Name:"A",p2Name:"B",p1Score:7,p2Score:3,winnerPlayerId:"a",overtime:false,finalPossessionNum:8};
  assert.deepEqual(gamePlayerStats(legacy,"p1"),emptyPlayerGameStats(7));
  const detailed = {...legacy,id:"new",stats:{
    p1:{...emptyPlayerGameStats(14),runYards:40,passYards:60,turnovers:1,fieldGoals:[{distance:35,made:true},{distance:50,made:false}],twoPointMade:1,onsideRecoveries:1},
    p2:{...emptyPlayerGameStats(6),runYards:20,passYards:10,turnovers:2,fieldGoals:[{distance:25,made:true}]},
  }};
  assert.equal(gameSortMetric(detailed,"yards"),130);
  assert.equal(gameSortMetric(detailed,"fgAttempts"),3);
  assert.equal(gameSortMetric(detailed,"fgMakes"),2);
  assert.equal(gameSortMetric(detailed,"fgMisses"),1);
  assert.equal(gameSortMetric(detailed,"twoPointAttempts"),1);
  assert.equal(gameSortMetric(detailed,"onsideRecoveries"),1);
});

test("history defaults to most recently played first", () => {
  const base = {p1PlayerId:"a",p2PlayerId:"b",p1Name:"A",p2Name:"B",p1Score:7,p2Score:3,winnerPlayerId:"a",overtime:false,finalPossessionNum:8};
  const games = [{...base,id:"middle",playedAt:200},{...base,id:"oldest",playedAt:100},{...base,id:"newest",playedAt:300}];
  assert.deepEqual(sortGameResults(games).map((game) => game.id), ["newest","middle","oldest"]);
});
