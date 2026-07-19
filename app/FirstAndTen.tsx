"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Card, CardColor, GameResult, MatchResult, PlayerProfile, RANKS, Rank,
  cardStr, displaySpot, fgMinRank, fieldGoalGood, interceptionStart, ordinal,
  playerStats, puntDistance, resolveMatch, valueOf, yd,
} from "./game-engine";

type Team = "p1" | "p2";
type Phase = "home" | "names" | "possession" | "play" | "pat" | "onsideChoice" | "suddenDeathStart" | "gameOver" | "history";
type SubMode = null | "tie" | "fg" | "punt" | "xp" | "onside";
type Session = {
  phase: Phase; p1: string; p2: string; p1PlayerId: string; p2PlayerId: string;
  firstHalfOpener: Team; offense: Team; possessionNum: number; ballPos: number;
  down: number; lineToGain: number; scores: Record<Team, number>; overtime: boolean;
  otStarter: Team; twoPoint: boolean; pendingOff: Card | null; pendingDef: Card | null;
  subMode: SubMode; scoringTeam: Team | null; pendingNext: { offense: Team; ballPos: number } | null;
  postScoreBanner: string; driveOver: boolean; driveOverMsg: string; log: string[];
  resultSaved: null | boolean;
};

const initial = (phase: Phase = "home"): Session => ({
  phase, p1: "", p2: "", p1PlayerId: "", p2PlayerId: "", firstHalfOpener: "p1",
  offense: "p1", possessionNum: 1, ballPos: 20, down: 1, lineToGain: 30,
  scores: { p1: 0, p2: 0 }, overtime: false, otStarter: "p1", twoPoint: false,
  pendingOff: null, pendingDef: null, subMode: null, scoringTeam: null,
  pendingNext: null, postScoreBanner: "", driveOver: false, driveOverMsg: "", log: [], resultSaved: null,
});
const other = (team: Team): Team => team === "p1" ? "p2" : "p1";
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function FirstAndTen() {
  const [session, setSession] = useState<Session>(() => initial());
  const [undoStack, setUndoStack] = useState<Session[]>([]);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [games, setGames] = useState<GameResult[]>([]);
  const [selected, setSelected] = useState<Record<Team, string>>({ p1: "", p2: "" });
  const [newNames, setNewNames] = useState<Record<Team, string>>({ p1: "", p2: "" });
  const [offCard, setOffCard] = useState<Partial<Card>>({});
  const [defCard, setDefCard] = useState<Partial<Card>>({});
  const [drawColor, setDrawColor] = useState<CardColor | null>(null);
  const [drawRank, setDrawRank] = useState<Rank | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const storedPlayers = JSON.parse(localStorage.getItem("first-ten-players") || "[]");
      const storedGames = JSON.parse(localStorage.getItem("first-ten-results") || "[]");
      setPlayers(Array.isArray(storedPlayers) ? storedPlayers : []);
      setGames(Array.isArray(storedGames) ? storedGames : []);
    } catch { setPlayers([]); setGames([]); }
    setStorageReady(true);
  }, []);

  const persist = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* degraded session-only mode */ } };
  const nameOf = (t: Team, s = session) => s[t] || (t === "p1" ? "Player 1" : "Player 2");
  const accent = (t: Team) => t === "p1" ? "var(--p1)" : "var(--p2)";
  const push = (current = session) => setUndoStack((u) => [...u.slice(-39), structuredClone(current)]);
  const act = (fn: (s: Session) => Session, withUndo = true) => {
    setSession((current) => { if (withUndo) push(current); return fn(structuredClone(current)); });
  };
  const clearInputs = () => { setOffCard({}); setDefCard({}); setDrawColor(null); setDrawRank(null); };
  const addLog = (s: Session, line: string) => { s.log = [line, ...s.log].slice(0, 60); };
  const endDrive = (s: Session, msg: string, next: { offense: Team; ballPos: number }) => {
    s.driveOver = true; s.driveOverMsg = msg; s.pendingNext = next; s.subMode = null;
  };
  const onsideEligible = (s: Session) => !s.overtime && s.possessionNum !== 4 && s.possessionNum !== 8;
  const afterScore = (s: Session, scorer: Team, banner: string) => {
    s.twoPoint = false; s.scoringTeam = scorer; s.postScoreBanner = banner; s.subMode = null;
    if (onsideEligible(s)) s.phase = "onsideChoice";
    else endDrive(s, banner, { offense: other(scorer), ballPos: 20 });
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
      const good = tieKind === "recover" || (result.kind !== "interception" && result.gain !== undefined && result.gain >= 2);
      if (good) s.scores[offense] += 2;
      addLog(s, `${narrative} Two-point try is ${good ? "GOOD! (+2)" : "no good."}`);
      afterScore(s, offense, `Two-point try: ${good ? "GOOD (+2)." : "no good."}`);
      return;
    }
    if (tieKind === "fumble" || result.kind === "interception") {
      addLog(s, narrative);
      const spot = result.kind === "interception" ? interceptionStart(los) : 100 - los;
      const msg = result.kind === "interception"
        ? (los >= 80 ? `Intercepted by ${nameOf(defense, s)} in the end zone area — touchback. ${nameOf(defense, s)} starts at its own 20.` : `Intercepted by ${nameOf(defense, s)}! Returned to ${nameOf(defense, s)}'s own ${Math.min(spot, 100 - spot)}.`)
        : `Fumble! ${nameOf(defense, s)} recovers at the spot.`;
      endDrive(s, msg, { offense: defense, ballPos: spot }); return;
    }
    const gain = tieKind === "recover" ? valueOf(o.rank) : result.gain ?? 0;
    const newPos = los + gain;
    if (newPos >= 100) {
      s.scores[offense] += 6; addLog(s, `${narrative} TOUCHDOWN!`); s.scoringTeam = offense; s.phase = "pat"; s.subMode = null; return;
    }
    if (newPos < 0) {
      s.scores[defense] += 2; addLog(s, `${narrative} — ${nameOf(defense, s)} gets a SAFETY! (+2)`);
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
  const resolveSub = () => {
    const mode = session.subMode;
    if ((mode === "tie" || mode === "xp") && !drawColor) return;
    if ((mode === "fg" || mode === "punt" || mode === "onside") && !drawRank) return;
    act((s) => {
      const offense = s.offense, defense = other(offense);
      if (mode === "tie" && s.pendingOff && s.pendingDef) applyOutcome(s, { kind: "tie" }, s.pendingOff, s.pendingDef, drawColor === "red" ? "recover" : "fumble");
      if (mode === "fg" && drawRank) {
        const distance = 100 - s.ballPos;
        if (fieldGoalGood(s.ballPos, drawRank)) { s.scores[offense] += 3; addLog(s, `${nameOf(offense, s)} drills the ${distance}-yard field goal! (+3)`); afterScore(s, offense, `Field goal (${distance} yds) is GOOD (+3)!`); }
        else { addLog(s, `${nameOf(offense, s)} misses the ${distance}-yard field goal attempt — ${nameOf(defense, s)} takes over.`); endDrive(s, `Field goal (${distance} yds) is NO GOOD — ${nameOf(defense, s)} takes over.`, { offense: defense, ballPos: 100 - s.ballPos }); }
      }
      if (mode === "punt" && drawRank) {
        const distance = puntDistance(drawRank), landing = s.ballPos + distance, touchback = landing >= 100, spot = touchback ? 20 : 100 - landing;
        addLog(s, touchback ? `${nameOf(offense, s)} punts ${distance} yards into the end zone — touchback.` : `${nameOf(offense, s)} punts ${distance} yards. ${nameOf(defense, s)} takes over.`);
        endDrive(s, touchback ? `Punt ${distance} yds — touchback. ${nameOf(defense, s)} at its 20.` : `Punt ${distance} yds — ${nameOf(defense, s)} takes over.`, { offense: defense, ballPos: spot });
      }
      if (mode === "xp" && drawColor && s.scoringTeam) {
        const good = drawColor === "red"; if (good) s.scores[s.scoringTeam] += 1;
        addLog(s, `${nameOf(s.scoringTeam, s)} extra point is ${good ? "good. (+1)" : "no good."}`);
        afterScore(s, s.scoringTeam, `${nameOf(s.scoringTeam, s)} TD — extra point ${good ? "GOOD (+1)." : "missed."}`);
      }
      if (mode === "onside" && drawRank && s.scoringTeam) {
        const recovered = drawRank === "K" || drawRank === "A", next = recovered ? s.scoringTeam : other(s.scoringTeam);
        addLog(s, recovered ? `${nameOf(s.scoringTeam, s)} recovers the onside kick! Ball at the 50.` : `${nameOf(s.scoringTeam, s)} onside kick fails — ${nameOf(next, s)} takes over at the 50.`);
        endDrive(s, recovered ? `Onside RECOVERED! ${nameOf(s.scoringTeam, s)} keeps it at the 50.` : `Onside failed — ${nameOf(next, s)} ball at the 50.`, { offense: next, ballPos: 50 });
      }
      s.pendingOff = null; s.pendingDef = null; return s;
    }); clearInputs();
  };

  const undo = () => {
    const prior = undoStack[undoStack.length - 1]; if (!prior || session.resultSaved !== null) return;
    setSession(prior); setUndoStack((u) => u.slice(0, -1)); clearInputs();
  };
  const createPlayer = (team: Team, event: FormEvent) => {
    event.preventDefault(); const name = newNames[team].trim(); if (!name) return;
    const profile = { id: uid(), name, createdAt: Date.now() }; const updated = [...players, profile];
    setPlayers(updated); persist("first-ten-players", updated); setSelected((v) => ({ ...v, [team]: profile.id })); setNewNames((v) => ({ ...v, [team]: "" }));
  };
  const resetSetup = (phase: Phase = "names") => { setSession(initial(phase)); setUndoStack([]); setSelected({ p1: "", p2: "" }); clearInputs(); };
  const navigate = (phase: Phase) => { if (phase === "names") resetSetup("names"); else { setSession((s) => ({ ...s, phase })); if (phase === "home" || phase === "history") setSelected({ p1: "", p2: "" }); } };
  const confirmPlayers = () => {
    if (!selected.p1 || !selected.p2 || selected.p1 === selected.p2) return;
    const p1 = players.find((p) => p.id === selected.p1)!, p2 = players.find((p) => p.id === selected.p2)!;
    setSession((s) => ({ ...s, phase: "possession", p1: p1.name, p2: p2.name, p1PlayerId: p1.id, p2PlayerId: p2.id }));
  };
  const startGame = (team: Team) => { act((s) => ({ ...s, firstHalfOpener: team, offense: team, possessionNum: 1, ballPos: 20, down: 1, lineToGain: 30, phase: "play" })); };
  const startNextDrive = () => {
    act((s) => {
      const n = s.possessionNum;
      if (!s.overtime && n >= 8) { s.phase = s.scores.p1 === s.scores.p2 ? "suddenDeathStart" : "gameOver"; if (s.phase === "gameOver") s.resultSaved = null; return s; }
      if (s.overtime && n % 2 === 0 && s.scores.p1 !== s.scores.p2) { s.phase = "gameOver"; s.resultSaved = null; return s; }
      if (!s.overtime && n === 4) { s.possessionNum = 5; s.offense = other(s.firstHalfOpener); s.ballPos = 20; }
      else { const nextN = n + 1; s.possessionNum = nextN; if (s.overtime) { s.offense = ((nextN - 9) % 2 === 0) ? s.otStarter : other(s.otStarter); s.ballPos = 20; } else if (s.pendingNext) { s.offense = s.pendingNext.offense; s.ballPos = s.pendingNext.ballPos; } }
      s.down = 1; s.lineToGain = Math.min(s.ballPos + 10, 100); s.driveOver = false; s.pendingNext = null; s.twoPoint = false; s.phase = "play"; return s;
    });
  };
  const startOvertime = (team: Team) => act((s) => ({ ...s, overtime: true, otStarter: team, possessionNum: 9, offense: team, ballPos: 20, down: 1, lineToGain: 30, phase: "play", driveOver: false }));
  const saveDecision = (save: boolean) => {
    if (session.resultSaved !== null) return;
    if (save) {
      const winner: Team = session.scores.p1 > session.scores.p2 ? "p1" : "p2";
      const result: GameResult = { id: uid(), playedAt: Date.now(), p1PlayerId: session.p1PlayerId, p2PlayerId: session.p2PlayerId, p1Name: session.p1, p2Name: session.p2, p1Score: session.scores.p1, p2Score: session.scores.p2, winnerPlayerId: session[`${winner}PlayerId`], overtime: session.overtime, finalPossessionNum: session.possessionNum };
      const updated = [...games, result]; setGames(updated); persist("first-ten-results", updated);
    }
    setSession((s) => ({ ...s, resultSaved: save })); setUndoStack([]);
  };

  const gameActive = ["play", "pat", "onsideChoice", "suddenDeathStart"].includes(session.phase);
  const quarter = session.overtime ? "OT" : `Q${Math.floor((session.possessionNum - 1) / 2) + 1}`;
  const distance = session.lineToGain === 100 && session.lineToGain - session.ballPos <= 10 ? "GOAL" : String(session.lineToGain - session.ballPos);
  const advanceLabel = !session.overtime && session.possessionNum >= 8 ? (session.scores.p1 === session.scores.p2 ? "Go to overtime" : "See final") : session.overtime && session.possessionNum % 2 === 0 && session.scores.p1 !== session.scores.p2 ? "See final" : !session.overtime && session.possessionNum === 4 ? "Start 2nd half" : "Start next drive";
  const winnerTeam: Team = session.scores.p1 > session.scores.p2 ? "p1" : "p2";

  if (!storageReady) return <main className="app"><Header /><section className="card"><p>Loading your field…</p></section></main>;
  return <main className="app">
    <Header />
    {!gameActive && <nav className="tabs" aria-label="Primary">
      <button className={session.phase === "home" || session.phase === "names" || session.phase === "possession" ? "active" : ""} onClick={() => navigate(session.phase === "home" ? "names" : "home")}>{session.phase === "home" ? "New Game" : "Play"}</button>
      <button className={session.phase === "history" ? "active" : ""} onClick={() => navigate("history")}>History</button>
    </nav>}
    {session.phase === "home" && <Home games={games.length} onNew={() => navigate("names")} onHistory={() => navigate("history")} />}
    {session.phase === "names" && <section className="card"><Eyebrow>Pre-game</Eyebrow><h2>Who&apos;s playing?</h2><p className="helper">Pick each player&apos;s profile, or create a new one. You&apos;ll share this screen — offense enters their card, defense enters theirs.</p><div className="setup-grid">{(["p1", "p2"] as Team[]).map((team) => <div className="profile-slot" key={team} style={{ "--accent": accent(team) } as React.CSSProperties}><h3>{team === "p1" ? "Player 1" : "Player 2"}</h3>{players.length > 0 && <div className="chips">{[...players].sort((a,b) => a.name.localeCompare(b.name)).map((p) => { const disabled = selected[other(team)] === p.id; return <button key={p.id} disabled={disabled} className={`chip ${selected[team] === p.id ? "selected" : ""}`} onClick={() => !disabled && setSelected((v) => ({ ...v, [team]: p.id }))}>{p.name}{disabled && <small>selected</small>}</button>; })}</div>}<form className="new-player" onSubmit={(e) => createPlayer(team, e)}><label className="sr-only" htmlFor={`new-${team}`}>New {team === "p1" ? "Player 1" : "Player 2"} name</label><input id={`new-${team}`} placeholder="Player name" value={newNames[team]} onChange={(e) => setNewNames((v) => ({ ...v, [team]: e.target.value }))}/><button className="secondary" disabled={!newNames[team].trim()}>Add</button></form></div>)}</div><button className="primary full" disabled={!selected.p1 || !selected.p2 || selected.p1 === selected.p2} onClick={confirmPlayers}>Continue</button></section>}
    {session.phase === "possession" && <section className="card"><Eyebrow>Coin toss</Eyebrow><h2>Who receives first?</h2><p className="helper">Cut the deck: high card picks. Possession flips at halftime.</p><div className="team-picks">{(["p1", "p2"] as Team[]).map((t) => <button className="team-pick" style={{ "--accent": accent(t) } as React.CSSProperties} key={t} onClick={() => startGame(t)}><span className="dot" /> <strong>{nameOf(t)}</strong><small>RECEIVES FIRST</small></button>)}</div></section>}
    {(["play", "pat", "onsideChoice"] as Phase[]).includes(session.phase) && <>
      <Scoreboard s={session} quarter={quarter} />
      <Field s={session} />
      {session.driveOver ? <section className="card possession-over"><Eyebrow>Possession over</Eyebrow><h2>{session.driveOverMsg}</h2><button className="primary full" onClick={startNextDrive}>{advanceLabel}</button>{undoStack.length > 0 && <button className="undo-link" onClick={undo}>↶ Undo last play</button>}</section>
      : session.subMode ? <SubPanel mode={session.subMode} s={session} drawColor={drawColor} drawRank={drawRank} setDrawColor={setDrawColor} setDrawRank={setDrawRank} resolve={resolveSub} undo={undo} canUndo={undoStack.length > 0} />
      : session.phase === "pat" ? <section className="card"><Eyebrow>Point after</Eyebrow><h2>Touchdown, {session.scoringTeam && nameOf(session.scoringTeam)}! What&apos;s the call?</h2><div className="choices"><button onClick={() => act((s) => ({ ...s, subMode: "xp" }))}><strong>Kick extra point</strong><small>Draw a card · red = good (+1)</small></button><button onClick={() => act((s) => ({ ...s, twoPoint: true, ballPos: 98, down: 1, lineToGain: 100, phase: "play" }))}><strong>Go for two</strong><small>Play one down from the 2 (+2)</small></button></div><button className="secondary" onClick={undo}>↶ Undo</button></section>
      : session.phase === "onsideChoice" ? <section className="card"><div className="amber-banner">{session.postScoreBanner}</div><Eyebrow>Kickoff</Eyebrow><h2>Onside kick?</h2><p className="helper">Try to steal the next possession, or kick deep and hand the opponent the ball at its 20.</p><div className="choices"><button onClick={() => act((s) => ({ ...s, subMode: "onside" }))}><strong>Attempt onside</strong><small>Draw · King or Ace recovers at the 50</small></button><button onClick={() => act((s) => { const scorer=s.scoringTeam!; const recv=other(scorer); addLog(s, `${nameOf(scorer,s)} kicks off deep. ${nameOf(recv,s)} receives at its 20.`); endDrive(s, `${nameOf(scorer,s)} kicks off — ${nameOf(recv,s)} receives.`, {offense:recv,ballPos:20}); return s; })}><strong>Kick it deep</strong><small>Normal kickoff · opponent at its 20</small></button></div><button className="secondary" onClick={undo}>↶ Undo</button></section>
      : <section className="card">{session.twoPoint ? <div className="amber-banner">TWO-POINT TRY · {nameOf(session.offense)} needs at least 2 yards from the 2.</div> : <div className="down-bar">{ordinal(session.down)} &amp; {distance}</div>}<div className="entry-grid"><CardEntry role="OFFENSE" name={nameOf(session.offense)} color={accent(session.offense)} card={offCard} setCard={setOffCard}/><CardEntry role="DEFENSE" name={nameOf(other(session.offense))} color={accent(other(session.offense))} card={defCard} setCard={setDefCard}/></div><p className="key">Black = RUN · Red = PASS · J/Q/K = 12 · A = 20</p><div className="action-row"><button className="primary" disabled={!offCard.color || !offCard.rank || !defCard.color || !defCard.rank} onClick={runPlay}>{session.twoPoint ? "Run the try" : "Run the play"}</button><button className="secondary" disabled={!undoStack.length} onClick={undo}>↶ Undo</button></div>{session.down === 4 && !session.twoPoint && <div className="action-row"><button className="alt" onClick={() => act((s) => ({...s, subMode:"punt"}))}>Punt</button><button className="alt" disabled={session.ballPos < 40} onClick={() => act((s) => ({...s, subMode:"fg"}))}>{session.ballPos < 40 ? "FG (need within 60 yds)" : `Field goal (${100-session.ballPos} yds — need ${fgMinRank(session.ballPos)}+)`}</button></div>}</section>}
      <PlayLog lines={session.log}/>
    </>}
    {session.phase === "suddenDeathStart" && <section className="card"><Eyebrow>Overtime</Eyebrow><h2>Tied after 4 quarters!</h2><p className="helper">Each team gets one possession from its own 20. Higher score after the round wins; if tied, play another round. Cut the deck to pick who starts.</p><div className="team-picks">{(["p1","p2"] as Team[]).map((t)=><button className="team-pick" style={{"--accent":accent(t)} as React.CSSProperties} key={t} onClick={()=>startOvertime(t)}><span className="dot"/><strong>{nameOf(t)}</strong><small>STARTS OT</small></button>)}</div></section>}
    {session.phase === "gameOver" && <section className="card final"><Eyebrow>Final</Eyebrow><h2 style={{color:accent(winnerTeam)}}>{nameOf(winnerTeam)} wins!</h2><div className="final-score"><span>{session.p1}</span><strong>{session.scores.p1} – {session.scores.p2}</strong><span>{session.p2}</span></div>{session.resultSaved === null ? <div className="save-panel"><p>Save this result to {nameOf(winnerTeam)}&apos;s and {nameOf(other(winnerTeam))}&apos;s records?</p><div className="action-row"><button className="primary" onClick={()=>saveDecision(true)}>Save result</button><button className="secondary" onClick={()=>saveDecision(false)}>Don&apos;t save</button></div></div> : <div className="save-panel"><p className={session.resultSaved ? "saved" : "helper"}>{session.resultSaved ? "✓ Saved to game history." : "Result not saved."}</p><div className="action-row"><button className="primary" onClick={()=>resetSetup("names")}>New game</button><button className="secondary" onClick={()=>navigate("history")}>View history</button></div></div>}</section>}
    {session.phase === "history" && <History players={players} games={games} onNew={()=>resetSetup("names")} />}
  </main>;
}

