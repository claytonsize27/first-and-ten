import test from "node:test";
import assert from "node:assert/strict";
import { buildVirtualDeck, cardStr, compareOpeningCards, cpuMatchupRecord, dealVirtualDeck, downDistanceLabel, drawOneVirtual, emptyPlayerGameStats, evaluateMathematicalMercy, extraPointGood, fieldGoalGood, fgMinRank, fieldPercent, filterGameResults, formatMercyExplanation, fumbleStart, gamePlayerStats, gameSortMetric, interceptionStart, isCpuGame, openingReceiverForChoice, playerStats, puntDistance, recordExtraPointResult, resolveMatch, sortGameResults, valueOf } from "../app/game-engine.ts";
import { CPU_PROFILES, chooseCpuCard, chooseCpuConversion, chooseCpuFourthDown, chooseCpuKickoff, chooseCpuOpeningChoice, getCpuProfile, type CpuCardContext } from "../app/cpu-engine.ts";

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
  assert.equal(resolveMatch({color:"black",rank:"A"},{color:"black",rank:"6"}).kind, "fumble");
  assert.equal(resolveMatch({color:"black",rank:"A"},{color:"red",rank:"6"}).gain, 26);
  assert.equal(resolveMatch({color:"black",rank:"8"},{color:"red",rank:"8"}).kind, "tie");
  assert.equal(interceptionStart(30), 50); assert.equal(interceptionStart(79), 1);
  assert.equal(interceptionStart(80), 20); assert.equal(interceptionStart(95), 20);
  assert.equal(fumbleStart(30), 70); assert.equal(fumbleStart(95), 5);
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

test("virtual deck has the exact standard 52-card distribution", () => {
  const deck = buildVirtualDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.id)).size, 52);
  assert.equal(deck.filter((card) => card.color === "black").length, 26);
  assert.equal(deck.filter((card) => card.color === "red").length, 26);
  for (const rank of ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]) assert.equal(deck.filter((card) => card.rank === rank).length, 4);
});

test("virtual deal and repeated reshuffles conserve all cards", () => {
  const dealt = dealVirtualDeck(() => 0.5);
  assert.equal(dealt.p1Hand.length, 5); assert.equal(dealt.p2Hand.length, 5);
  assert.equal(dealt.drawPile.length, 42); assert.equal(dealt.discardPile.length, 0);
  let state = { drawPile: dealt.drawPile, discardPile: dealt.discardPile }, reshuffles = 0;
  for (let i = 0; i < 500; i += 1) {
    const draw = drawOneVirtual(state, () => 0.25); if (draw.reshuffled) reshuffles += 1;
    state = { drawPile: draw.drawPile, discardPile: [...draw.discardPile, draw.card] };
    assert.equal(dealt.p1Hand.length + dealt.p2Hand.length + state.drawPile.length + state.discardPile.length, 52);
    assert.equal(new Set([...dealt.p1Hand,...dealt.p2Hand,...state.drawPile,...state.discardPile].map((card) => card.id)).size, 52);
  }
  assert.ok(reshuffles > 0);
});

test("virtual draws reshuffle discards and feed the same downstream card rules", () => {
  const deck = buildVirtualDeck(), draw = drawOneVirtual({drawPile:[],discardPile:deck.slice(0,3)},()=>0.5);
  assert.equal(draw.reshuffled,true); assert.equal(draw.drawPile.length,2); assert.equal(draw.discardPile.length,0);
  const virtualOffense=deck.find((card)=>card.rank==="8"&&card.suit==="♥")!,virtualDefense=deck.find((card)=>card.rank==="5"&&card.suit==="♠")!;
  assert.deepEqual(resolveMatch(virtualOffense,virtualDefense),resolveMatch({rank:"8",color:"red"},{rank:"5",color:"black"}));
  assert.equal(cardStr(virtualOffense),cardStr({rank:"8",color:"red"}));
});

test("CPU roster has stable identities and increasing ratings", () => {
  assert.deepEqual(CPU_PROFILES.map(cpu=>cpu.id),["cpu_rookie_riley","cpu_coach_morgan","cpu_captain_harper","cpu_commissioner"]);
  assert.deepEqual(CPU_PROFILES.map(cpu=>cpu.stars),[2,3,4,5]);
  assert.equal(getCpuProfile("cpu_commissioner")?.difficulty,"EXPERT");
  assert.equal(getCpuProfile("unknown"),null);
});

