import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { GameResult, PlayerProfile } from "./game-engine";
import { firebaseConfig } from "./firebase-config";
import {
  normalizeCloudStateForRuntime, PersistenceValidationError, toPersistedCloudState,
  type PersistedCloudState,
} from "./persistence";

export const cloudConfigured = Object.values(firebaseConfig).every(Boolean);
const app = cloudConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

export type CloudState = { players: PlayerProfile[]; gameResults: GameResult[] };
const writeTails = new Map<string, Promise<void>>();

export function watchAuth(callback: (user: User | null) => void) {
  if (!auth) { callback(null); return () => undefined; }
  return onAuthStateChanged(auth, callback);
}

export async function signInToCloud() {
  if (!auth) throw new Error("Cloud sync is not configured yet.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export async function signOutOfCloud() {
  if (auth) await signOut(auth);
}

export function watchCloudState(userId: string, callback: (state: CloudState | null) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  return onSnapshot(doc(db, "users", userId), (snapshot) => {
    if (!snapshot.exists()) { callback(null); return; }
    const normalized = normalizeCloudStateForRuntime(snapshot.data());
    if (normalized.rejectedGameIds.length) {
      console.warn("Cloud read quarantined invalid game records.", { code: "CLOUD_READ_INVALID_RECORD", count: normalized.rejectedGameIds.length });
    }
    callback(normalized.state);
  }, onError);
}

async function writePersistedCloudState(userId: string, state: PersistedCloudState) {
  if (!db) throw new Error("Cloud sync is not configured yet.");
  await setDoc(doc(db, "users", userId), { ...state, updatedAt: serverTimestamp() });
}

export async function saveCloudState(userId: string, state: CloudState) {
  if (!db) throw new Error("Cloud sync is not configured yet.");
  let persisted: PersistedCloudState;
  try {
    persisted = toPersistedCloudState(state.players, state.gameResults);
  } catch (error) {
    if (error instanceof PersistenceValidationError) {
      console.warn("Cloud payload validation failed.", { code: error.code, path: error.path, recordId: error.recordId });
    }
    throw error;
  }

  // Serialize whole-document writes for each user. A later payload always runs
  // after an earlier one, so an older in-flight request cannot win the race.
  const previous = writeTails.get(userId) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => writePersistedCloudState(userId, persisted));
  writeTails.set(userId, operation.catch(() => undefined));
  await operation;
}
