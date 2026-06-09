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
import { AdminUser, GameState, PlayerResult, PlayerScore, Quiz, Room } from './types';

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  leaderboard = signal<PlayerScore[]>([]);
  gameState = signal<GameState | undefined>(undefined);
  playerResult = signal<PlayerResult | undefined>(undefined);
  adminUser = signal<AdminUser | undefined>(undefined);
  authError = signal('');
  private socket: Socket;
  private firebaseApp: FirebaseApp | undefined;
  private auth: Auth | undefined;
  private idToken = '';

  constructor(private http: HttpClient) {
    this.socket = io();
    this.socket.on('leaderboard', (scores: PlayerScore[]) => this.leaderboard.set(scores));
    this.socket.on('game-state', (state: GameState) => {
      if (state.status === 'question') this.playerResult.set(undefined);
      this.gameState.set(state);
    });
    this.socket.on('host-game-state', (state: GameState) => this.gameState.set(state));
    this.socket.on('player-result', (result: PlayerResult) => this.playerResult.set(result));
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
  ): Promise<{ ok: boolean; playerId?: string; gameState?: GameState; error?: string }> {
    return this.emit('join-room', { code, nickname });
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

  submitAnswer(payload: {
    code: string;
    playerId: string;
    roundId: string;
    targetType: 'work' | 'person';
    targetId: string;
    optionId: string;
  }): Promise<{ ok: boolean; isCorrect?: boolean; points?: number; error?: string }> {
    return this.emit('submit-answer', payload);
  }

  async signInWithGoogle(): Promise<void> {
    if (!this.auth) {
      this.authError.set('Firebase doit etre configure avant la connexion.');
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

  private emit<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (response: T) => resolve(response));
    });
  }

  private initializeFirebase(): void {
    this.http.get<{ firebase: FirebaseWebConfig }>('/api/auth/config').subscribe({
      next: ({ firebase }) => {
        if (!firebase.apiKey || !firebase.authDomain || !firebase.projectId || !firebase.appId) {
          this.authError.set('Configuration Firebase web incomplete cote serveur.');
          return;
        }
        this.firebaseApp = initializeApp(firebase);
        this.auth = getAuth(this.firebaseApp);
        onAuthStateChanged(this.auth, async (user) => {
          if (!user) {
            this.idToken = '';
            this.adminUser.set(undefined);
            return;
          }
          this.idToken = await user.getIdToken();
          this.loadAdminUser();
        });
      },
      error: () => this.authError.set('Impossible de charger la configuration Firebase.'),
    });
  }

  private loadAdminUser(): void {
    this.http.get<AdminUser>('/api/auth/me', { headers: this.authHeaders() }).subscribe({
      next: (user) => {
        this.adminUser.set(user);
        this.authError.set('');
      },
      error: () => {
        this.idToken = '';
        this.adminUser.set(undefined);
        this.authError.set('Session Firebase expiree ou invalide.');
      },
    });
  }

  private authHeaders(): HttpHeaders {
    return this.idToken ? new HttpHeaders({ Authorization: `Bearer ${this.idToken}` }) : new HttpHeaders();
  }
}
