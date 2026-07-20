"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Card, CardColor, GameResult, MatchResult, PlayerGameStats, PlayerProfile, RANKS, Rank, VirtualCard,
  cardStr, displaySpot, extraPointGood, fgMinRank, fieldGoalGood, fieldPercent, fumbleStart, interceptionStart, ordinal,
  dealVirtualDeck, drawOneVirtual, emptyPlayerGameStats, filterGameResults, gamePlayerStats, isCpuGame, playerStats, puntDistance, resolveMatch, sortGameResults, valueOf, yd,
} from "./game-engine";
import {
  CPU_PROFILES, chooseCpuCard, chooseCpuConversion, chooseCpuFourthDown, chooseCpuKickoff, getCpuProfile,
  type CpuCardContext, type CpuId, type PublicHumanPlay,
} from "./cpu-engine";
import type { User } from "firebase/auth";
import { cloudConfigured, saveCloudState, signInToCloud, signOutOfCloud, watchAuth, watchCloudState } from "./cloud-store";

type Team = "p1" | "p2";
type Phase = "home" | "deckMode" | "names" | "possession" | "play" | "pat" | "onsideChoice" | "suddenDeathStart" | "gameOver" | "rules" | "history";
type SubMode = null | "tie" | "fg" | "punt" | "xp" | "onside";
type GameMode = null | "physical" | "virtual";
type TurnStage = null | "offenseSelect" | "handoff" | "defenseSelect" | "cpuChoosing" | "reveal";
type Session = {
  phase: Phase; p1: string; p2: string; p1PlayerId: string; p2PlayerId: string;
  firstHalfOpener: Team; offense: Team; possessionNum: number; ballPos: number;
  down: number; lineToGain: number; scores: Record<Team, number>; overtime: boolean;
  otStarter: Team; twoPoint: boolean; pendingOff: Card | null; pendingDef: Card | null;
  subMode: SubMode; scoringTeam: Team | null; pendingNext: { offense: Team; ballPos: number } | null;
  postScoreBanner: string; driveOver: boolean; driveOverMsg: string; log: string[];
  stats: Record<Team, PlayerGameStats>;
  gameMode: GameMode; drawPile: VirtualCard[]; discardPile: VirtualCard[];
  p1Hand: VirtualCard[]; p2Hand: VirtualCard[]; turnStage: TurnStage;
  pendingOffenseCard: VirtualCard | null; pendingDefenseCard: VirtualCard | null;
  pendingTieBreakCard: VirtualCard | null; pendingSubDrawCard: VirtualCard | null;
  cpuId: CpuId | null; cpuSeed: number; cpuDecisionIndex: number; humanPlayHistory: PublicHumanPlay[];
  resultSaved: null | boolean;
};

