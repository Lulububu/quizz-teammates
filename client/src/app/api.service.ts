import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import { io, Socket } from 'socket.io-client';
import { firstValueFrom } from 'rxjs';
import { AdminUser, AnswerDictionary, GameState, LobbyReaction, PlayerResult, PlayerScore, Quiz, Room } from './types';

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
};

type UploadClueKind = 'image' | 'audio' | 'video';

type CloudinaryUploadSignature = {
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  resourceType: 'image' | 'video';
  signature: string;
  timestamp: number;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  leaderboard = signal<PlayerScore[]>([]);
  gameState = signal<GameState | undefined>(undefined);
  playerResult = signal<PlayerResult | undefined>(undefined);
  playerRemoved = signal('');
  lobbyReactions = signal<LobbyReaction[]>([]);
  hostRoomMeta = signal<Room | undefined>(undefined);
  adminUser = signal<AdminUser | undefined>(undefined);
  authError = signal('');
  authReady = signal(false);
  private socket: Socket;
  private firebaseApp: FirebaseApp | undefined;
  private auth: Auth | undefined;
  private idToken = '';

  constructor(private http: HttpClient) {
    this.socket = io();
    this.socket.on('leaderboard', (scores: PlayerScore[]) => this.leaderboard.set(scores));
    this.socket.on('game-state', (state: GameState) => {
      const currentState = this.gameState();
      const currentQuestion = currentState?.activeQuestion;
      const incomingQuestion = state.activeQuestion;
      if (
        incomingQuestion?.answerMode === 'autocomplete'
        && incomingQuestion.suggestions.length === 0
        && currentQuestion?.targetId === incomingQuestion.targetId
        && currentQuestion.suggestions.length > 0
      ) {
        state = {
          ...state,
          activeQuestion: {
            ...incomingQuestion,
            suggestions: currentQuestion.suggestions,
          },
        };
      }
      if (state.status === 'question') this.playerResult.set(undefined);
      this.gameState.set(state);
    });
    this.socket.on('host-game-state', (state: GameState) => this.gameState.set(state));
    this.socket.on('player-result', (result: PlayerResult) => this.playerResult.set(result));
    this.socket.on('player-removed', (payload: { message?: string }) => {
      this.playerRemoved.set(payload.message ?? 'Vous avez été retiré du salon.');
    });
    this.socket.on('lobby-reaction', (reaction: LobbyReaction) => {
      this.lobbyReactions.update((reactions) => [...reactions, reaction]);
      window.setTimeout(() => {
        this.lobbyReactions.update((reactions) => reactions.filter((item) => item.id !== reaction.id));
      }, 3200);
    });
    this.initializeFirebase();
  }

  listQuizzes() {
    return this.http.get<Quiz[]>('/api/quizzes', { headers: this.authHeaders() });
  }

  createQuiz(payload: unknown) {
    return this.http.post<Quiz>('/api/quizzes', payload, { headers: this.authHeaders() });
  }

  updateQuiz(quizId: string, payload: unknown) {
    return this.http.put<Quiz>(`/api/quizzes/${quizId}`, payload, { headers: this.authHeaders() });
  }

  deleteQuiz(quizId: string) {
    return this.http.delete<void>(`/api/quizzes/${quizId}`, { headers: this.authHeaders() });
  }

  listAnswerDictionaries() {
    return this.http.get<AnswerDictionary[]>('/api/answer-dictionaries', { headers: this.authHeaders() });
  }

  saveAnswerDictionary(dictionary: { id?: string; name: string; values: string[] }) {
    if (dictionary.id) {
      return this.http.put<AnswerDictionary>(`/api/answer-dictionaries/${dictionary.id}`, dictionary, {
        headers: this.authHeaders(),
      });
    }
    return this.http.post<AnswerDictionary>('/api/answer-dictionaries', dictionary, { headers: this.authHeaders() });
  }

  deleteAnswerDictionary(dictionaryId: string) {
    return this.http.delete<void>(`/api/answer-dictionaries/${dictionaryId}`, { headers: this.authHeaders() });
  }

  getQuiz(quizId: string) {
    return this.http.get<Quiz>(`/api/quizzes/${quizId}`, { headers: this.authHeaders() });
  }

  getQuizForEditing(quizId: string) {
    return this.http.get<Quiz>(`/api/quizzes/${quizId}/edit`, { headers: this.authHeaders() });
  }

  createRoom(quizId: string) {
    return this.http.post<Room>(`/api/quizzes/${quizId}/rooms`, {}, { headers: this.authHeaders() });
  }

  getRoom(code: string) {
    return this.http.get<Room>(`/api/rooms/${code}`);
  }

  joinRoom(
    code: string,
    nickname: string,
  ): Promise<{ ok: boolean; playerId?: string; player?: PlayerScore; gameState?: GameState; error?: string }> {
    return this.emit('join-room', { code, nickname });
  }

  resumePlayer(
    code: string,
    playerId: string,
  ): Promise<{ ok: boolean; player?: PlayerScore; gameState?: GameState; error?: string }> {
    return this.emit('resume-player', { code, playerId });
  }

  hostRoom(code: string): Promise<{ ok: boolean; gameState?: GameState; error?: string }> {
    return this.emit('host-room', { code, idToken: this.idToken });
  }

  startGame(code: string): Promise<{ ok: boolean; error?: string }> {
    return this.emit('start-game', { code, idToken: this.idToken });
  }

  nextQuestion(code: string): Promise<{ ok: boolean; error?: string }> {
    return this.emit('next-question', { code, idToken: this.idToken });
  }

  removePlayer(code: string, playerId: string): Promise<{ ok: boolean; error?: string }> {
    return this.emit('remove-player', { code, playerId, idToken: this.idToken });
  }

  setPlayerNamesVisibility(code: string, hidePlayerNames: boolean): Promise<{ ok: boolean; error?: string }> {
    return this.emit('set-player-names-visibility', { code, hidePlayerNames, idToken: this.idToken });
  }

  sendLobbyReaction(code: string, playerId: string, emoji: string): Promise<{ ok: boolean; error?: string }> {
    return this.emit('lobby-reaction', { code, playerId, emoji });
  }

  submitAnswer(payload: {
    code: string;
    playerId: string;
    roundId: string;
    targetType: 'work' | 'person';
    targetId: string;
    optionId?: string;
    value?: string;
  }): Promise<{ ok: boolean; isCorrect?: boolean; points?: number; error?: string }> {
    return this.emitWithTimeout('submit-answer', payload, 12_000);
  }

  async signInWithGoogle(): Promise<void> {
    if (!this.auth) {
      this.authError.set('Firebase doit être configuré avant la connexion.');
      return;
    }
    try {
      await signInWithPopup(this.auth, new GoogleAuthProvider());
    } catch (error) {
      this.authError.set(error instanceof Error ? error.message : 'Connexion Google impossible.');
    }
  }

  async signOut(): Promise<void> {
    if (this.auth) await signOut(this.auth);
    this.idToken = '';
    this.adminUser.set(undefined);
    this.authError.set('');
  }

  async uploadClueFile(file: File, kind: UploadClueKind): Promise<string> {
    const limits: Record<UploadClueKind, number> = {
      image: 5 * 1024 * 1024,
      audio: 10 * 1024 * 1024,
      video: 20 * 1024 * 1024,
    };
    if (!file.type.startsWith(`${kind}/`)) {
      throw new Error(`Le fichier sélectionné n'est pas un fichier ${kind === 'image' ? 'image' : kind === 'audio' ? 'audio' : 'vidéo'}.`);
    }
    if (file.size > limits[kind]) {
      throw new Error(`Ce fichier dépasse la limite de ${limits[kind] / 1024 / 1024} Mo.`);
    }
    const upload = await firstValueFrom(
      this.http.post<CloudinaryUploadSignature>(
        '/api/uploads/cloudinary/signature',
        { kind },
        { headers: this.authHeaders() },
      ),
    );
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', upload.apiKey);
    formData.append('timestamp', String(upload.timestamp));
    formData.append('signature', upload.signature);
    formData.append('folder', upload.folder);
    formData.append('public_id', upload.publicId);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(upload.cloudName)}/${upload.resourceType}/upload`,
      { method: 'POST', body: formData },
    );
    const result = await response.json() as { secure_url?: string; error?: { message?: string } };
    if (!response.ok || !result.secure_url) {
      throw new Error(result.error?.message ?? 'Cloudinary a refusé le téléversement.');
    }
    return result.secure_url;
  }

  private emit<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (response: T) => resolve(response));
    });
  }

  private emitWithTimeout<T>(event: string, payload: unknown, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: T) => {
        if (error) {
          reject(new Error("Le serveur met trop de temps à répondre."));
          return;
        }
        resolve(response);
      });
    });
  }

  private initializeFirebase(): void {
    this.http.get<{ firebase: FirebaseWebConfig }>('/api/auth/config').subscribe({
      next: ({ firebase }) => {
        if (!firebase.apiKey || !firebase.authDomain || !firebase.projectId || !firebase.appId) {
          this.authError.set('Configuration Firebase web incomplète côté serveur.');
          this.authReady.set(true);
          return;
        }
        this.firebaseApp = initializeApp(firebase);
        this.auth = getAuth(this.firebaseApp);
        onAuthStateChanged(this.auth, async (user) => {
          if (!user) {
            this.idToken = '';
            this.adminUser.set(undefined);
            this.authReady.set(true);
            return;
          }
          try {
            this.idToken = await user.getIdToken();
            this.loadAdminUser();
          } catch {
            this.idToken = '';
            this.adminUser.set(undefined);
            this.authError.set('Impossible de restaurer la session Firebase.');
            this.authReady.set(true);
          }
        });
      },
      error: () => {
        this.authError.set('Impossible de charger la configuration Firebase.');
        this.authReady.set(true);
      },
    });
  }

  private loadAdminUser(): void {
    this.http.get<AdminUser>('/api/auth/me', { headers: this.authHeaders() }).subscribe({
      next: (user) => {
        this.adminUser.set(user);
        this.authError.set('');
        this.authReady.set(true);
      },
      error: () => {
        this.idToken = '';
        this.adminUser.set(undefined);
        this.authError.set('Session Firebase expirée ou invalide.');
        this.authReady.set(true);
      },
    });
  }

  private authHeaders(): HttpHeaders {
    return this.idToken ? new HttpHeaders({ Authorization: `Bearer ${this.idToken}` }) : new HttpHeaders();
  }
}
