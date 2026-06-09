import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from './api.service';
import { Clue, GameState, Room } from './types';

@Component({
  selector: 'app-join',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <main class="page player-page grid">
      <section class="panel grid">
        <h1>Participation</h1>
        <p class="muted">Code salon {{ code() }}</p>

        @if (!playerId()) {
          <div class="row">
            <label>
              Pseudo
              <input [(ngModel)]="nickname" autocomplete="nickname">
            </label>
            <button type="button" (click)="join()">Rejoindre</button>
          </div>
        }

        @if (api.gameState(); as state) {
          @if (state.status === 'lobby') {
            <article class="item">
              <h2>En attente du lancement</h2>
              <p>L'animateur lancera le quiz quand les joueurs seront prets.</p>
            </article>
          } @else if (state.status === 'question' && state.activeQuestion) {
            <article class="item grid">
              <p class="muted">Question {{ state.currentQuestionIndex + 1 }} / {{ state.totalQuestions }}</p>
              <h2>{{ state.activeQuestion.prompt }}</h2>
              <p>Temps restant : <strong>{{ remainingSeconds() }}s</strong></p>

              <div class="clue-list">
                @for (clue of visibleClues(state); track clue.id || clue.content) {
                  <div class="clue-chip">
                    <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue }" />
                  </div>
                }
              </div>

              <div class="answer-options">
                @for (option of state.activeQuestion.options; track option.id) {
                  <button
                    type="button"
                    class="answer-option"
                    [disabled]="!canAnswer() || answeredQuestionIndex() === state.currentQuestionIndex"
                    (click)="answer(option.id)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
            </article>
          } @else if (state.status === 'reveal' && state.activeQuestion) {
            <article class="item result-card grid" [class.missed]="!api.playerResult()?.isCorrect">
              <div class="burst" aria-hidden="true"></div>
              <p class="result-kicker">{{ api.playerResult()?.isCorrect ? 'Bonne reponse' : 'Dommage' }}</p>
              <h2>{{ api.playerResult()?.isCorrect ? '+' + api.playerResult()?.points + ' points' : '0 point' }}</h2>
              <div class="result-stats">
                <p>
                  Total
                  <strong>{{ api.playerResult()?.totalScore ?? 0 }}</strong>
                </p>
                <p>
                  Position
                  <strong>{{ api.playerResult()?.rank || '-' }}</strong>
                  / {{ api.playerResult()?.totalPlayers || state.playerCount }}
                </p>
              </div>
              <button type="button" class="answer-option correct">
                {{ state.activeQuestion.correctOption?.label }}
              </button>
            </article>
          } @else if (state.status === 'finished') {
            <article class="item grid">
              <h2>Quiz termine</h2>
              <ol class="leaderboard">
                @for (player of state.leaderboard; track player.id; let index = $index) {
                  <li>
                    <strong>{{ index + 1 }}</strong>
                    <span>{{ player.nickname }}</span>
                    <strong>{{ player.score }}</strong>
                  </li>
                }
              </ol>
            </article>
          }
        }

        <p class="answer-state">{{ message() }}</p>
      </section>
    </main>

    <ng-template #clueTpl let-clue="clue">
      @if (isImageUrl(clue.content)) {
        <figure class="clue-figure">
          <img [src]="clue.content" alt="Indice image">
        </figure>
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
  message = signal('');
  answeredQuestionIndex = signal<number | undefined>(undefined);
  canAnswer = computed(() => Boolean(this.playerId()) && this.api.gameState()?.status === 'question');
  now = signal(Date.now());
  remainingSeconds = computed(() => {
    const endsAt = this.api.gameState()?.questionEndsAt;
    if (!endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(endsAt).getTime() - this.now()) / 1000));
  });
  nickname = '';
  private timerId: number | undefined;

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code') ?? '';
    this.code.set(code);
    this.api.getRoom(code).subscribe((room) => {
      this.room.set(room);
      this.api.leaderboard.set(room.leaderboard ?? []);
      this.api.gameState.set(room.gameState);
    });
    this.timerId = window.setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnDestroy(): void {
    if (this.timerId) window.clearInterval(this.timerId);
  }

  async join(): Promise<void> {
    const response = await this.api.joinRoom(this.code(), this.nickname);
    if (!response.ok || !response.playerId) {
      this.message.set(response.error ?? 'Impossible de rejoindre le salon.');
      return;
    }
    this.playerId.set(response.playerId);
    if (response.gameState) this.api.gameState.set(response.gameState);
    this.message.set('Vous etes inscrit.');
  }

  async answer(optionId: string): Promise<void> {
    const question = this.api.gameState()?.activeQuestion;
    const questionIndex = this.api.gameState()?.currentQuestionIndex;
    if (!question || questionIndex === undefined) return;

    const response = await this.api.submitAnswer({
      code: this.code(),
      playerId: this.playerId(),
      roundId: question.roundId,
      targetType: question.targetType,
      targetId: question.targetId,
      optionId,
    });
    if (!response.ok) {
      this.message.set(response.error ?? 'Reponse refusee.');
      return;
    }
    this.answeredQuestionIndex.set(questionIndex);
    this.message.set('Reponse envoyee.');
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, this.visibleClueCount(state, clues.length));
  }

  isImageUrl(value: string): boolean {
    return /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(value.trim());
  }

  private visibleClueCount(state: GameState, clueCount: number): number {
    if (clueCount <= 1 || !state.questionStartedAt || !state.questionEndsAt) return Math.max(1, clueCount);
    const started = new Date(state.questionStartedAt).getTime();
    const ends = new Date(state.questionEndsAt).getTime();
    const duration = Math.max(1, ends - started);
    const interval = duration / clueCount;
    const elapsed = Math.max(0, this.now() - started);
    return Math.max(1, Math.min(clueCount, Math.floor(elapsed / interval) + 1));
  }
}
