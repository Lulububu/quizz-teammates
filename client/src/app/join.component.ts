import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from './api.service';
import { Clue, GameState, Room } from './types';

type SearchEntry = {
  label: string;
  normalized: string;
};

@Component({
  selector: 'app-join',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <main class="page player-page grid">
      <section class="panel player-shell grid">
        <header class="player-header">
          <div>
            <p class="eyebrow">Quiz Teammates</p>
            <h1>Participation</h1>
          </div>
          <span class="room-code">Code {{ code() }}</span>
        </header>

        @if (roomError()) {
          <div class="empty-state" role="alert">
            <h2>Impossible de rejoindre cette partie</h2>
            <p>{{ roomError() }}</p>
            <a class="button-link secondary" href="/">Saisir un autre code</a>
          </div>
        } @else if (loading()) {
          <p class="loading-state">Chargement de la partie…</p>
        } @else {
          @if (!playerId()) {
            <form class="join-player-form" (ngSubmit)="join()">
              <label>
                Pseudo
                <input
                  [(ngModel)]="nickname"
                  name="nickname"
                  minlength="2"
                  maxlength="24"
                  autocomplete="nickname"
                  placeholder="Votre pseudo"
                >
                @if (nicknameError()) {
                  <span class="field-error">{{ nicknameError() }}</span>
                }
              </label>
              <button type="submit" [disabled]="joining() || !!nicknameError()">
                {{ joining() ? 'Inscription…' : 'Rejoindre' }}
              </button>
            </form>
          }

          @if (api.gameState(); as state) {
            @if (state.status === 'lobby') {
              <article class="waiting-state">
                <div class="waiting-pulse" aria-hidden="true"></div>
                <h2>{{ playerId() ? 'Vous êtes prêt' : 'La partie attend ses joueurs' }}</h2>
                <p>L'animateur lancera le quiz quand tout le monde sera prêt.</p>
              </article>
            } @else if (state.status === 'question' && state.activeQuestion) {
              <article class="question-card grid">
                <div class="question-meta">
                  <span>Question {{ state.currentQuestionIndex + 1 }} / {{ state.totalQuestions }}</span>
                  <div
                    class="timer-ring"
                    [style.--progress]="timerProgress() + '%'"
                    [class.urgent]="remainingSeconds() <= 5"
                    [attr.aria-label]="'Temps restant : ' + remainingSeconds() + ' secondes'"
                  >
                    {{ remainingSeconds() }}
                  </div>
                </div>
                <h2>{{ state.activeQuestion.prompt }}</h2>

                @if (state.activeQuestion.targetType === 'person') {
                  <div class="work-name-recap" aria-label="Œuvres de la manche">
                    @for (work of state.activeQuestion.works; track work.title; let index = $index) {
                      <div>
                        <span>Œuvre {{ index + 1 }}</span>
                        <strong>{{ work.title }}</strong>
                      </div>
                    }
                  </div>
                } @else {
                  <div class="clue-list">
                    @for (clue of visibleClues(state); track clue.id || clue.content) {
                      <div class="clue-chip">
                        <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue }" />
                      </div>
                    }
                  </div>
                }

                @if (answeredQuestionIndex() === state.currentQuestionIndex) {
                  <div class="submitted-answer" role="status">
                    <span>Réponse envoyée</span>
                    <strong>{{ selectedAnswer() }}</strong>
                  </div>
                } @else if (sendingAnswer()) {
                  <div class="answer-sending" role="status" aria-live="polite">
                    <div class="waiting-pulse small" aria-hidden="true"></div>
                    <div>
                      <strong>Envoi de votre réponse…</strong>
                      <p>{{ selectedAnswer() }}</p>
                      <span>Veuillez patienter, la validation peut prendre quelques secondes.</span>
                    </div>
                  </div>
                } @else if (state.activeQuestion.answerMode === 'autocomplete') {
                  <div class="autocomplete">
                    <label>
                      Rechercher une œuvre ou une réponse
                      <input
                        [ngModel]="answerQuery()"
                        (ngModelChange)="updateAnswerQuery($event)"
                        placeholder="Saisissez au moins 2 caractères"
                        autocomplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        [attr.aria-expanded]="showSuggestions()"
                        [disabled]="!canAnswer() || sendingAnswer()"
                        (keydown)="handleAutocompleteKey($event)"
                      >
                    </label>
                    @if (showSuggestions()) {
                      <div class="suggestion-list" role="listbox">
                        @for (suggestion of filteredSuggestions(); track suggestion; let index = $index) {
                          <button
                            type="button"
                            role="option"
                            [class.active]="suggestionIndex() === index"
                            [attr.aria-selected]="suggestionIndex() === index"
                            (click)="selectSuggestion(suggestion)"
                          >
                            {{ suggestion }}
                          </button>
                        }
                      </div>
                    }
                    @if (answerQuery().trim().length >= 2 && filteredSuggestions().length === 0 && !selectedAutocompleteAnswer()) {
                      <p class="search-empty">Aucun résultat pour cette recherche.</p>
                    }
                    @if (selectedAutocompleteAnswer()) {
                      <div class="selected-search-answer">
                        <span>Réponse sélectionnée</span>
                        <strong>{{ selectedAutocompleteAnswer() }}</strong>
                        <button type="button" class="secondary" (click)="clearSelectedAnswer()">Modifier</button>
                      </div>
                    }
                    <div class="answer-submit-bar">
                      <span>
                        {{ selectedAutocompleteAnswer()
                          ? 'Vérifiez votre choix avant de l’envoyer.'
                          : 'Choisissez un résultat dans la liste pour pouvoir valider.' }}
                      </span>
                      <button
                        type="button"
                        [disabled]="!canAnswer() || sendingAnswer() || !selectedAutocompleteAnswer()"
                        (click)="answerTextValue()"
                      >
                        Valider la réponse
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="answer-options">
                    @for (option of state.activeQuestion.options; track option.id; let index = $index) {
                      <button
                        type="button"
                        class="answer-option"
                        [attr.data-choice]="index + 1"
                        [disabled]="!canAnswer() || sendingAnswer()"
                        (click)="answer(option.id, option.label)"
                      >
                        <span>{{ index + 1 }}</span>
                        {{ option.label }}
                      </button>
                    }
                  </div>
                }
              </article>
            } @else if (state.status === 'reveal' && state.activeQuestion) {
              @if (api.playerResult(); as result) {
                <article class="result-card grid" [class.missed]="!result.isCorrect">
                  <div class="burst" aria-hidden="true"></div>
                  <p class="result-kicker">{{ result.isCorrect ? 'Bonne réponse' : 'Dommage' }}</p>
                  <h2>{{ result.isCorrect ? '+' + result.points + ' points' : '0 point' }}</h2>
                  <div class="result-stats">
                    <p>Total<strong>{{ result.totalScore }}</strong></p>
                    <p>Position<strong>{{ result.rank || '-' }} / {{ result.totalPlayers || state.playerCount }}</strong></p>
                  </div>
                  <div class="correct-answer" [class.incorrect]="!result.isCorrect">
                    <span>{{ result.isCorrect ? 'Bonne réponse' : 'La bonne réponse était' }}</span>
                    <strong>{{ state.activeQuestion.correctOption?.label || 'Réponse indisponible' }}</strong>
                  </div>
                </article>
              } @else {
                <article class="result-pending" role="status" aria-live="polite">
                  <div class="waiting-pulse" aria-hidden="true"></div>
                  <h2>Calcul de votre résultat…</h2>
                  <p>Votre réponse a bien été reçue. Le score et le classement arrivent.</p>
                </article>
              }
            } @else if (state.status === 'finished') {
              <article class="item grid">
                <h2>Quiz terminé</h2>
                <ol class="leaderboard">
                  @for (player of state.leaderboard; track player.id; let index = $index) {
                    <li [class.current-player]="player.id === playerId()">
                      <strong>{{ index + 1 }}</strong>
                      <span>{{ player.nickname }}</span>
                      <strong>{{ player.score }}</strong>
                    </li>
                  }
                </ol>
              </article>
            }
          }
        }

        @if (message()) {
          <p class="status-message" [class.error]="messageIsError()" role="status">{{ message() }}</p>
        }
      </section>
    </main>

    <ng-template #clueTpl let-clue="clue">
      @if (clue.kind === 'image' || isImageUrl(clue.content)) {
        <figure class="clue-figure">
          <img [src]="clue.content" alt="Indice visuel">
        </figure>
      } @else if (clue.kind === 'audio') {
        <div class="clue-media audio-clue">
          <span>Indice sonore</span>
          <audio [src]="clue.content" controls preload="metadata"></audio>
        </div>
      } @else if (clue.kind === 'video') {
        <div class="clue-media">
          <video [src]="clue.content" controls preload="metadata" playsinline></video>
        </div>
      } @else {
        <p><strong>Indice :</strong> {{ clue.content }}</p>
      }
    </ng-template>
  `,
})
export class JoinComponent implements OnInit, OnDestroy {
  code = signal('');
  room = signal<Room | undefined>(undefined);
  playerId = signal('');
  loading = signal(true);
  joining = signal(false);
  roomError = signal('');
  message = signal('');
  messageIsError = signal(false);
  sendingAnswer = signal(false);
  answeredQuestionIndex = signal<number | undefined>(undefined);
  selectedAnswer = signal('');
  answerQuery = signal('');
  selectedAutocompleteAnswer = signal('');
  searchIndex = signal<SearchEntry[]>([]);
  suggestionIndex = signal(0);
  now = signal(Date.now());
  canAnswer = computed(
    () => Boolean(this.playerId()) && this.api.gameState()?.status === 'question' && !this.sendingAnswer(),
  );
  remainingSeconds = computed(() => {
    const endsAt = this.api.gameState()?.questionEndsAt;
    if (!endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(endsAt).getTime() - this.now()) / 1000));
  });
  timerProgress = computed(() => {
    const state = this.api.gameState();
    if (!state?.questionStartedAt || !state.questionEndsAt) return 0;
    const start = new Date(state.questionStartedAt).getTime();
    const end = new Date(state.questionEndsAt).getTime();
    return Math.max(0, Math.min(100, ((end - this.now()) / Math.max(1, end - start)) * 100));
  });
  filteredSuggestions = computed(() => {
    const query = this.normalize(this.answerQuery());
    if (query.length < 2 || this.selectedAutocompleteAnswer()) return [];
    const startsWith: string[] = [];
    const contains: string[] = [];
    for (const entry of this.searchIndex()) {
      if (entry.normalized.startsWith(query)) startsWith.push(entry.label);
      else if (contains.length < 8 && entry.normalized.includes(query)) contains.push(entry.label);
      if (startsWith.length >= 8) break;
    }
    return [...startsWith, ...contains].slice(0, 8);
  });
  showSuggestions = computed(() => this.filteredSuggestions().length > 0 && !this.selectedAutocompleteAnswer());
  nickname = '';
  private timerId: number | undefined;
  private currentQuestionIndex: number | undefined;

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {
    effect(() => {
      const index = this.api.gameState()?.currentQuestionIndex;
      if (index !== undefined && index !== this.currentQuestionIndex) {
        this.currentQuestionIndex = index;
        this.answerQuery.set('');
        this.selectedAutocompleteAnswer.set('');
        this.searchIndex.set(
          (this.api.gameState()?.activeQuestion?.suggestions ?? []).map((label) => ({
            label,
            normalized: this.normalize(label),
          })),
        );
        this.selectedAnswer.set('');
        this.sendingAnswer.set(false);
        this.suggestionIndex.set(0);
        this.answeredQuestionIndex.set(undefined);
      }
    }, { allowSignalWrites: true });
    effect(() => {
      const removalMessage = this.api.playerRemoved();
      if (!removalMessage) return;
      sessionStorage.removeItem(this.sessionKey());
      this.playerId.set('');
      this.roomError.set(removalMessage);
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.api.playerRemoved.set('');
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();
    this.code.set(code);
    this.api.getRoom(code).subscribe({
      next: (room) => {
        this.room.set(room);
        this.api.gameState.set(room.gameState);
        this.loading.set(false);
        void this.restoreSession();
      },
      error: () => {
        this.loading.set(false);
        this.roomError.set("Ce code ne correspond à aucun salon actif.");
      },
    });
    this.timerId = window.setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnDestroy(): void {
    if (this.timerId) window.clearInterval(this.timerId);
  }

  nicknameError(): string {
    const nickname = this.nickname.trim();
    if (!nickname) return 'Le pseudo est obligatoire.';
    if (nickname.length < 2) return 'Saisissez au moins 2 caractères.';
    if (nickname.length > 24) return 'Le pseudo est limité à 24 caractères.';
    return '';
  }

  async join(): Promise<void> {
    if (this.nicknameError()) return;
    this.joining.set(true);
    const response = await this.api.joinRoom(this.code(), this.nickname.trim());
    this.joining.set(false);
    if (!response.ok || !response.playerId) {
      this.showMessage(response.error ?? 'Impossible de rejoindre le salon.', true);
      return;
    }
    this.playerId.set(response.playerId);
    sessionStorage.setItem(this.sessionKey(), JSON.stringify({ playerId: response.playerId, nickname: this.nickname.trim() }));
    if (response.gameState) this.api.gameState.set(response.gameState);
    this.showMessage('Vous êtes inscrit.');
  }

  async answer(optionId: string, label: string): Promise<void> {
    const question = this.api.gameState()?.activeQuestion;
    const questionIndex = this.api.gameState()?.currentQuestionIndex;
    if (!question || questionIndex === undefined) return;
    this.sendingAnswer.set(true);
    this.selectedAnswer.set(label);
    this.showMessage('Envoi de votre réponse en cours…');
    try {
      const response = await this.api.submitAnswer({
        code: this.code(),
        playerId: this.playerId(),
        roundId: question.roundId,
        targetType: question.targetType,
        targetId: question.targetId,
        optionId,
      });
      if (!response.ok) {
        this.selectedAnswer.set('');
        this.showMessage(response.error ?? 'Réponse refusée.', true);
        return;
      }
      this.answeredQuestionIndex.set(questionIndex);
      this.showMessage('Réponse envoyée et enregistrée.');
    } catch {
      this.selectedAnswer.set('');
      this.showMessage("La réponse n'a pas pu être envoyée. Réessayez.", true);
    } finally {
      this.sendingAnswer.set(false);
    }
  }

  async answerTextValue(): Promise<void> {
    const question = this.api.gameState()?.activeQuestion;
    const questionIndex = this.api.gameState()?.currentQuestionIndex;
    const answer = this.selectedAutocompleteAnswer();
    if (!question || questionIndex === undefined || !answer) return;
    this.sendingAnswer.set(true);
    this.selectedAnswer.set(answer);
    this.showMessage('Envoi de votre réponse en cours…');
    try {
      const response = await this.api.submitAnswer({
        code: this.code(),
        playerId: this.playerId(),
        roundId: question.roundId,
        targetType: question.targetType,
        targetId: question.targetId,
        value: answer,
      });
      if (!response.ok) {
        this.selectedAnswer.set('');
        this.showMessage(response.error ?? 'Réponse refusée.', true);
        return;
      }
      this.answeredQuestionIndex.set(questionIndex);
      this.showMessage('Réponse envoyée et enregistrée.');
    } catch {
      this.selectedAnswer.set('');
      this.showMessage("La réponse n'a pas pu être envoyée. Réessayez.", true);
    } finally {
      this.sendingAnswer.set(false);
    }
  }

  handleAutocompleteKey(event: KeyboardEvent): void {
    const suggestions = this.filteredSuggestions();
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.suggestionIndex.update((index) => Math.min(suggestions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.suggestionIndex.update((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.selectSuggestion(suggestions[this.suggestionIndex()]);
    } else if (event.key === 'Escape') {
      this.answerQuery.set('');
      this.suggestionIndex.set(0);
    }
  }

  selectSuggestion(suggestion: string): void {
    this.answerQuery.set(suggestion);
    this.selectedAutocompleteAnswer.set(suggestion);
    this.suggestionIndex.set(0);
  }

  updateAnswerQuery(value: string): void {
    this.answerQuery.set(value);
    if (value !== this.selectedAutocompleteAnswer()) this.selectedAutocompleteAnswer.set('');
    this.suggestionIndex.set(0);
  }

  clearSelectedAnswer(): void {
    this.selectedAutocompleteAnswer.set('');
    this.answerQuery.set('');
    this.suggestionIndex.set(0);
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, this.visibleClueCount(state, clues.length));
  }

  isImageUrl(value: string): boolean {
    return isLikelyImage(value);
  }

  private async restoreSession(): Promise<void> {
    const raw = sessionStorage.getItem(this.sessionKey());
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { playerId?: string; nickname?: string };
      if (!saved.playerId) return;
      const response = await this.api.resumePlayer(this.code(), saved.playerId);
      if (!response.ok) {
        sessionStorage.removeItem(this.sessionKey());
        return;
      }
      this.playerId.set(saved.playerId);
      this.nickname = saved.nickname ?? response.player?.nickname ?? '';
      if (response.gameState) this.api.gameState.set(response.gameState);
      this.showMessage('Session joueur restaurée.');
    } catch {
      sessionStorage.removeItem(this.sessionKey());
    }
  }

  private sessionKey(): string {
    return `quiz-teammates:player:${this.code()}`;
  }

  private showMessage(message: string, error = false): void {
    this.message.set(message);
    this.messageIsError.set(error);
  }

  private normalize(value: string): string {
    return value.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  private visibleClueCount(state: GameState, clueCount: number): number {
    if (clueCount <= 1 || !state.questionStartedAt || !state.questionEndsAt) return Math.max(1, clueCount);
    const started = new Date(state.questionStartedAt).getTime();
    const ends = new Date(state.questionEndsAt).getTime();
    const interval = Math.max(1, ends - started) / clueCount;
    return Math.max(1, Math.min(clueCount, Math.floor(Math.max(0, this.now() - started) / interval) + 1));
  }
}

function isLikelyImage(value: string): boolean {
  const source = value.trim();
  if (source.startsWith('data:image/')) return true;
  try {
    const url = new URL(source);
    return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname)
      || url.searchParams.get('alt') === 'media'
      || /(^|\.)googleusercontent\.com$|(^|\.)unsplash\.com$|(^|\.)imgur\.com$|firebasestorage\.googleapis\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}
