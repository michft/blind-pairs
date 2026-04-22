export type PairCode = string;

export type SourceKind = "google" | "wiki" | "manual";

export type SourceCandidate = {
  text: string;
  source: SourceKind;
};

export type FilterMode =
  | "all"
  | "unseen"
  | "weak"
  | "due"
  | "first-letter"
  | "second-letter";

export type UserPair = {
  pair: PairCode;
  selectedText: string | null;
  customTexts: string[];
};

export type PairProgress = {
  pair: PairCode;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  currentSessionSeen: boolean;
  currentSessionWrongCount: number;
  nextAfterGuesses: number;
};

export type PersistedState = {
  version: 1;
  activeFilter: FilterMode;
  filterLetter: string;
  revealDelayMs: number;
  globalGuessIndex: number;
  activeScheme: "ax-v1";
  lastSetupPair: PairCode | null;
  pairs: Record<PairCode, UserPair>;
  progress: Record<PairCode, PairProgress>;
};

export type SourceDataset = {
  generatedAt: string;
  alphabet: string[];
  excludedPairs: string[];
  validPairs: PairCode[];
  sources: Record<PairCode, SourceCandidate[]>;
};