const initial = (phase: Phase = "home"): Session => ({
  phase, p1: "", p2: "", p1PlayerId: "", p2PlayerId: "", firstHalfOpener: "p1",
  offense: "p1", possessionNum: 1, ballPos: 20, down: 1, lineToGain: 30,
  scores: { p1: 0, p2: 0 }, overtime: false, otStarter: "p1", twoPoint: false,
  pendingOff: null, pendingDef: null, subMode: null, scoringTeam: null,
  pendingNext: null, postScoreBanner: "", driveOver: false, driveOverMsg: "", log: [],
  stats: { p1: emptyPlayerGameStats(), p2: emptyPlayerGameStats() }, resultSaved: null,
  gameMode: null, drawPile: [], discardPile: [], p1Hand: [], p2Hand: [], turnStage: null,
  pendingOffenseCard: null, pendingDefenseCard: null, pendingTieBreakCard: null, pendingSubDrawCard: null,
  cpuId: null, cpuSeed: 0, cpuDecisionIndex: 0, humanPlayHistory: [],
});
const other = (team: Team): Team => team === "p1" ? "p2" : "p1";
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function FirstAndTen() {
  const [session, setSession] = useState<Session>(() => initial());
  const [undoStack, setUndoStack] = useState<Session[]>([]);
  const readCache = <T,>(key: string): T[] => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const [players, setPlayers] = useState<PlayerProfile[]>(() => readCache<PlayerProfile>("first-ten-players"));
  const [games, setGames] = useState<GameResult[]>(() => readCache<GameResult>("first-ten-results"));
  const [selected, setSelected] = useState<Record<Team, string>>({ p1: "", p2: "" });
  const [newNames, setNewNames] = useState<Record<Team, string>>({ p1: "", p2: "" });
  const [offCard, setOffCard] = useState<Partial<Card>>({});
  const [defCard, setDefCard] = useState<Partial<Card>>({});
  const [drawColor, setDrawColor] = useState<CardColor | null>(null);
  const [drawRank, setDrawRank] = useState<Rank | null>(null);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [guestMode, setGuestMode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selectedVirtualCard, setSelectedVirtualCard] = useState("");
  const [openingReceiver, setOpeningReceiver] = useState<Team | null>(null);
  const [player2Kind, setPlayer2Kind] = useState<"human" | "cpu">("human");
  const [selectedCpuId, setSelectedCpuId] = useState<CpuId | null>(null);

  useEffect(() => {
    let stopCloud: () => void = () => undefined;
    const stopAuth = watchAuth((user) => {
      stopCloud(); setCloudUser(user); setAuthReady(true); setCloudError("");
      if (!user) { setCloudReady(false); return; }
      setGuestMode(false);
      setCloudReady(false);
      stopCloud = watchCloudState(user.uid, (data) => {
        if (data) {
          setPlayers(data.players); setGames(data.gameResults);
          try { localStorage.setItem("first-ten-players", JSON.stringify(data.players)); localStorage.setItem("first-ten-results", JSON.stringify(data.gameResults)); } catch { /* cache is optional */ }
          setCloudReady(true);
        } else {
          const cachedPlayers = readCache<PlayerProfile>("first-ten-players");
          const cachedGames = readCache<GameResult>("first-ten-results");
          void saveCloudState(user.uid, { players: cachedPlayers, gameResults: cachedGames }).then(() => setCloudReady(true)).catch((error: Error) => setCloudError(error.message));
        }
      }, (error) => { setCloudError(error.message); setCloudReady(true); });
    });
    return () => { stopCloud(); stopAuth(); };
  }, []);

  useEffect(() => {
    setSelectedVirtualCard("");
    setSession((s) => s.gameMode === "virtual" && s.phase === "play" && !s.driveOver && !s.subMode && !s.turnStage && (s.down !== 4 || s.twoPoint)
      ? { ...s, turnStage: "offenseSelect" } : s);
  }, [session.phase, session.down, session.twoPoint, session.driveOver, session.subMode, session.turnStage, session.gameMode]);

  const persistCollections = (nextPlayers: PlayerProfile[], nextGames: GameResult[]) => {
    if (!cloudUser) return;
    try { localStorage.setItem("first-ten-players", JSON.stringify(nextPlayers)); localStorage.setItem("first-ten-results", JSON.stringify(nextGames)); } catch { /* cache is optional */ }
    void saveCloudState(cloudUser.uid, { players: nextPlayers, gameResults: nextGames }).catch((error: Error) => setCloudError(error.message));
  };
  const nameOf = (t: Team, s = session) => s[t] || (t === "p1" ? "Player 1" : "Player 2");
  const accent = (t: Team) => t === "p1" ? "var(--p1)" : "var(--p2)";
  const push = (current = session) => setUndoStack((u) => [...u.slice(-39), structuredClone(current)]);
  const act = (fn: (s: Session) => Session, withUndo = true) => {
    setSession((current) => { if (withUndo) push(current); return fn(structuredClone(current)); });
  };
  const clearInputs = () => { setOffCard({}); setDefCard({}); setDrawColor(null); setDrawRank(null); };
  const addLog = (s: Session, line: string) => { s.log = [line, ...s.log].slice(0, 60); };
  const addPoints = (s: Session, team: Team, points: number) => { s.scores[team] += points; s.stats[team].points += points; };
  const endDrive = (s: Session, msg: string, next: { offense: Team; ballPos: number }) => {
    s.driveOver = true; s.driveOverMsg = msg; s.pendingNext = next; s.subMode = null;
  };
  const onsideEligible = (s: Session) => !s.overtime && s.possessionNum !== 4 && s.possessionNum !== 8;
  const afterScore = (s: Session, scorer: Team, banner: string) => {
    s.twoPoint = false; s.scoringTeam = scorer; s.postScoreBanner = banner; s.subMode = null;
    if (onsideEligible(s)) s.phase = "onsideChoice";
    else endDrive(s, banner, { offense: other(scorer), ballPos: 20 });
  };
  const kickDeep = (s: Session) => {
    const scorer = s.scoringTeam!; const receiver = other(scorer);
    addLog(s, `${nameOf(scorer, s)} kicks off deep. ${nameOf(receiver, s)} receives at its 20.`);
    endDrive(s, `${nameOf(scorer, s)} kicks off — ${nameOf(receiver, s)} receives.`, { offense: receiver, ballPos: 20 });
  };

  const playNarrative = (s: Session, result: MatchResult, o: Card, d: Card) => {
    const O = `${nameOf(s.offense, s)} (${cardStr(o)})`;
    const D = `${nameOf(other(s.offense), s)} (${cardStr(d)})`;
    const g = result.gain ?? 0;
    const lines: Record<string, string> = {
      run: `${O} runs for ${yd(g)} vs ${D}.`, runbit: `${O} breaks a run for ${yd(g)} vs ${D}.`,
      pass: `${O} completes a pass for ${yd(g)} vs ${D}.`, wideopen: `${O} finds a receiver wide open for ${yd(g)} vs ${D}.`,
      breakaway: `${O} breaks free for ${yd(g)} vs ${D}!`, stuff: `${O} is stuffed at the line by ${D} — no gain.`,
      sack: `${D} sacks ${O} for a loss of 5.`, interception: `${O} is intercepted by ${D}!`,
      fumble: `${O} fumbles! ${D} recovers at the spot.`,
    };
    return lines[result.kind] || "";
  };

  const applyOutcome = (s: Session, result: MatchResult, o: Card, d: Card, tieKind?: "recover" | "fumble") => {
    const offense = s.offense, defense = other(offense), los = s.ballPos;
    let narrative = tieKind === "recover"
      ? `Broken play — ${nameOf(offense, s)} (${cardStr(o)}) and ${nameOf(defense, s)} (${cardStr(d)}) tie. ${nameOf(offense, s)} recovers for ${yd(valueOf(o.rank))}.`
      : tieKind === "fumble"
        ? `Broken play — ${nameOf(offense, s)} (${cardStr(o)}) and ${nameOf(defense, s)} (${cardStr(d)}) tie. ${nameOf(defense, s)} recovers the fumble.`
        : playNarrative(s, result, o, d);
    if (s.twoPoint) {
      const good = tieKind === "recover" || (!["interception", "fumble"].includes(result.kind) && result.gain !== undefined && result.gain >= 2);
      if (good) { addPoints(s, offense, 2); s.stats[offense].twoPointMade += 1; }
      else s.stats[offense].twoPointMissed += 1;
      addLog(s, `${narrative} Two-point try is ${good ? "GOOD! (+2)" : "no good."}`);
      afterScore(s, offense, `Two-point try: ${good ? "GOOD (+2)." : "no good."}`);
      return;
    }
    if (tieKind === "fumble" || result.kind === "interception" || result.kind === "fumble") {
      s.stats[offense].turnovers += 1;
      addLog(s, narrative);
      const spot = result.kind === "interception" ? interceptionStart(los) : fumbleStart(los);
      const msg = result.kind === "interception"
        ? (los >= 80 ? `Intercepted by ${nameOf(defense, s)} in the end zone area — touchback. ${nameOf(defense, s)} starts at its own 20.` : `Intercepted by ${nameOf(defense, s)}! Returned to ${nameOf(defense, s)}'s own ${Math.min(spot, 100 - spot)}.`)
        : `Fumble! ${nameOf(defense, s)} recovers at the spot.`;
      endDrive(s, msg, { offense: defense, ballPos: spot }); return;
    }
    const gain = tieKind === "recover" ? valueOf(o.rank) : result.gain ?? 0;
    s.stats[offense][o.color === "black" ? "runYards" : "passYards"] += gain;
    const newPos = los + gain;
    if (newPos >= 100) {
      addPoints(s, offense, 6); addLog(s, `${narrative} TOUCHDOWN!`); s.scoringTeam = offense; s.phase = "pat"; s.subMode = null; return;
    }
    if (newPos < 0) {
      addPoints(s, defense, 2); addLog(s, `${narrative} — ${nameOf(defense, s)} gets a SAFETY! (+2)`);
      endDrive(s, `SAFETY! ${nameOf(defense, s)} +2.`, { offense: defense, ballPos: 20 }); return;
    }
    if (newPos >= s.lineToGain) {
      s.ballPos = newPos; s.down = 1; s.lineToGain = Math.min(newPos + 10, 100); addLog(s, `${narrative} First down.`); return;
    }
    if (s.down === 4) {
      addLog(s, `${narrative} Turned away on downs — ${nameOf(defense, s)} takes over.`);
      endDrive(s, `Turnover on downs — ${nameOf(defense, s)} takes over.`, { offense: defense, ballPos: 100 - newPos }); return;
    }
    s.ballPos = newPos; s.down += 1;
    const distance = s.lineToGain === 100 ? "GOAL" : String(s.lineToGain - newPos);
    addLog(s, `${narrative} ${ordinal(s.down)} & ${distance}.`);
  };

  const runPlay = () => {
    if (!offCard.color || !offCard.rank || !defCard.color || !defCard.rank) return;
    const o = offCard as Card, d = defCard as Card; clearInputs();
    act((s) => { const result = resolveMatch(o, d); if (result.kind === "tie") { s.pendingOff = o; s.pendingDef = d; s.subMode = "tie"; } else applyOutcome(s, result, o, d); return s; });
  };
  const applySubResult = (s: Session, mode: SubMode, rank: Rank | null, color: CardColor | null) => {
    const offense = s.offense, defense = other(offense);
    if (mode === "tie" && s.pendingOff && s.pendingDef && color) applyOutcome(s, { kind: "tie" }, s.pendingOff, s.pendingDef, color === "red" ? "recover" : "fumble");
    if (mode === "fg" && rank) {
      const distance = 100 - s.ballPos, good = fieldGoalGood(s.ballPos, rank);
      s.stats[offense].fieldGoals.push({ distance, made: good });
      if (good) { addPoints(s, offense, 3); addLog(s, `${nameOf(offense, s)} drills the ${distance}-yard field goal! (+3)`); afterScore(s, offense, `Field goal (${distance} yds) is GOOD (+3)!`); }
      else { addLog(s, `${nameOf(offense, s)} misses the ${distance}-yard field goal attempt — ${nameOf(defense, s)} takes over.`); endDrive(s, `Field goal (${distance} yds) is NO GOOD — ${nameOf(defense, s)} takes over.`, { offense: defense, ballPos: 100 - s.ballPos }); }
    }
    if (mode === "punt" && rank) {
      const puntYards = puntDistance(rank), landing = s.ballPos + puntYards, touchback = landing >= 100, spot = touchback ? 20 : 100 - landing;
      addLog(s, touchback ? `${nameOf(offense, s)} punts ${puntYards} yards into the end zone — touchback.` : `${nameOf(offense, s)} punts ${puntYards} yards. ${nameOf(defense, s)} takes over.`);
      endDrive(s, touchback ? `Punt ${puntYards} yds — touchback. ${nameOf(defense, s)} at its 20.` : `Punt ${puntYards} yds — ${nameOf(defense, s)} takes over.`, { offense: defense, ballPos: spot });
    }
    if (mode === "xp" && rank && s.scoringTeam) {
      const good = extraPointGood(rank); if (good) addPoints(s, s.scoringTeam, 1);
      addLog(s, `${nameOf(s.scoringTeam, s)} extra point is ${good ? "good. (+1)" : "no good."}`);
      afterScore(s, s.scoringTeam, `${nameOf(s.scoringTeam, s)} TD — extra point ${good ? "GOOD (+1)." : "missed."}`);
    }
    if (mode === "onside" && rank && s.scoringTeam) {
      const recovered = rank === "K" || rank === "A", next = recovered ? s.scoringTeam : other(s.scoringTeam);
      if (recovered) s.stats[s.scoringTeam].onsideRecoveries += 1;
      addLog(s, recovered ? `${nameOf(s.scoringTeam, s)} recovers the onside kick! Ball at the 50.` : `${nameOf(s.scoringTeam, s)} onside kick fails — ${nameOf(next, s)} takes over at the 50.`);
      endDrive(s, recovered ? `Onside RECOVERED! ${nameOf(s.scoringTeam, s)} keeps it at the 50.` : `Onside failed — ${nameOf(next, s)} ball at the 50.`, { offense: next, ballPos: 50 });
    }
  };
  const resolveSub = () => {
    const mode = session.subMode;
    if (mode === "tie" && !drawColor) return;
    if ((mode === "fg" || mode === "punt" || mode === "xp" || mode === "onside") && !drawRank) return;
    act((s) => {
      applySubResult(s, mode, drawRank, drawColor);
      s.pendingOff = null; s.pendingDef = null; return s;
    }); clearInputs();
  };

  const drawFromVirtualDeck = (s: Session) => {
    const draw = drawOneVirtual({ drawPile: s.drawPile, discardPile: s.discardPile });
    s.drawPile = draw.drawPile; s.discardPile = draw.discardPile;
    if (draw.reshuffled) addLog(s, "Deck reshuffled.");
    return draw.card;
  };
  const cpuCardContext = (s: Session, role: "offense" | "defense"): CpuCardContext => ({
    role, down: s.down, distance: Math.max(1, s.lineToGain - s.ballPos), ballPos: s.ballPos,
    cpuScore: s.scores.p2, humanScore: s.scores.p1, possessionNum: s.possessionNum,
    overtime: s.overtime, twoPoint: s.twoPoint, publicCards: s.discardPile,
    humanPlayHistory: s.humanPlayHistory, decisionSeed: s.cpuSeed, decisionIndex: s.cpuDecisionIndex,
  });
  const cpuSituation = (s: Session) => ({
    down: s.down, distance: Math.max(1, s.lineToGain - s.ballPos), ballPos: s.ballPos,
    cpuScore: s.scores.p2, humanScore: s.scores.p1, possessionNum: s.possessionNum,
    overtime: s.overtime, decisionSeed: s.cpuSeed, decisionIndex: s.cpuDecisionIndex,
  });
  const commitCpuCard = (s: Session, role: "offense" | "defense") => {
    if (!s.cpuId) return false;
    const card = chooseCpuCard(s.cpuId, s.p2Hand, cpuCardContext(s, role)) ?? s.p2Hand[0];
    if (!card) return false;
    s.p2Hand = s.p2Hand.filter((item) => item.id !== card.id); s.cpuDecisionIndex += 1;
    if (role === "offense") { s.pendingOffenseCard = card; s.turnStage = "defenseSelect"; }
    else { s.pendingDefenseCard = card; s.turnStage = "reveal"; }
    return true;
  };
  const confirmVirtualSelection = () => {
    if (!selectedVirtualCard || (session.turnStage !== "offenseSelect" && session.turnStage !== "defenseSelect")) return;
    act((s) => {
      const selectingTeam = s.turnStage === "offenseSelect" ? s.offense : other(s.offense), key = `${selectingTeam}Hand` as "p1Hand" | "p2Hand";
      const card = s[key].find((item) => item.id === selectedVirtualCard); if (!card) return s;
      s[key] = s[key].filter((item) => item.id !== card.id);
      if (s.turnStage === "offenseSelect") { s.pendingOffenseCard = card; s.turnStage = s.cpuId ? "cpuChoosing" : "handoff"; }
      else { s.pendingDefenseCard = card; s.turnStage = "reveal"; }
      return s;
    }); setSelectedVirtualCard("");
  };
  const drawVirtualTieBreak = () => act((s) => { s.pendingTieBreakCard = drawFromVirtualDeck(s); return s; });
  const continueVirtualPlay = () => act((s) => {
    const o = s.pendingOffenseCard, d = s.pendingDefenseCard; if (!o || !d) return s;
    if (s.cpuId) { const humanCard=s.offense==="p1"?o:d; s.humanPlayHistory.push({ color: humanCard.color, down: s.down, distance: Math.max(1, s.lineToGain - s.ballPos) }); }
    const result = resolveMatch(o, d);
    if (result.kind === "tie") { if (!s.pendingTieBreakCard) return s; applyOutcome(s, result, o, d, s.pendingTieBreakCard.color === "red" ? "recover" : "fumble"); }
    else applyOutcome(s, result, o, d);
    s.discardPile.push(o, d); if (s.pendingTieBreakCard) s.discardPile.push(s.pendingTieBreakCard);
    while (s.p1Hand.length < 5) s.p1Hand.push(drawFromVirtualDeck(s));
    while (s.p2Hand.length < 5) s.p2Hand.push(drawFromVirtualDeck(s));
    s.pendingOffenseCard = null; s.pendingDefenseCard = null; s.pendingTieBreakCard = null; s.turnStage = null;
    return s;
  });
  const drawVirtualSubCard = () => act((s) => { s.pendingSubDrawCard = drawFromVirtualDeck(s); return s; });
  const continueVirtualSub = () => act((s) => {
    const card = s.pendingSubDrawCard; if (!card) return s;
    applySubResult(s, s.subMode, card.rank, card.color); s.discardPile.push(card); s.pendingSubDrawCard = null; return s;
  });

  const undo = () => {
    const prior = undoStack[undoStack.length - 1]; if (!prior || session.resultSaved !== null) return;
    setSession(prior); setUndoStack((u) => u.slice(0, -1)); clearInputs();
  };
  const createPlayer = (team: Team, event: FormEvent) => {
    event.preventDefault(); const name = newNames[team].trim(); if (!name || !cloudUser) return;
    const profile = { id: uid(), name, createdAt: Date.now() }; const updated = [...players, profile];
    setPlayers(updated); persistCollections(updated, games); setSelected((v) => ({ ...v, [team]: profile.id })); setNewNames((v) => ({ ...v, [team]: "" }));
  };
  const resetSetup = (phase: Phase = "deckMode") => { setSession(initial(phase)); setUndoStack([]); setSelected({ p1: "", p2: "" }); setSelectedVirtualCard(""); setOpeningReceiver(null); setPlayer2Kind("human"); setSelectedCpuId(null); clearInputs(); };
  const navigate = (phase: Phase) => { if (phase === "deckMode") resetSetup("deckMode"); else { setSession((s) => ({ ...s, phase })); if (phase === "home" || phase === "rules" || phase === "history") setSelected({ p1: "", p2: "" }); } };
  const chooseDeckMode = (gameMode: Exclude<GameMode,null>) => { setPlayer2Kind("human"); setSelectedCpuId(null); setSession((s) => ({ ...s, gameMode, cpuId: null, phase: "names" })); };
  const choosePlayer2Kind = (kind: "human" | "cpu") => { setPlayer2Kind(kind); if (kind === "cpu") setSelected((value) => ({ ...value, p2: "" })); else setSelectedCpuId(null); };
  const confirmPlayers = () => {
    if (!selected.p1 || !selected.p2 || selected.p1 === selected.p2) return;
    const p1 = players.find((p) => p.id === selected.p1)!, p2 = players.find((p) => p.id === selected.p2)!;
    setSession((s) => ({ ...s, phase: "possession", p1: p1.name, p2: p2.name, p1PlayerId: p1.id, p2PlayerId: p2.id }));
  };
  const confirmGuestPlayers = () => {
    const p1 = newNames.p1.trim(), p2 = newNames.p2.trim();
    if (!p1 || !p2 || p1.toLocaleLowerCase() === p2.toLocaleLowerCase()) return;
    setSession((s) => ({ ...s, phase: "possession", p1, p2, p1PlayerId: "", p2PlayerId: "" }));
  };
  const confirmCpuGame = () => {
    const cpu = getCpuProfile(selectedCpuId); if (!cpu) return;
    if (guestMode) {
      const p1 = newNames.p1.trim(); if (!p1) return;
      setSession((s) => ({ ...s, phase: "possession", p1, p2: cpu.name, p1PlayerId: "", p2PlayerId: cpu.id, cpuId: cpu.id }));
      return;
    }
    const p1 = players.find((player) => player.id === selected.p1); if (!p1) return;
    setSession((s) => ({ ...s, phase: "possession", p1: p1.name, p2: cpu.name, p1PlayerId: p1.id, p2PlayerId: cpu.id, cpuId: cpu.id }));
  };
  const continueAsGuest = () => {
    setGuestMode(true); setCloudError(""); setPlayers([]); setGames([]);
    setNewNames({ p1: "", p2: "" }); resetSetup("home");
  };
  const startGame = (team: Team) => { setOpeningReceiver(null); act((s) => { if (s.gameMode === "virtual") Object.assign(s, dealVirtualDeck()); return { ...s, firstHalfOpener: team, offense: team, possessionNum: 1, ballPos: 20, down: 1, lineToGain: 30, phase: "play", cpuSeed: s.cpuId ? Math.floor(Math.random() * 0xFFFFFFFF) : 0, cpuDecisionIndex: 0, humanPlayHistory: [], turnStage: s.gameMode === "virtual" ? "offenseSelect" : null }; }); };
  const startNextDrive = () => {
    act((s) => {
      const n = s.possessionNum;
      if (!s.overtime && n >= 8) { s.phase = s.scores.p1 === s.scores.p2 ? "suddenDeathStart" : "gameOver"; if (s.phase === "gameOver") s.resultSaved = null; return s; }
      if (s.overtime && n % 2 === 0 && s.scores.p1 !== s.scores.p2) { s.phase = "gameOver"; s.resultSaved = null; return s; }
      if (!s.overtime && n === 4) { s.possessionNum = 5; s.offense = other(s.firstHalfOpener); s.ballPos = 20; }
      else { const nextN = n + 1; s.possessionNum = nextN; if (s.overtime) { s.offense = ((nextN - 9) % 2 === 0) ? s.otStarter : other(s.otStarter); s.ballPos = 20; } else if (s.pendingNext) { s.offense = s.pendingNext.offense; s.ballPos = s.pendingNext.ballPos; } }
      s.down = 1; s.lineToGain = Math.min(s.ballPos + 10, 100); s.driveOver = false; s.pendingNext = null; s.twoPoint = false; s.phase = "play"; s.turnStage = null; return s;
    });
  };
  const startOvertime = (team: Team) => act((s) => ({ ...s, overtime: true, otStarter: team, possessionNum: 9, offense: team, ballPos: 20, down: 1, lineToGain: 30, phase: "play", driveOver: false }));
  useEffect(() => {
    if (!session.cpuId) return;
    if (session.phase === "play" && !session.driveOver && !session.subMode) {
      if (session.turnStage === "offenseSelect" && session.offense === "p2") {
        setSession((current) => { if (!current.cpuId || current.phase !== "play" || current.offense !== "p2" || current.turnStage !== "offenseSelect") return current; const next = structuredClone(current); commitCpuCard(next, "offense"); return next; });
        return;
      }
      if (session.turnStage === "cpuChoosing" && session.offense === "p1") {
        setSession((current) => { if (!current.cpuId || current.phase !== "play" || current.offense !== "p1" || current.turnStage !== "cpuChoosing") return current; const next = structuredClone(current); commitCpuCard(next, "defense"); return next; });
        return;
      }
      if (!session.turnStage && session.down === 4 && !session.twoPoint && session.offense === "p2") {
        setSession((current) => {
          if (!current.cpuId || current.phase !== "play" || current.offense !== "p2" || current.turnStage || current.down !== 4) return current;
          const next = structuredClone(current), choice = chooseCpuFourthDown(current.cpuId, cpuSituation(current)); next.cpuDecisionIndex += 1;
          if (choice === "go") next.turnStage = "offenseSelect"; else next.subMode = choice === "fg" ? "fg" : "punt";
          return next;
        });
        return;
      }
    }
    if (session.phase === "pat" && session.scoringTeam === "p2" && !session.subMode && !session.twoPoint) {
      setSession((current) => {
        if (!current.cpuId || current.phase !== "pat" || current.scoringTeam !== "p2" || current.subMode || current.twoPoint) return current;
        const next = structuredClone(current), choice = chooseCpuConversion(current.cpuId, cpuSituation(current)); next.cpuDecisionIndex += 1;
        if (choice === "two") { next.twoPoint = true; next.ballPos = 98; next.down = 1; next.lineToGain = 100; next.phase = "play"; next.turnStage = null; }
        else next.subMode = "xp";
        return next;
      });
      return;
    }
    if (session.phase === "onsideChoice" && session.scoringTeam === "p2" && !session.subMode && !session.driveOver) {
      setSession((current) => {
        if (!current.cpuId || current.phase !== "onsideChoice" || current.scoringTeam !== "p2" || current.subMode || current.driveOver) return current;
        const next = structuredClone(current), choice = chooseCpuKickoff(current.cpuId, cpuSituation(current)); next.cpuDecisionIndex += 1;
        if (choice === "onside") next.subMode = "onside"; else kickDeep(next);
        return next;
      });
    }
  }, [session]);
  useEffect(() => {
    if (session.gameMode!=="virtual"||!session.cpuId||!session.subMode||session.pendingSubDrawCard) return;
    const cpuOwnsDraw=(session.subMode==="fg"||session.subMode==="punt")?session.offense==="p2":(session.subMode==="xp"||session.subMode==="onside")?session.scoringTeam==="p2":false;
    if(cpuOwnsDraw) drawVirtualSubCard();
  },[session.gameMode,session.cpuId,session.subMode,session.pendingSubDrawCard,session.offense,session.scoringTeam]);
  const saveDecision = (save: boolean) => {
    if (session.resultSaved !== null) return;
    if (save) {
      const winner: Team = session.scores.p1 > session.scores.p2 ? "p1" : "p2";
      const cpu = getCpuProfile(session.cpuId);
      const result: GameResult = { id: uid(), playedAt: Date.now(), p1PlayerId: session.p1PlayerId, p2PlayerId: session.p2PlayerId, p1Name: session.p1, p2Name: session.p2, p1Score: session.scores.p1, p2Score: session.scores.p2, winnerPlayerId: session[`${winner}PlayerId`], overtime: session.overtime, finalPossessionNum: session.possessionNum, stats: structuredClone(session.stats), gameMode: session.gameMode ?? undefined, opponentType: cpu ? "cpu" : "human", cpuId: cpu?.id, cpuName: cpu?.name, cpuDifficulty: cpu?.difficulty, cpuStars: cpu?.stars };
      const updated = [...games, result]; setGames(updated); persistCollections(players, updated);
    }
    setSession((s) => ({ ...s, resultSaved: save })); setUndoStack([]);
  };

  const gameActive = ["play", "pat", "onsideChoice", "suddenDeathStart"].includes(session.phase);
  const quarter = session.overtime ? "OT" : `Q${Math.floor((session.possessionNum - 1) / 2) + 1}`;
  const distance = session.lineToGain === 100 && session.lineToGain - session.ballPos <= 10 ? "GOAL" : String(session.lineToGain - session.ballPos);
  const advanceLabel = !session.overtime && session.possessionNum >= 8 ? (session.scores.p1 === session.scores.p2 ? "Go to overtime" : "See final") : session.overtime && session.possessionNum % 2 === 0 && session.scores.p1 !== session.scores.p2 ? "See final" : !session.overtime && session.possessionNum === 4 ? "Start 2nd half" : "Start next drive";
  const nextDriveOffense: Team = session.overtime
    ? (((session.possessionNum + 1 - 9) % 2 === 0) ? session.otStarter : other(session.otStarter))
    : session.pendingNext?.offense ?? other(session.offense);
  const winnerTeam: Team = session.scores.p1 > session.scores.p2 ? "p1" : "p2";
  const virtualRevealNarrative = (() => {
    const o = session.pendingOffenseCard, d = session.pendingDefenseCard; if (!o || !d) return "";
    const result = resolveMatch(o, d); if (result.kind === "tie" && !session.pendingTieBreakCard) return "Same rank — broken play!";
    const preview = structuredClone(session);
    applyOutcome(preview, result, o, d, result.kind === "tie" ? (session.pendingTieBreakCard!.color === "red" ? "recover" : "fumble") : undefined);
    return preview.log[0] || "";
  })();
  const virtualSubNarrative = (() => {
    if (!session.pendingSubDrawCard || !session.subMode) return "";
    const preview = structuredClone(session), card = session.pendingSubDrawCard;
    applySubResult(preview, preview.subMode, card.rank, card.color); return preview.log[0] || "";
  })();

  if (!cloudConfigured && !guestMode) return <main className="app"><Header /><section className="card cloud-gate"><Eyebrow>Local play</Eyebrow><h2>Cloud sync is unavailable</h2><p className="helper">You can still use the game tracker without saving profiles or results.</p><button className="secondary" onClick={continueAsGuest}>Continue without signing in</button></section></main>;
  if (!authReady || (cloudUser && !cloudReady)) return <main className="app"><Header /><section className="card cloud-gate"><p>Loading your shared field…</p></section></main>;
  if (!cloudUser && !guestMode) return <main className="app"><Header /><section className="card cloud-gate"><Eyebrow>Choose how to play</Eyebrow><h2>Start a game</h2><p className="helper">Sign in to share profiles and game history across devices, or use the tracker without saving anything.</p><div className="gate-actions"><button className="primary" onClick={() => void signInToCloud().catch((error: Error) => setCloudError(error.message))}>Continue with Google</button><button className="secondary" onClick={continueAsGuest}>Continue without signing in</button></div>{cloudError && <p className="cloud-error" role="alert">{cloudError}</p>}</section></main>;
  return <main className="app">
    <Header onRules={gameActive ? () => setShowRules(true) : undefined} />
    {!gameActive && <div className={`account-bar ${guestMode ? "guest" : ""}`}><span>{guestMode ? "Guest mode · profiles and history are off" : `● Cloud synced · ${cloudUser?.email || "Google account"}`}</span><button onClick={() => guestMode ? setGuestMode(false) : void signOutOfCloud()}>{guestMode ? "Sign in for cloud sync" : "Sign out"}</button></div>}
    {cloudError && !gameActive && <p className="cloud-error" role="alert">Sync issue: {cloudError}</p>}
    {!gameActive && <nav className="tabs" aria-label="Primary">
      <button className={["home","deckMode","names","possession"].includes(session.phase) ? "active" : ""} onClick={() => navigate("deckMode")}>New Game</button>
      <button className={session.phase === "rules" ? "active" : ""} onClick={() => navigate("rules")}>Rules</button>
      {cloudUser && <button className={session.phase === "history" ? "active" : ""} onClick={() => navigate("history")}>History</button>}
    </nav>}
    {session.phase === "home" && <Home games={games.length} cloudEnabled={Boolean(cloudUser)} onNew={() => navigate("deckMode")} onHistory={() => navigate("history")} />}
    {session.phase === "deckMode" && <DeckModeScreen onChoose={chooseDeckMode} />}
    {session.phase === "names" && <section className="card"><Eyebrow>{guestMode?"Guest game":"Pre-game"}</Eyebrow><h2>Who&apos;s playing?</h2>{session.gameMode==="virtual"&&<PlayerTwoType value={player2Kind} onChange={choosePlayer2Kind}/>}<p className="helper">{guestMode?"Guest names disappear when the page is closed or refreshed.":"Pick a profile, or create a new one."} {session.gameMode==="physical"?"You’ll share this screen — offense enters their card, defense enters theirs.":player2Kind==="cpu"?"Choose a CPU opponent for Player 2.":"The app will deal hidden hands after you choose who receives first."}</p><div className={`setup-grid ${player2Kind==="cpu"?"single-player":""}`}>{(["p1",...(player2Kind==="human"?["p2"]:[])] as Team[]).map((team)=><PlayerSetupSlot key={team} team={team} guestMode={guestMode} players={players} selected={selected} setSelected={setSelected} newNames={newNames} setNewNames={setNewNames} createPlayer={createPlayer}/>)}</div>{session.gameMode==="virtual"&&player2Kind==="cpu"&&<><CpuRoster selected={selectedCpuId} onSelect={setSelectedCpuId}/><p className="cpu-fair-play"><strong>Fair play:</strong> CPU opponents use the same shuffled deck and cannot see your hand, your selected card, or upcoming cards.</p></>}<button className="primary full" disabled={player2Kind==="cpu"?(guestMode?!newNames.p1.trim()||!selectedCpuId:!selected.p1||!selectedCpuId):(guestMode?!newNames.p1.trim()||!newNames.p2.trim()||newNames.p1.trim().toLocaleLowerCase()===newNames.p2.trim().toLocaleLowerCase():!selected.p1||!selected.p2||selected.p1===selected.p2)} onClick={player2Kind==="cpu"?confirmCpuGame:guestMode?confirmGuestPlayers:confirmPlayers}>Continue</button></section>}
    {session.phase === "possession" && <section className="card"><Eyebrow>Coin toss</Eyebrow><h2>Who receives first?</h2><p className="helper">{session.gameMode==="physical"?"Cut the deck: high card picks. ":"Choose the opening receiver. "}Possession flips at halftime.</p><div className="team-picks">{(["p1", "p2"] as Team[]).map((t) => <button className={`team-pick ${openingReceiver===t?"selected":""}`} aria-pressed={session.gameMode==="virtual"?openingReceiver===t:undefined} style={{ "--accent": accent(t) } as React.CSSProperties} key={t} onClick={() => session.gameMode==="virtual"?setOpeningReceiver(t):startGame(t)}><span className="dot" /> <strong>{nameOf(t)}</strong><small>RECEIVES FIRST</small></button>)}</div>{session.gameMode==="virtual"&&openingReceiver&&<button className="primary full start-handoff" onClick={()=>startGame(openingReceiver)}><strong>{session.cpuId?(openingReceiver==="p1"?`Start game as ${nameOf("p1")}`:`Start game — ${nameOf("p2")} receives first`):`Hand the phone to ${nameOf(openingReceiver)}`}</strong><small>{session.cpuId?(openingReceiver==="p1"?`${nameOf("p1")}, tap here to start the game.`:"The CPU will choose offense first."):`${nameOf(openingReceiver)}, tap here when you have the phone to start the game.`}</small></button>}</section>}
    {(["play", "pat", "onsideChoice"] as Phase[]).includes(session.phase) && <>
      {!(session.gameMode==="virtual"&&session.turnStage==="handoff")&&<><Scoreboard s={session} quarter={quarter} /><Field s={session} />{session.gameMode==="virtual"&&<p className="deck-hud">{session.drawPile.length} cards left in the draw pile</p>}</>}
      {session.driveOver ? <section className="card possession-over"><Eyebrow>Possession over</Eyebrow><h2>{session.driveOverMsg}</h2>{session.gameMode==="virtual"&&advanceLabel==="Start next drive"&&<div className="amber-banner">{session.cpuId?(nextDriveOffense==="p2"?<><strong>{nameOf("p2")}</strong> will be on offense for the next drive.</>:<><strong>{nameOf("p1")}</strong>, you&apos;re on offense for the next drive.</>):<>Hand the phone to <strong>{nameOf(nextDriveOffense)}</strong> — {nameOf(nextDriveOffense)} will be on offense for the next drive.</>}</div>}{!session.overtime&&session.possessionNum===4&&<StatsSnapshot title="Halftime stats" p1Name={session.p1} p2Name={session.p2} stats={session.stats}/>}<button className="primary full" onClick={startNextDrive}>{advanceLabel}</button>{undoStack.length > 0 && <button className="undo-link" onClick={undo}>↶ Undo last play</button>}</section>
      : session.subMode ? (session.gameMode==="virtual"&&session.subMode!=="tie"?<VirtualSubPanel mode={session.subMode} s={session} narrative={virtualSubNarrative} draw={drawVirtualSubCard} proceed={continueVirtualSub} undo={undo} canUndo={undoStack.length>0}/>:<SubPanel mode={session.subMode} s={session} drawColor={drawColor} drawRank={drawRank} setDrawColor={setDrawColor} setDrawRank={setDrawRank} resolve={resolveSub} undo={undo} canUndo={undoStack.length > 0} />)
      : session.phase === "pat" ? (session.cpuId&&session.scoringTeam==="p2"?<CpuThinking name={session.p2} detail="Choosing an extra point or two-point try…"/>:<section className="card"><Eyebrow>Point after</Eyebrow><h2>Touchdown, {session.scoringTeam && nameOf(session.scoringTeam)}! What&apos;s the call?</h2><div className="choices"><button onClick={() => act((s) => ({ ...s, subMode: "xp" }))}><strong>Kick extra point</strong><small>Draw a rank · 4 or higher is good (+1)</small></button><button onClick={() => act((s) => ({ ...s, twoPoint: true, ballPos: 98, down: 1, lineToGain: 100, phase: "play" }))}><strong>Go for two</strong><small>Play one down from the 2 (+2)</small></button></div><button className="secondary" onClick={undo}>↶ Undo</button></section>)
      : session.phase === "onsideChoice" ? (session.cpuId&&session.scoringTeam==="p2"?<CpuThinking name={session.p2} detail="Choosing the kickoff…"/>:<section className="card"><div className="amber-banner">{session.postScoreBanner}</div><Eyebrow>Kickoff</Eyebrow><h2>Onside kick?</h2><p className="helper">Try to steal the next possession, or kick deep and hand the opponent the ball at its 20.</p><div className="choices"><button onClick={() => act((s) => ({ ...s, subMode: "onside" }))}><strong>Attempt onside</strong><small>Draw · King or Ace recovers at the 50</small></button><button onClick={() => act((s) => { kickDeep(s); return s; })}><strong>Kick it deep</strong><small>Normal kickoff · opponent at its 20</small></button></div><button className="secondary" onClick={undo}>↶ Undo</button></section>)
      : session.gameMode==="virtual"?<VirtualPlayPanel s={session} selectedId={selectedVirtualCard} setSelectedId={setSelectedVirtualCard} confirm={confirmVirtualSelection} acknowledge={()=>setSession(s=>({...s,turnStage:"defenseSelect"}))} drawTie={drawVirtualTieBreak} proceed={continueVirtualPlay} narrative={virtualRevealNarrative} undo={undo} canUndo={undoStack.length>0} goForIt={()=>act(s=>({...s,turnStage:"offenseSelect"}))} punt={()=>act(s=>({...s,subMode:"punt"}))} fieldGoal={()=>act(s=>({...s,subMode:"fg"}))}/>
      : <PhysicalPlayPanel s={session} distance={distance} offCard={offCard} defCard={defCard} setOffCard={setOffCard} setDefCard={setDefCard} runPlay={runPlay} undo={undo} canUndo={undoStack.length>0} punt={()=>act((s)=>({...s,subMode:"punt"}))} fieldGoal={()=>act((s)=>({...s,subMode:"fg"}))}/>}
      {session.turnStage!=="handoff"&&<PlayLog lines={session.log}/>}
    </>}
    {session.phase === "suddenDeathStart" && <section className="card"><Eyebrow>Overtime</Eyebrow><h2>Tied after 4 quarters!</h2><p className="helper">Each team gets one possession from its own 20. Higher score after the round wins; if tied, play another round. Cut the deck to pick who starts.</p><div className="team-picks">{(["p1","p2"] as Team[]).map((t)=><button className="team-pick" style={{"--accent":accent(t)} as React.CSSProperties} key={t} onClick={()=>startOvertime(t)}><span className="dot"/><strong>{nameOf(t)}</strong><small>STARTS OT</small></button>)}</div></section>}
    {session.phase === "gameOver" && <section className="card final"><Eyebrow>Final</Eyebrow><h2 style={{color:accent(winnerTeam)}}>{nameOf(winnerTeam)} wins!</h2><div className="final-score"><span>{session.p1}</span><strong>{session.scores.p1} – {session.scores.p2}</strong><span>{session.p2}</span></div><StatsSnapshot title="Final stats" p1Name={session.p1} p2Name={session.p2} stats={session.stats}/>{guestMode ? <div className="save-panel"><p className="helper">Guest game complete. Profiles and results were not saved.</p><button className="primary" onClick={()=>resetSetup("deckMode")}>New game</button></div> : session.resultSaved === null ? <div className="save-panel"><p>Save this result to {nameOf(winnerTeam)}&apos;s and {nameOf(other(winnerTeam))}&apos;s records?</p><div className="action-row"><button className="primary" onClick={()=>saveDecision(true)}>Save result</button><button className="secondary" onClick={()=>saveDecision(false)}>Don&apos;t save</button></div></div> : <div className="save-panel"><p className={session.resultSaved ? "saved" : "helper"}>{session.resultSaved ? "✓ Saved to game history." : "Result not saved."}</p><div className="action-row"><button className="primary" onClick={()=>resetSetup("deckMode")}>New game</button><button className="secondary" onClick={()=>navigate("history")}>View history</button></div></div>}</section>}
    {session.phase === "rules" && <RulesPage />}
    {cloudUser && session.phase === "history" && <HistoryV2 players={players} games={games} onNew={()=>resetSetup("deckMode")} />}
    {showRules && <RulesOverlay onClose={()=>setShowRules(false)} />}
  </main>;
}

