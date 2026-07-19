import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { GameResult, PlayerProfile } from "./game-engine";
import { firebaseConfig } from "./firebase-config";

export const cloudConfigured = Object.values(firebaseConfig).every(Boolean);
const app = cloudConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

export type CloudState = { players: PlayerProfile[]; gameResults: GameResult[] };

export function watchAuth(callback: (user: User | null) => void) {
  if (!auth) { callback(null); return () => undefined; }
  return onAuthStateChanged(auth, callback);
}

export async function signInToCloud() {
  if (!auth) throw new Error("Cloud sync is not configured yet.");
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutOfCloud() {
  if (auth) await signOut(auth);
}

export function watchCloudState(userId: string, callback: (state: CloudState | null) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  return onSnapshot(doc(db, "users", userId), (snapshot) => {
    if (!snapshot.exists()) { callback(null); return; }
    const data = snapshot.data();
    callback({
      players: Array.isArray(data.players) ? data.players : [],
      gameResults: Array.isArray(data.gameResults) ? data.gameResults : [],
    });
  }, onError);
}

export async function saveCloudState(userId: string, state: CloudState) {
  if (!db) throw new Error("Cloud sync is not configured yet.");
  await setDoc(doc(db, "users", userId), { ...state, updatedAt: serverTimestamp() });
}