function Header(){return <header><h1>FIRST <span>&amp;</span> TEN</h1><p>FOOTBALL · ONE DECK · TWO PLAYERS</p></header>}
function Eyebrow({children}:{children:React.ReactNode}){return <p className="eyebrow">{children}</p>}
function Home({games,onNew,onHistory}:{games:number;onNew:()=>void;onHistory:()=>void}){return <section className="card hero"><Eyebrow>Welcome</Eyebrow><h2>First &amp; Ten</h2><p className="helper">Track drives, downs, and scores for your card-football games.</p><div className="home-actions"><button className="primary" onClick={onNew}>New Game</button><button className="alt" onClick={onHistory}>Game History</button></div>{games>0&&<p className="recorded">{games} {games===1?"game":"games"} recorded</p>}</section>}
function Scoreboard({s,quarter}:{s:Session;quarter:string}){return <section className="scoreboard">{(["p1","p2"] as Team[]).map((t,i)=><div key={t} className={`score-cell score-${t}`} style={{order:i===0?0:2}}><p>{s[t]}</p><strong>{s.scores[t]}</strong><small className={s.offense===t?"on-offense":""}>{s.offense===t?"▶ OFFENSE":"DEFENSE"}</small></div>)}<div className="score-meta"><strong>{quarter}</strong><small>{s.overtime?"SUDDEN DEATH":`POSS ${s.possessionNum}/8`}</small></div></section>}
function Field({s}:{s:Session}){return <section className="field-wrap"><div className="field" aria-label={`Ball on ${displaySpot(s.ballPos)}`}><div className="end-zone">END ZONE</div>{[10,20,30,40,50,60,70,80,90].map((n)=><div className="yard" style={{left:`${n}%`}} key={n}><span>{Math.min(n,100-n)}</span></div>)}<div className="first-line" style={{left:`${s.lineToGain}%`}}/><div className={`football ball-${s.offense}`} style={{left:`clamp(2%, ${s.ballPos}%, 98%)`}}><i/></div></div><div className="field-caption"><span>◀ own goal</span><span>Ball on the <b>{displaySpot(s.ballPos)}</b> · {100-s.ballPos} to the end zone</span><span>end zone ▶</span></div></section>}
function CardEntry({role,name,color,card,setCard}:{role:string;name:string;color:string;card:Partial<Card>;setCard:React.Dispatch<React.SetStateAction<Partial<Card>>>}){return <div className={`entry ${card.color&&card.rank?"complete":""}`} style={{"--accent":color} as React.CSSProperties}><div className="entry-head"><strong>● {role}</strong><span>{name}</span></div><div className="color-grid"><button className={card.color==="black"?"selected":""} onClick={()=>setCard(c=>({...c,color:"black"}))}>RUN ♠</button><button className={`pass ${card.color==="red"?"selected":""}`} onClick={()=>setCard(c=>({...c,color:"red"}))}>PASS ♥</button></div><div className="rank-grid">{RANKS.map(r=><button aria-label={`${role} rank ${r}`} className={card.rank===r?"selected":""} key={r} onClick={()=>setCard(c=>({...c,rank:r}))}>{r}</button>)}</div></div>}
function SubPanel({mode,s,drawColor,drawRank,setDrawColor,setDrawRank,resolve,undo,canUndo}:{mode:Exclude<SubMode,null>;s:Session;drawColor:CardColor|null;drawRank:Rank|null;setDrawColor:(c:CardColor)=>void;setDrawRank:(r:Rank)=>void;resolve:()=>void;undo:()=>void;canUndo:boolean}){const colorMode=mode==="tie"||mode==="xp";const titles={tie:"Broken play — same rank!",fg:"Field goal attempt",punt:"Punt",xp:"Extra point",onside:"Onside kick"};const confirms={tie:"Resolve recovery",fg:"Kick it",punt:"Punt it",xp:"Kick it",onside:"Kick it"};const min=fgMinRank(s.ballPos);const hints={tie:"Red → offense recovers · Black → the defense recovers at this spot",fg:`${min} or higher is good from ${100-s.ballPos} yards · anything lower misses`,punt:"Distance = rank × 5 yards (Ace = 70) · into the end zone = touchback to the 20",xp:"Red = good (+1) · Black = missed",onside:"King or Ace = recovered at the 50 · anything else, the opponent gets the 50"};return <section className="card"><Eyebrow>Draw a card</Eyebrow><h2>{titles[mode]}</h2><p className="helper">Draw the top card and enter its {colorMode?"color":"rank"}.</p>{colorMode?<div className="color-grid draw"><button className={drawColor==="black"?"selected":""} onClick={()=>setDrawColor("black")}>BLACK ♠</button><button className={`pass ${drawColor==="red"?"selected":""}`} onClick={()=>setDrawColor("red")}>RED ♥</button></div>:<div className="rank-grid draw">{RANKS.map(r=><button className={drawRank===r?"selected":""} key={r} onClick={()=>setDrawRank(r)}>{r}</button>)}</div>}<p className="key">{hints[mode]}</p><div className="action-row"><button className="primary" disabled={colorMode?!drawColor:!drawRank} onClick={resolve}>{confirms[mode]}</button><button className="secondary" disabled={!canUndo} onClick={undo}>↶ Undo</button></div></section>}
function PlayLog({lines}:{lines:string[]}){return <section className="log"><Eyebrow>Play-by-play</Eyebrow><div>{lines.length?lines.map((l,i)=><p key={`${i}-${l}`}>{l}</p>):<p className="empty-log">The opening drive is ready.</p>}</div></section>}
function History({players,games,onNew}:{players:PlayerProfile[];games:GameResult[];onNew:()=>void}){const stats=useMemo(()=>players.map(p=>({...p,...playerStats(p.id,games)})).sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name)),[players,games]);const recent=[...games].sort((a,b)=>b.playedAt-a.playedAt);if(!games.length)return <section className="card empty-history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><p>No games recorded yet. Play a game and choose to save the result to start building history.</p><button className="primary" onClick={onNew}>New Game</button></section>;return <section className="card history"><Eyebrow>Game History</Eyebrow><h2>Past games &amp; records</h2><h3>Player records</h3><div className="table-wrap"><table><thead><tr><th>Player</th><th>GP</th><th>W</th><th>L</th><th>Win%</th></tr></thead><tbody>{stats.map(p=><tr key={p.id}><th>{p.name}</th><td data-label="Games">{p.gamesPlayed}</td><td data-label="Wins">{p.wins}</td><td data-label="Losses">{p.losses}</td><td data-label="Win%">{p.winPct===null?"—":`${p.winPct}%`}</td></tr>)}</tbody></table></div><h3>Recent games</h3><div className="recent-games">{recent.map(g=>{const p1win=g.winnerPlayerId===g.p1PlayerId;return <article key={g.id}><time>{new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(g.playedAt)}</time><p><strong className={p1win?"winner":""}>{g.p1Name}</strong> {g.p1Score} – {g.p2Score} <strong className={!p1win?"winner":""}>{g.p2Name}</strong></p>{g.overtime&&<span>OT</span>}</article>})}</div></section>}