function Header({onRules}:{onRules?:()=>void}){return <header><h1>FIRST <span>&amp;</span> TEN</h1>{onRules&&<button className="rules-link" onClick={onRules}>Rules / Quick Guide</button>}<p>FOOTBALL · ONE DECK · TWO PLAYERS</p></header>}
function Eyebrow({children}:{children:React.ReactNode}){return <p className="eyebrow">{children}</p>}
function PlayerTwoType({value,onChange}:{value:"human"|"cpu";onChange:(value:"human"|"cpu")=>void}){return <div className="player-two-toggle" role="group" aria-label="Player 2 type"><button className={value==="human"?"selected":""} aria-pressed={value==="human"} onClick={()=>onChange("human")}><strong>Human player</strong><small>Pass the phone between turns</small></button><button className={value==="cpu"?"selected":""} aria-pressed={value==="cpu"} onClick={()=>onChange("cpu")}><strong>CPU opponent</strong><small>Play solo on this device</small></button></div>}
function CpuRoster({selected,onSelect}:{selected:CpuId|null;onSelect:(id:CpuId)=>void}){return <div className="cpu-roster" aria-label="Choose a CPU opponent">{CPU_PROFILES.map(cpu=><button className={`cpu-card ${selected===cpu.id?"selected":""}`} aria-pressed={selected===cpu.id} onClick={()=>onSelect(cpu.id)} key={cpu.id}><span className="cpu-card-head"><strong>{cpu.name}</strong><span className="cpu-badge">{cpu.difficulty}</span></span><span className="cpu-rating" aria-label={`${cpu.stars} out of 5 stars`}>{"★".repeat(cpu.stars)}{"☆".repeat(5-cpu.stars)}</span><small>{cpu.description}</small></button>)}</div>}
function PlayerSetupSlot({team,guestMode,players,selected,setSelected,newNames,setNewNames,createPlayer}:{team:Team;guestMode:boolean;players:PlayerProfile[];selected:Record<Team,string>;setSelected:React.Dispatch<React.SetStateAction<Record<Team,string>>>;newNames:Record<Team,string>;setNewNames:React.Dispatch<React.SetStateAction<Record<Team,string>>>;createPlayer:(team:Team,event:FormEvent)=>void}){return <div className="profile-slot" style={{"--accent":team==="p1"?"var(--p1)":"var(--p2)"} as React.CSSProperties}><h3>{team==="p1"?"Player 1":"Player 2"}</h3>{guestMode?<><label className="sr-only" htmlFor={`guest-${team}`}>{team==="p1"?"Player 1":"Player 2"} name</label><input id={`guest-${team}`} placeholder="Player name" value={newNames[team]} onChange={e=>setNewNames(v=>({...v,[team]:e.target.value}))}/></>:<>{players.length>0&&<div className="chips">{[...players].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{const disabled=selected[other(team)]===p.id;return <button key={p.id} disabled={disabled} className={`chip ${selected[team]===p.id?"selected":""}`} onClick={()=>!disabled&&setSelected(v=>({...v,[team]:p.id}))}>{p.name}{disabled&&<small>selected</small>}</button>})}</div>}<form className="new-player" onSubmit={e=>createPlayer(team,e)}><label className="sr-only" htmlFor={`new-${team}`}>New {team==="p1"?"Player 1":"Player 2"} name</label><input id={`new-${team}`} placeholder="Player name" value={newNames[team]} onChange={e=>setNewNames(v=>({...v,[team]:e.target.value}))}/><button className="secondary" disabled={!newNames[team].trim()}>Add</button></form></>}</div>}
function Home({games,cloudEnabled,onNew,onHistory}:{games:number;cloudEnabled:boolean;onNew:()=>void;onHistory:()=>void}){return <section className="card hero"><Eyebrow>Welcome</Eyebrow><h2>First &amp; Ten</h2><p className="helper">Track drives, downs, and scores for your card-football games.</p><div className="home-actions"><button className="primary" onClick={onNew}>New Game</button>{cloudEnabled&&<button className="alt" onClick={onHistory}>Game History</button>}</div>{cloudEnabled&&games>0&&<p className="recorded">{games} {games===1?"game":"games"} recorded</p>}</section>}
function DeckModeScreen({onChoose}:{onChoose:(mode:"physical"|"virtual")=>void}){return <section className="card deck-mode"><Eyebrow>New game setup</Eyebrow><h2>Do you have physical cards with you?</h2><p className="helper">If you don&apos;t have a deck handy, First &amp; Ten can deal, shuffle, and pass the cards for you right on this screen.</p><div className="choices"><button onClick={()=>onChoose("physical")}><strong>I have physical cards</strong><small>Play with your own 52-card deck, as usual.</small></button><button onClick={()=>onChoose("virtual")}><strong>Use the virtual deck</strong><small>We&apos;ll deal hands and pass the phone between turns.</small></button></div></section>}
function Scoreboard({s,quarter}:{s:Session;quarter:string}){return <section className="scoreboard">{(["p1","p2"] as Team[]).map((t,i)=><div key={t} className={`score-cell score-${t}`} style={{order:i===0?0:2}}><p>{s[t]}</p><strong>{s.scores[t]}</strong><small className={s.offense===t?"on-offense":""}>{s.offense===t?"▶ OFFENSE":"DEFENSE"}</small></div>)}<div className="score-meta"><strong>{quarter}</strong><small>{s.overtime?"SUDDEN DEATH":`POSS ${s.possessionNum}/8`}</small></div></section>}
function StatsSnapshot({title,p1Name,p2Name,stats}:{title:string;p1Name:string;p2Name:string;stats:Record<Team,PlayerGameStats>}){const fg=(s:PlayerGameStats)=>{const made=s.fieldGoals.filter(x=>x.made).length,missed=s.fieldGoals.length-made;return `${made} made · ${missed} missed${s.fieldGoals.length?` · ${s.fieldGoals.map(x=>`${x.made?"✓":"✕"}${x.distance} yd`).join(", ")}`:""}`};const two=(s:PlayerGameStats)=>`${s.twoPointMade} made · ${s.twoPointMissed} failed`;const rows:[string,(s:PlayerGameStats)=>React.ReactNode][]=[["Total yards",s=>s.runYards+s.passYards],["Pass yards",s=>s.passYards],["Run yards",s=>s.runYards],["Turnovers",s=>s.turnovers],["Field goals",fg],["2-point conversions",two],["Onside recoveries",s=>s.onsideRecoveries],["Points",s=>s.points]];return <section className="stats-snapshot"><h3>{title}</h3><div className="stats-grid"><div className="stats-head"><span>Stat</span><strong>{p1Name}</strong><strong>{p2Name}</strong></div>{rows.map(([label,format])=><div className="stats-row" key={label}><span>{label}</span><b>{format(stats.p1)}</b><b>{format(stats.p2)}</b></div>)}</div><p className="stats-key">✓ and ✕ identify each field-goal result and attempt distance.</p></section>}
function Field({s}:{s:Session}){return <section className="field-wrap"><div className="field" aria-label={`Ball on ${displaySpot(s.ballPos)}`}><div className="end-zone end-zone-own">OWN</div><div className="end-zone end-zone-opponent">END ZONE</div>{[10,20,30,40,50,60,70,80,90].map((n)=><div className="yard" style={{left:`${fieldPercent(n)}%`}} key={n}><span>{Math.min(n,100-n)}</span></div>)}<div className="first-line" style={{left:`${fieldPercent(s.lineToGain)}%`}}/><div className={`football ball-${s.offense}`} style={{left:`${fieldPercent(s.ballPos)}%`}}><i/></div></div><div className="field-caption"><span>◀ own goal</span><span>Ball on the <b>{displaySpot(s.ballPos)}</b> · {100-s.ballPos} to the end zone</span><span>end zone ▶</span></div></section>}
function PlayingCard({card,size="hand",selected=false,onClick,accentColor}:{card:VirtualCard;size?:"hand"|"reveal"|"draw";selected?:boolean;onClick?:()=>void;accentColor?:string}){const content=<><span className="card-corner top">{card.rank}{card.suit}</span><strong>{card.rank}{card.suit}</strong><span className="card-corner bottom">{card.rank}{card.suit}</span></>;return onClick?<button aria-label={`${card.rank} of ${card.suit}`} onClick={onClick} className={`playing-card ${size} ${card.color} ${selected?"selected":""}`} style={{"--card-accent":accentColor} as React.CSSProperties}>{content}</button>:<div aria-label={`${card.rank} of ${card.suit}`} className={`playing-card ${size} ${card.color}`}>{content}</div>}
function CpuThinking({name,detail="Considering the public game state…"}:{name:string;detail?:string}){return <section className="card cpu-thinking" role="status" aria-live="polite"><Eyebrow>CPU opponent</Eyebrow><h2>{name} is choosing…</h2><p className="helper">{detail}</p></section>}
function PhysicalPlayPanel({s,distance,offCard,defCard,setOffCard,setDefCard,runPlay,undo,canUndo,punt,fieldGoal}:{s:Session;distance:string;offCard:Partial<Card>;defCard:Partial<Card>;setOffCard:React.Dispatch<React.SetStateAction<Partial<Card>>>;setDefCard:React.Dispatch<React.SetStateAction<Partial<Card>>>;runPlay:()=>void;undo:()=>void;canUndo:boolean;punt:()=>void;fieldGoal:()=>void}){const name=(t:Team)=>s[t],color=(t:Team)=>t==="p1"?"var(--p1)":"var(--p2)";return <section className="card">{s.twoPoint?<div className="amber-banner">TWO-POINT TRY · {name(s.offense)} needs at least 2 yards from the 2.</div>:<div className="down-bar">{ordinal(s.down)} &amp; {distance}</div>}<div className="entry-grid"><CardEntry role="OFFENSE" name={name(s.offense)} color={color(s.offense)} card={offCard} setCard={setOffCard}/><CardEntry role="DEFENSE" name={name(other(s.offense))} color={color(other(s.offense))} card={defCard} setCard={setDefCard}/></div><p className="key">Black = RUN · Red = PASS · J/Q/K = 12 · A = 20</p><div className="action-row"><button className="primary" disabled={!offCard.color||!offCard.rank||!defCard.color||!defCard.rank} onClick={runPlay}>{s.twoPoint?"Run the try":"Run the play"}</button><button className="secondary" disabled={!canUndo} onClick={undo}>↶ Undo</button></div>{s.down===4&&!s.twoPoint&&<div className="action-row"><button className="alt" onClick={punt}>Punt</button><button className="alt" disabled={s.ballPos<40} onClick={fieldGoal}>{s.ballPos<40?"FG (need within 60 yds)":`Field goal (${100-s.ballPos} yds — need ${fgMinRank(s.ballPos)}+)`}</button></div>}</section>}
function VirtualPlayPanel({s,selectedId,setSelectedId,confirm,acknowledge,drawTie,proceed,narrative,undo,canUndo,goForIt,punt,fieldGoal}:{s:Session;selectedId:string;setSelectedId:(id:string)=>void;confirm:()=>void;acknowledge:()=>void;drawTie:()=>void;proceed:()=>void;narrative:string;undo:()=>void;canUndo:boolean;goForIt:()=>void;punt:()=>void;fieldGoal:()=>void}){const offense=s.offense,defense=other(offense),name=(t:Team)=>s[t],color=(t:Team)=>t==="p1"?"var(--p1)":"var(--p2)";
  if(s.turnStage==="cpuChoosing")return <CpuThinking name={s.p2}/>;
  if(s.turnStage==="handoff")return <section className="card handoff"><Eyebrow>Pass the device</Eyebrow><h2>Hand the phone to {name(defense)}</h2><p>{name(offense)}, please look away.</p><button className="primary full" onClick={acknowledge}>{name(defense)}, tap here when you have the phone</button></section>;
  if(s.turnStage==="offenseSelect"||s.turnStage==="defenseSelect"){const selecting=s.turnStage==="offenseSelect"?offense:defense;if(s.cpuId&&selecting==="p2")return <CpuThinking name={s.p2}/>;const role=s.turnStage==="offenseSelect"?"OFFENSE":"DEFENSE",hand=selecting==="p1"?s.p1Hand:s.p2Hand;return <section className="card virtual-hand"><Eyebrow>{role} — {name(selecting)}&apos;s turn</Eyebrow><h2>Choose your card</h2>{s.twoPoint&&<div className="amber-banner">TWO-POINT TRY · needs at least 2 yards</div>}<div className="hand-row">{hand.map(card=><PlayingCard card={card} selected={selectedId===card.id} accentColor={color(selecting)} onClick={()=>setSelectedId(card.id)} key={card.id}/>)}</div><p className="key">Black = RUN · Red = PASS · J/Q/K = 12 · A = 20</p><button className="primary full" disabled={!selectedId} onClick={confirm}>Play this card</button></section>}
  if(s.turnStage==="reveal"&&s.pendingOffenseCard&&s.pendingDefenseCard){const tie=s.pendingOffenseCard.rank===s.pendingDefenseCard.rank,ready=!tie||Boolean(s.pendingTieBreakCard);return <section className="card reveal-panel"><Eyebrow>Play result</Eyebrow><h2>Cards revealed</h2><div className="reveal-cards"><div style={{"--accent":color(offense)} as React.CSSProperties}><span>OFFENSE · {name(offense)}</span><PlayingCard card={s.pendingOffenseCard} size="reveal"/></div>{s.pendingTieBreakCard&&<div className="tie-card"><span>TIE BREAK</span><PlayingCard card={s.pendingTieBreakCard} size="draw"/></div>}<div style={{"--accent":color(defense)} as React.CSSProperties}><span>DEFENSE · {name(defense)}</span><PlayingCard card={s.pendingDefenseCard} size="reveal"/></div></div><p className={`reveal-result ${tie?"tie":""}`}>{narrative}</p><div className="action-row"><button className="primary" onClick={ready?proceed:drawTie}>{ready?"Continue":"Draw to resolve"}</button><button className="secondary" disabled={!canUndo} onClick={undo}>↶ Undo</button></div></section>}
  if(s.down===4&&!s.twoPoint)return s.cpuId&&s.offense==="p2"?<CpuThinking name={s.p2} detail="Choosing the fourth-down call…"/>:<section className="card"><Eyebrow>4th down</Eyebrow><h2>What&apos;s the call?</h2><div className="choices fourth-choices"><button onClick={goForIt}><strong>Go for it</strong><small>Play a normal down</small></button><button onClick={punt}><strong>Punt</strong><small>Draw to see how far</small></button><button disabled={s.ballPos<40} onClick={fieldGoal}><strong>Field goal</strong><small>{s.ballPos<40?"Out of range (need within 60 yds)":`${100-s.ballPos} yds — need ${fgMinRank(s.ballPos)}+`}</small></button></div></section>;
  return <section className="card"><p className="helper">Preparing the next down…</p></section>}
