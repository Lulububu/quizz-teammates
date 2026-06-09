import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AdminUser, GameState, PlayerResult, PlayerScore, Quiz, Room } from './types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(parent: HTMLElement, options: Record<string, string | number | boolean>): void;
        };
      };
    };
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  leaderboard = signal<PlayerScore[]>([]);
  gameState = signal<GameState | undefined>(undefined);
  playerResult = signal<PlayerResult | undefined>(undefined);
  adminUser = signal<AdminUser | undefined>(undefined);
  authError = signal('');
  private socket: Socket;
  private idToken = localStorage.getItem('adminIdToken') ?? '';

  constructor(private http: HttpClient) {
    this.socket = io();
    this.socket.on('leaderboard', (scores: PlayerScore[]) => this.leaderboard.set(scores));
    this.socket.on('game-state', (state: GameState) => {
      if (state.status === 'question') this.playerResult.set(undefined);
      this.gameState.set(state);
    });
    this.socket.on('host-game-state', (state: GameState) => this.gameState.set(state));
    this.socket.on('player-result', (result: PlayerResult) => this.playerResult.set(result));
    if (this.idToken) this.loadAdminUser();
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

  private emit<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (response: T) => resolve(response));
    });
  }

  initializeGoogleButton(elementId: string): void {
    this.http.get<{ googleClientId: string }>('/api/auth/config').subscribe({
      next: (config) => {
        if (!config.googleClientId) {
          this.authError.set('GOOGLE_CLIENT_ID doit etre configure cote serveur.');
          return;
        }
        this.renderGoogleButton(elementId, config.googleClientId);
      },
      error: () => this.authError.set('Impossible de charger la configuration Google.'),
    });
  }

  signOut(): void {
    this.idToken = '';
    localStorage.removeItem('adminIdToken');
    this.adminUser.set(undefined);
    this.authError.set('');
  }

  private renderGoogleButton(elementId: string, clientId: string): void {
    const target = document.getElementById(elementId);
    if (!target) return;
    if (!window.google?.accounts?.id) {
      window.setTimeout(() => this.renderGoogleButton(elementId, clientId), 250);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        this.idToken = response.credential;
        localStorage.setItem('adminIdToken', this.idToken);
        this.loadAdminUser();
      },
    });
    target.innerHTML = '';
    window.google.accounts.id.renderButton(target, {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      locale: 'fr',
    });
  }

  private loadAdminUser(): void {
    this.http.get<AdminUser>('/api/auth/me', { headers: this.authHeaders() }).subscribe({
      next: (user) => {
        this.adminUser.set(user);
        this.authError.set('');
      },
      error: () => {
        this.signOut();
        this.authError.set('Session Google expiree ou invalide.');
      },
    });
  }

  private authHeaders(): HttpHeaders {
    return this.idToken ? new HttpHeaders({ Authorization: `Bearer ${this.idToken}` }) : new HttpHeaders();
  }
}