test("CPU card selection is deterministic, legal, and uses only supplied public context", () => {
  const deck=buildVirtualDeck(),hand=deck.slice(0,5);
  const context:CpuCardContext={role:"offense",down:3,distance:7,ballPos:63,cpuScore:7,humanScore:10,possessionNum:7,overtime:false,twoPoint:false,publicCards:deck.slice(10,18),humanPlayHistory:[{color:"red",down:2,distance:6}],decisionSeed:12345,decisionIndex:4};
  for(const cpu of CPU_PROFILES){const first=chooseCpuCard(cpu.id,hand,context),second=chooseCpuCard(cpu.id,hand,{...context});assert.equal(first.id,second.id);assert.ok(hand.some(card=>card.id===first.id));}
  const externalHiddenCards=deck.slice(30,35);
  assert.ok(externalHiddenCards.length===5);
  assert.equal(chooseCpuCard("cpu_commissioner",hand,context).id,chooseCpuCard("cpu_commissioner",hand,context).id);
});

test("CPU strategic decisions remain legal across game situations", () => {
  const base={down:4,distance:4,ballPos:75,cpuScore:10,humanScore:13,possessionNum:8,overtime:false,twoPoint:false,decisionSeed:77,decisionIndex:2};
  for(const cpu of CPU_PROFILES){assert.ok(["go","punt","fg"].includes(chooseCpuFourthDown(cpu.id,base)));assert.ok(["xp","two"].includes(chooseCpuConversion(cpu.id,base)));assert.ok(["deep","onside"].includes(chooseCpuKickoff(cpu.id,base)));}
  for(const cpu of CPU_PROFILES)assert.notEqual(chooseCpuFourthDown(cpu.id,{...base,ballPos:30}),"fg");
});

test("history identifies and filters CPU games while preserving legacy human games", () => {
  const base={playedAt:1,p1PlayerId:"a",p1Name:"A",p1Score:7,p2Score:3,winnerPlayerId:"a",overtime:false,finalPossessionNum:8};
  const human={...base,id:"human",p2PlayerId:"b",p2Name:"B"};
  const cpu={...base,id:"cpu",p2PlayerId:"cpu_rookie_riley",p2Name:"Rookie Riley",opponentType:"cpu" as const,cpuId:"cpu_rookie_riley"};
  assert.equal(isCpuGame(human),false);assert.equal(isCpuGame(cpu),true);
  assert.deepEqual(filterGameResults([human,cpu],"human").map(game=>game.id),["human"]);
  assert.deepEqual(filterGameResults([human,cpu],"cpu").map(game=>game.id),["cpu"]);
  assert.deepEqual(filterGameResults([human,cpu],"cpu_rookie_riley").map(game=>game.id),["cpu"]);
});

test("down-and-distance labels derive from authoritative field state", () => {
  assert.equal(downDistanceLabel(1,20,30),"1st and 10");
  assert.equal(downDistanceLabel(2,24,30),"2nd and 6");
  assert.equal(downDistanceLabel(3,19,30),"3rd and 11");
  assert.equal(downDistanceLabel(4,16,30),"4th and 14");
  assert.equal(downDistanceLabel(1,94,100),"1st and Goal");
  assert.equal(downDistanceLabel(1,98,100,true),"Two-point try · 2 yards");
});

test("opening high-card comparison uses rank order, ignores suit, and keeps gameplay deal fresh", () => {
  const deck=buildVirtualDeck(),card=(rank:string,suit:string)=>deck.find(item=>item.rank===rank&&item.suit===suit)!;
  assert.equal(compareOpeningCards(card("J","♠"),card("Q","♥")),-1);
  assert.equal(compareOpeningCards(card("Q","♣"),card("K","♦")),-1);
  assert.equal(compareOpeningCards(card("A","♠"),card("K","♥")),1);
  assert.equal(compareOpeningCards(card("8","♠"),card("8","♦")),0);
  assert.equal(openingReceiverForChoice("p1","receive"),"p1");assert.equal(openingReceiverForChoice("p1","kick"),"p2");
  assert.equal(openingReceiverForChoice("p2","receive"),"p2");assert.equal(openingReceiverForChoice("p2","kick"),"p1");
  const gameplay=dealVirtualDeck(()=>.42);
  assert.equal(gameplay.p1Hand.length,5);assert.equal(gameplay.p2Hand.length,5);assert.equal(gameplay.drawPile.length,42);assert.equal(gameplay.discardPile.length,0);
  assert.equal(new Set([...gameplay.p1Hand,...gameplay.p2Hand,...gameplay.drawPile].map(item=>item.id)).size,52);
});