function VirtualSubPanel({mode,s,narrative,draw,proceed,undo,canUndo}:{mode:Exclude<SubMode,null>;s:Session;narrative:string;draw:()=>void;proceed:()=>void;undo:()=>void;canUndo:boolean}){const titles={tie:"Broken play",fg:"Field goal attempt",punt:"Punt",xp:"Extra point",onside:"Onside kick"};const hints={tie:"",fg:`${fgMinRank(s.ballPos)} or higher is good from ${100-s.ballPos} yards`,punt:"Distance = rank × 5 yards (Ace = 70)",xp:"4 or higher is good (+1) · 2 or 3 misses",onside:"King or Ace = recovered at the 50"};return <section className="card virtual-sub"><Eyebrow>Draw a card</Eyebrow><h2>{titles[mode]}</h2><p className="helper">Draw the top card from the shared virtual deck.</p>{s.pendingSubDrawCard?<><div className="single-draw"><PlayingCard card={s.pendingSubDrawCard} size="draw"/></div><p className="reveal-result">{narrative}</p></>:<p className="key">{hints[mode]}</p>}<div className="action-row"><button className="primary" onClick={s.pendingSubDrawCard?proceed:draw}>{s.pendingSubDrawCard?"Continue":"Draw the top card"}</button><button className="secondary" disabled={!canUndo} onClick={undo}>↶ Undo</button></div></section>}
function CardEntry({role,name,color,card,setCard}:{role:string;name:string;color:string;card:Partial<Card>;setCard:React.Dispatch<React.SetStateAction<Partial<Card>>>}){return <div className={`entry ${card.color&&card.rank?"complete":""}`} style={{"--accent":color} as React.CSSProperties}><div className="entry-head"><strong>● {role}</strong><span>{name}</span></div><div className="color-grid"><button className={card.color==="black"?"selected":""} onClick={()=>setCard(c=>({...c,color:"black"}))}>RUN ♠</button><button className={`pass ${card.color==="red"?"selected":""}`} onClick={()=>setCard(c=>({...c,color:"red"}))}>PASS ♥</button></div><div className="rank-grid">{RANKS.map(r=><button aria-label={`${role} rank ${r}`} className={card.rank===r?"selected":""} key={r} onClick={()=>setCard(c=>({...c,rank:r}))}>{r}</button>)}</div></div>}
function SubPanel({mode,s,drawColor,drawRank,setDrawColor,setDrawRank,resolve,undo,canUndo}:{mode:Exclude<SubMode,null>;s:Session;drawColor:CardColor|null;drawRank:Rank|null;setDrawColor:(c:CardColor)=>void;setDrawRank:(r:Rank)=>void;resolve:()=>void;undo:()=>void;canUndo:boolean}){const colorMode=mode==="tie";const titles={tie:"Broken play — same rank!",fg:"Field goal attempt",punt:"Punt",xp:"Extra point",onside:"Onside kick"};const confirms={tie:"Resolve recovery",fg:"Kick it",punt:"Punt it",xp:"Kick it",onside:"Kick it"};const min=fgMinRank(s.ballPos);const hints={tie:"Red → offense recovers · Black → the defense recovers at this spot",fg:`${min} or higher is good from ${100-s.ballPos} yards · anything lower misses`,punt:"Distance = rank × 5 yards (Ace = 70) · into the end zone = touchback to the 20",xp:"4 or higher is good (+1) · 2 or 3 misses",onside:"King or Ace = recovered at the 50 · anything else, the opponent gets the 50"};return <section className="card"><Eyebrow>Draw a card</Eyebrow><h2>{titles[mode]}</h2><p className="helper">Draw the top card and enter its {colorMode?"color":"rank"}.</p>{colorMode?<div className="color-grid draw"><button className={drawColor==="black"?"selected":""} onClick={()=>setDrawColor("black")}>BLACK ♠</button><button className={`pass ${drawColor==="red"?"selected":""}`} onClick={()=>setDrawColor("red")}>RED ♥</button></div>:<div className="rank-grid draw">{RANKS.map(r=><button className={drawRank===r?"selected":""} key={r} onClick={()=>setDrawRank(r)}>{r}</button>)}</div>}<p className="key">{hints[mode]}</p><div className="action-row"><button className="primary" disabled={colorMode?!drawColor:!drawRank} onClick={resolve}>{confirms[mode]}</button><button className="secondary" disabled={!canUndo} onClick={undo}>↶ Undo</button></div></section>}
function PlayLog({lines}:{lines:string[]}){return <section className="log"><Eyebrow>Play-by-play</Eyebrow><div>{lines.length?lines.map((l,i)=><p key={`${i}-${l}`}>{l}</p>):<p className="empty-log">The opening drive is ready.</p>}</div></section>}
function RulesContent(){return <div className="rules-content"><ol className="rules-steps">
  <li><strong>Set up.</strong> Choose physical cards or the in-app virtual deck. Each player uses a hidden five-card hand. Black cards are runs; red cards are passes. Card values are face value, J/Q/K = 12, and Ace = 20.</li>
  <li><strong>Play a down.</strong> Offense and defense each choose a card, then reveal together. In virtual mode, pass the device when prompted; the app keeps both choices hidden until reveal.</li>
</ol><div className="rules-table-wrap"><table className="rules-table"><thead><tr><th>Offense</th><th>Defense</th><th>Result</th></tr></thead><tbody><tr><td>Run</td><td>Run</td><td>Defense equal/higher: 0. Otherwise, offense minus defense.</td></tr><tr><td>Run</td><td>Pass</td><td>Add both values.</td></tr><tr><td>Pass</td><td>Pass</td><td>Defense equal/higher: sack, −5. Otherwise, offense minus defense.</td></tr><tr><td>Pass</td><td>Run</td><td>Add both values.</td></tr></tbody></table></div><ol className="rules-steps" start={3}>
  <li><strong>Handle special cards.</strong> Matching ranks cause a draw: red means offense recovers and gains that card&apos;s value; black means defense recovers. A non-tied red offensive Ace against red defense is an interception; a black offensive Ace against black defense is a fumble at the spot. Either Ace against the opposite color is a breakaway for 20 plus the defense card.</li>
  <li><strong>Move the chains.</strong> Gain 10 yards within four downs for a first down. On fourth down, go for it, punt, or try a field goal when within 60 yards.</li>
  <li><strong>Kick.</strong> Punt distance is rank × 5 (Ace = 70); a punt into the end zone is a touchback at the 20. Field-goal minimums by distance are: 1–20 yards = 4, 21–30 = 5, 31–40 = 7, 41–50 = 9, 51–60 = J.</li>
  <li><strong>Score.</strong> Touchdown = 6, extra point = 1 (draw a rank: 4 or higher is good; 2 or 3 misses), two-point try = 2 (one normal play from the 2), field goal = 3, safety = 2.</li>
  <li><strong>Continue play.</strong> After scoring, you may try an onside kick unless it is the last possession of a half or overtime. Draw K/A to recover at midfield; otherwise the opponent starts there.</li>
  <li><strong>Finish the game.</strong> Play eight possessions—two per quarter. The team that did not open the first half opens the second. If tied, alternate possessions from each team&apos;s own 20 until one team leads after both have possessed the ball.</li>
</ol><section className="cpu-rules"><h3>Playing a CPU opponent</h3><p>Choose <strong>Virtual deck</strong>, then <strong>CPU opponent</strong>. You are always Player 1; the CPU is Player 2.</p><ul><li>The CPU plays offense and defense, makes fourth-down, conversion, kickoff, and overtime decisions, and uses the same deck rules as a human.</li><li>CPU opponents cannot see your hand, your selected card, or upcoming cards. Stronger opponents make better use of public information such as the score, field position, cards already played, and your prior Run/Pass tendency.</li><li>Rookie Riley is easiest; Coach Morgan, Captain Harper, and The Commissioner increase in challenge. You can undo the most recently applied play just as in other virtual-deck games.</li></ul></section></div>}
function RulesPage(){return <section className="card rules-page"><Eyebrow>Quick guide</Eyebrow><h2>How to play</h2><p className="helper">Everything needed to start playing, in order.</p><RulesContent /></section>}
function RulesOverlay({onClose}:{onClose:()=>void}){return <div className="rules-overlay" role="dialog" aria-modal="true" aria-labelledby="rules-title"><section className="rules-modal"><button className="rules-close" aria-label="Close rules" onClick={onClose}>×</button><Eyebrow>Quick guide</Eyebrow><h2 id="rules-title">How to play</h2><RulesContent /></section></div>}
const HISTORY_SORTS=[
  ["newest:desc","Most recently played"],["totalScore:asc","Lowest total score"],["totalScore:desc","Highest total score"],
  ["playerScore:asc","Lowest score by one player"],["playerScore:desc","Highest score by one player"],
  ["turnovers:asc","Lowest turnovers"],["turnovers:desc","Highest turnovers"],
  ["yards:asc","Lowest yards gained"],["yards:desc","Highest yards gained"],
  ["passYards:asc","Lowest pass yards gained"],["passYards:desc","Highest pass yards gained"],
  ["runYards:asc","Lowest run yards gained"],["runYards:desc","Highest run yards gained"],
  ["fgAttempts:asc","Lowest field goal attempts"],["fgAttempts:desc","Highest field goal attempts"],
  ["fgMakes:asc","Lowest field goal makes"],["fgMakes:desc","Highest field goal makes"],
  ["fgMisses:asc","Lowest field goal misses"],["fgMisses:desc","Highest field goal misses"],
  ["twoPointAttempts:asc","Lowest 2-point attempts"],["twoPointAttempts:desc","Highest 2-point attempts"],
  ["onsideRecoveries:asc","Lowest successful onside recoveries"],["onsideRecoveries:desc","Highest successful onside recoveries"],
] as const;
function gameDate(playedAt:number){const d=new Date(playedAt);const date=`${d.getMonth()+1}/${d.getDate()}`;const time=new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(d);return `${date} ${time}`}
function History({players,games,onNew}:{players:PlayerProfile[];games:GameResult[];onNew:()=>void}){
  const records=useMemo(()=>players.map(p=>({...p,...playerStats(p.id,games)})).sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name)),[players,games]);
  const [sort,setSort]=useState("newest:desc"),[filter,setFilter]=useState("all"),[expanded,setExpanded]=useState<string|null>(null);
  const filtered=useMemo(()=>filterGameResults(games,filter),[games,filter]);
  const recent=useMemo(()=>sortGameResults(filtered,sort),[filtered,sort]);
  const cpuRecords=useMemo(()=>CPU_PROFILES.map(cpu=>{const played=games.filter(game=>game.cpuId===cpu.id),wins=played.filter(game=>game.p1Score>game.p2Score).length;return {...cpu,played:played.length,wins,losses:played.length-wins}}).filter(row=>row.played),[games]);
  const highestDefeated=useMemo(()=>[...games].filter(game=>isCpuGame(game)&&game.p1Score>game.p2Score).sort((a,b)=>(b.cpuStars??0)-(a.cpuStars??0))[0],[games]);
  if(!games.length)return <section className="card empty-history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><p>No games recorded yet. Play a game and choose to save the result to start building history.</p><button className="primary" onClick={onNew}>New Game</button></section>;
  /* superseded compact renderer retained below for migration context
  return <section className="card history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><h3>Player records</h3><div className="table-wrap"><table><thead><tr><th>Player</th><th>GP</th><th>W</th><th>L</th><th>Win%</th></tr></thead><tbody>{records.map(p=><tr key={p.id}><th>{p.name}</th><td data-label="Games">{p.gamesPlayed}</td><td data-label="Wins">{p.wins}</td><td data-label="Losses">{p.losses}</td><td data-label="Win%">{p.winPct===null?"—":`${p.winPct}%`}</td></tr>)}</tbody></table></div>{cpuRecords.length>0&&<section className="cpu-matchups"><div><h3>CPU matchups</h3>{highestDefeated&&<p className="helper">Highest difficulty defeated: <strong>{highestDefeated.cpuName||highestDefeated.p2Name}</strong> · {highestDefeated.cpuDifficulty}</p>}</div><div className="cpu-record-grid">{cpuRecords.map(row=><article key={row.id}><span className="cpu-badge">{row.difficulty}</span><strong>{row.name}</strong><small>{row.wins} W · {row.losses} L · {row.played} played</small></article>)}</div></section>}<div className="history-list-head"><h3>Games</h3><div className="history-controls"><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All games</option><option value="human">vs Humans</option><option value="cpu">vs CPU</option>{CPU_PROFILES.map(cpu=><option value={cpu.id} key={cpu.id}>vs {cpu.name}</option>)}</select></label><label>Sort games<select value={sort} onChange={e=>setSort(e.target.value)}>{HISTORY_SORTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></div></div>{recent.length===0?<p className="legacy-stats">No games match this filter.</p>:<div className="recent-games">{recent.map(g=>{const open=expanded===g.id,cpu=isCpuGame(g);return <article key={g.id} className={open?"expanded":""}><button className="game-summary" aria-expanded={open} onClick={()=>setExpanded(open?null:g.id)}><time>{gameDate(g.playedAt)}{g.overtime&&" (OT)"}</time><span><strong>{g.p1Name}</strong> - {g.p1Score} <strong>{g.p2Name}</strong> - {g.p2Score}{cpu&&<em className="cpu-game-tag">CPU · {g.cpuDifficulty||"Opponent"}</em>}</span><i aria-hidden="true">{open?"−":"+"}</i></button>{open&&(g.stats?<StatsSnapshot title="Game stats" p1Name={g.p1Name} p2Name={g.p2Name} stats={{p1:gamePlayerStats(g,"p1"),p2:gamePlayerStats(g,"p2")}}/>:<p className="legacy-stats">Detailed stats were not recorded for this earlier game.</p>)}</article>)}</div>}</section>;
  return <section className="card history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><h3>Player records</h3><div className="table-wrap"><table><thead><tr><th>Player</th><th>GP</th><th>W</th><th>L</th><th>Win%</th></tr></thead><tbody>{records.map(p=><tr key={p.id}><th>{p.name}</th><td data-label="Games">{p.gamesPlayed}</td><td data-label="Wins">{p.wins}</td><td data-label="Losses">{p.losses}</td><td data-label="Win%">{p.winPct===null?"—":`${p.winPct}%`}</td></tr>)}</tbody></table></div><div className="history-list-head"><h3>Games</h3><label>Sort games<select value={sort} onChange={e=>setSort(e.target.value)}>{HISTORY_SORTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></div><div className="recent-games">{recent.map(g=>{const open=expanded===g.id;return <article key={g.id} className={open?"expanded":""}><button className="game-summary" aria-expanded={open} onClick={()=>setExpanded(open?null:g.id)}><time>{gameDate(g.playedAt)}{g.overtime&&" (OT)"}</time><span><strong>{g.p1Name}</strong> - {g.p1Score} <strong>{g.p2Name}</strong> - {g.p2Score}</span><i aria-hidden="true">{open?"−":"+"}</i></button>{open&&(g.stats?<StatsSnapshot title="Game stats" p1Name={g.p1Name} p2Name={g.p2Name} stats={{p1:gamePlayerStats(g,"p1"),p2:gamePlayerStats(g,"p2")}}/>:<p className="legacy-stats">Detailed stats were not recorded for this earlier game.</p>)}</article>})}</div></section>}
  */
}

function HistoryV2({players,games,onNew}:{players:PlayerProfile[];games:GameResult[];onNew:()=>void}){
  const records=useMemo(()=>players.map(player=>({...player,...playerStats(player.id,games)})).sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name)),[players,games]);
  const [sort,setSort]=useState("newest:desc");
  const [filter,setFilter]=useState("all");
  const [expanded,setExpanded]=useState<string|null>(null);
  const recent=useMemo(()=>sortGameResults(filterGameResults(games,filter),sort),[games,filter,sort]);
  const cpuRecords=useMemo(()=>CPU_PROFILES.map(cpu=>{const played=games.filter(game=>game.cpuId===cpu.id),wins=played.filter(game=>game.p1Score>game.p2Score).length;return {...cpu,played:played.length,wins,losses:played.length-wins}}).filter(row=>row.played),[games]);
  const highestDefeated=useMemo(()=>[...games].filter(game=>isCpuGame(game)&&game.p1Score>game.p2Score).sort((a,b)=>(b.cpuStars??0)-(a.cpuStars??0))[0],[games]);
  if(!games.length)return <section className="card empty-history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><p>No games recorded yet. Play a game and choose to save the result to start building history.</p><button className="primary" onClick={onNew}>New Game</button></section>;
  return <section className="card history">
    <Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><h3>Player records</h3>
    <div className="table-wrap"><table><thead><tr><th>Player</th><th>GP</th><th>W</th><th>L</th><th>Win%</th></tr></thead><tbody>{records.map(player=><tr key={player.id}><th>{player.name}</th><td data-label="Games">{player.gamesPlayed}</td><td data-label="Wins">{player.wins}</td><td data-label="Losses">{player.losses}</td><td data-label="Win%">{player.winPct===null?"-":`${player.winPct}%`}</td></tr>)}</tbody></table></div>
    {cpuRecords.length>0&&<section className="cpu-matchups"><div><h3>CPU matchups</h3>{highestDefeated&&<p className="helper">Highest difficulty defeated: <strong>{highestDefeated.cpuName||highestDefeated.p2Name}</strong> - {highestDefeated.cpuDifficulty}</p>}</div><div className="cpu-record-grid">{cpuRecords.map(row=><article key={row.id}><span className="cpu-badge">{row.difficulty}</span><strong>{row.name}</strong><small>{row.wins} W - {row.losses} L - {row.played} played</small></article>)}</div></section>}
    <div className="history-list-head"><h3>Games</h3><div className="history-controls"><label>Show<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All games</option><option value="human">vs Humans</option><option value="cpu">vs CPU</option>{CPU_PROFILES.map(cpu=><option value={cpu.id} key={cpu.id}>vs {cpu.name}</option>)}</select></label><label>Sort games<select value={sort} onChange={event=>setSort(event.target.value)}>{HISTORY_SORTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></div></div>
    {recent.length===0?<p className="legacy-stats">No games match this filter.</p>:<div className="recent-games">{recent.map(game=>{const open=expanded===game.id,cpu=isCpuGame(game);return <article key={game.id} className={open?"expanded":""}><button className="game-summary" aria-expanded={open} onClick={()=>setExpanded(open?null:game.id)}><time>{gameDate(game.playedAt)}{game.overtime&&" (OT)"}</time><span><strong>{game.p1Name}</strong> - {game.p1Score} <strong>{game.p2Name}</strong> - {game.p2Score}{cpu&&<em className="cpu-game-tag">CPU - {game.cpuDifficulty||"Opponent"}</em>}</span><i aria-hidden="true">{open?"-":"+"}</i></button>{open&&(game.stats?<StatsSnapshot title="Game stats" p1Name={game.p1Name} p2Name={game.p2Name} stats={{p1:gamePlayerStats(game,"p1"),p2:gamePlayerStats(game,"p2")}}/>:<p className="legacy-stats">Detailed stats were not recorded for this earlier game.</p>)}</article>})}</div>}
  </section>;
}