test("CPU opening choice prefers receiving but supports a deterministic personality kick", () => {
  assert.equal(chooseCpuOpeningChoice("cpu_commissioner",123),"receive");
  const rookieChoices=new Set(Array.from({length:500},(_,seed)=>chooseCpuOpeningChoice("cpu_rookie_riley",seed)));
  assert.deepEqual([...rookieChoices].sort(),["kick","receive"]);
});

test("extra-point stats initialize and legacy saved values are safely normalized", () => {
  assert.equal(emptyPlayerGameStats().extraPointMade,0);assert.equal(emptyPlayerGameStats().extraPointMissed,0);
  const human=emptyPlayerGameStats(),cpu=emptyPlayerGameStats();recordExtraPointResult(human,true);recordExtraPointResult(human,false);recordExtraPointResult(cpu,false);recordExtraPointResult(cpu,false);
  assert.deepEqual([human.extraPointMade,human.extraPointMissed,cpu.extraPointMade,cpu.extraPointMissed],[1,1,0,2]);assert.deepEqual([human.twoPointMade,human.twoPointMissed],[0,0]);
  const base={id:"xp",playedAt:1,p1PlayerId:"a",p2PlayerId:"b",p1Name:"A",p2Name:"B",p1Score:7,p2Score:6,winnerPlayerId:"a",overtime:false,finalPossessionNum:8};
  const legacy={...base,stats:{p1:{...emptyPlayerGameStats(7),extraPointMade:undefined as unknown as number,extraPointMissed:NaN},p2:{...emptyPlayerGameStats(6)}}};
  assert.equal(gamePlayerStats(legacy,"p1").extraPointMade,0);assert.equal(gamePlayerStats(legacy,"p1").extraPointMissed,0);
  const saved={...base,stats:{p1:{...emptyPlayerGameStats(7),extraPointMade:1,extraPointMissed:2},p2:emptyPlayerGameStats(6)}};
  assert.deepEqual([gamePlayerStats(saved,"p1").extraPointMade,gamePlayerStats(saved,"p1").extraPointMissed],[1,2]);
});

test("CPU matchup records are calculated from the named CPU perspective", () => {
  const base={playedAt:1,p1PlayerId:"human",p2PlayerId:"cpu_commissioner",p1Name:"Human",p2Name:"The Commissioner",overtime:false,finalPossessionNum:8,opponentType:"cpu" as const,cpuId:"cpu_commissioner"};
  const games=[
    {...base,id:"cpu-win",p1Score:7,p2Score:14,winnerPlayerId:"cpu_commissioner"},
    {...base,id:"human-win-1",p1Score:14,p2Score:7,winnerPlayerId:"human"},
    {...base,id:"human-win-2",p1Score:10,p2Score:3,winnerPlayerId:"human"},
    {...base,id:"human-win-3",p1Score:21,p2Score:20,winnerPlayerId:"human"},
    {...base,id:"malformed-tie",p1Score:7,p2Score:7,winnerPlayerId:""},
  ];
  assert.deepEqual(cpuMatchupRecord(games,"cpu_commissioner"),{played:5,wins:1,losses:3});
  assert.deepEqual(cpuMatchupRecord(games,"cpu_rookie_riley"),{played:0,wins:0,losses:0});
});

test("mathematical mercy is disabled in overtime, when off, while tied, and on invalid state", () => {
  const base={scores:{p1:30,p2:0},completedPossession:6,nextOffense:"p2" as const,firstHalfOpener:"p1" as const,enabled:true,overtime:false};
  assert.equal(evaluateMathematicalMercy({...base,enabled:false}).shouldEnd,false);
  assert.equal(evaluateMathematicalMercy({...base,overtime:true}).shouldEnd,false);
  assert.equal(evaluateMathematicalMercy({...base,scores:{p1:14,p2:14}}).shouldEnd,false);
  assert.equal(evaluateMathematicalMercy({...base,nextOffense:null}).shouldEnd,false);
  assert.equal(evaluateMathematicalMercy({...base,scores:{p1:Number.NaN,p2:0}}).shouldEnd,false);
});

test("final possession ownership uses exact eight-point offense and two-point safety limits", () => {
  for(let deficit=1;deficit<=8;deficit+=1){
    const result=evaluateMathematicalMercy({scores:{p1:20,p2:20-deficit},completedPossession:7,nextOffense:"p2",firstHalfOpener:"p1",enabled:true,overtime:false});
    assert.equal(result.shouldEnd,false,`trailer offense deficit ${deficit}`);assert.equal(result.maximumComeback,8);
  }
  const nine=evaluateMathematicalMercy({scores:{p1:20,p2:11},completedPossession:7,nextOffense:"p2",firstHalfOpener:"p1",enabled:true,overtime:false});
  assert.equal(nine.shouldEnd,true);assert.equal(nine.bestFinalDifferential,-1);
  for(let deficit=1;deficit<=2;deficit+=1){
    const result=evaluateMathematicalMercy({scores:{p1:20,p2:20-deficit},completedPossession:7,nextOffense:"p1",firstHalfOpener:"p1",enabled:true,overtime:false});
    assert.equal(result.shouldEnd,false,`leader offense deficit ${deficit}`);assert.equal(result.maximumComeback,2);
  }
  assert.equal(evaluateMathematicalMercy({scores:{p1:20,p2:17},completedPossession:7,nextOffense:"p1",firstHalfOpener:"p1",enabled:true,overtime:false}).shouldEnd,true);
});

test("exact reachability includes conversions, onside recoveries, and halftime ownership", () => {
  const afterFive=(deficit:number)=>evaluateMathematicalMercy({scores:{p1:32,p2:32-deficit},completedPossession:5,nextOffense:"p2",firstHalfOpener:"p1",enabled:true,overtime:false});
  assert.equal(afterFive(24).shouldEnd,false);assert.equal(afterFive(24).maximumComeback,24);assert.equal(afterFive(25).shouldEnd,true);
  const halftime=(deficit:number)=>evaluateMathematicalMercy({scores:{p1:40,p2:40-deficit},completedPossession:4,nextOffense:"p2",firstHalfOpener:"p1",enabled:true,overtime:false});
  assert.equal(halftime(32).shouldEnd,false);assert.equal(halftime(32).maximumComeback,32);assert.equal(halftime(33).shouldEnd,true);
  const leaderOpensSecondHalf=(deficit:number)=>evaluateMathematicalMercy({scores:{p1:40,p2:40-deficit},completedPossession:4,nextOffense:"p1",firstHalfOpener:"p2",enabled:true,overtime:false});
  assert.equal(leaderOpensSecondHalf(26).shouldEnd,false);assert.equal(leaderOpensSecondHalf(26).maximumComeback,26);assert.equal(leaderOpensSecondHalf(27).shouldEnd,true);
  assert.deepEqual(afterFive(25),afterFive(25),"evaluation is deterministic");
});

test("mathematical mercy explanation and saved-game metadata remain legacy compatible", () => {
  const result=evaluateMathematicalMercy({scores:{p1:20,p2:11},completedPossession:7,nextOffense:"p2",firstHalfOpener:"p1",enabled:true,overtime:false});
  const explanation=formatMercyExplanation(result,{p1:"Austin",p2:"Clayton"},{p1:20,p2:11},7);
  assert.match(explanation,/Austin leads Clayton 20–11/);assert.match(explanation,/No onside kick is available after possession 8/);assert.match(explanation,/Overtime is impossible/);
  const legacy={id:"legacy-mercy",playedAt:1,p1PlayerId:"a",p2PlayerId:"b",p1Name:"A",p2Name:"B",p1Score:7,p2Score:0,winnerPlayerId:"a",overtime:false,finalPossessionNum:8};
  assert.equal("endReason" in legacy,false);assert.deepEqual(gamePlayerStats(legacy,"p1"),emptyPlayerGameStats(7));
});

test("CPU conversion logic preserves the required late two-point path", () => {
  const postTouchdown={down:1,distance:2,ballPos:98,cpuScore:14,humanScore:22,possessionNum:8,overtime:false,decisionSeed:19,decisionIndex:3};
  for(const cpu of CPU_PROFILES)assert.equal(chooseCpuConversion(cpu.id,postTouchdown),"two");
  const tieOnly={...postTouchdown,cpuScore:20};
  for(const cpu of CPU_PROFILES)assert.equal(chooseCpuConversion(cpu.id,tieOnly),"two");
});
