import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from './api.service';
import { Clue, GameState, Room } from './types';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @if (api.gameState()?.status === 'finished') {
      <main class="podium-screen">
        <h1>Classement final</h1>
        @if (podiumPlayers(); as podium) {
          <section class="final-podium" aria-label="Podium final">
            @if (podium[1]) {
              <article class="podium-place second">
                <p>{{ podium[1].nickname }}</p>
                <div class="medal">2</div>
                <strong>{{ podium[1].score }}</strong>
              </article>
            }
            @if (podium[0]) {
              <article class="podium-place first">
                <p>{{ podium[0].nickname }}</p>
                <div class="medal">1</div>
                <strong>{{ podium[0].score }}</strong>
              </article>
            }
            @if (podium[2]) {
              <article class="podium-place third">
                <p>{{ podium[2].nickname }}</p>
                <div class="medal">3</div>
                <strong>{{ podium[2].score }}</strong>
              </article>
            }
          </section>
        }
      </main>
    } @else {
      <main class="page grid two-columns">
        <section class="panel grid">
          <h1>Salon</h1>
          @if (room(); as activeRoom) {
            <div class="join-card" [class.compact]="api.gameState()?.status !== 'lobby'">
              <div class="code">{{ activeRoom.code }}</div>
              @if (activeRoom.qrCodeDataUrl) {
                <img class="qr" [src]="activeRoom.qrCodeDataUrl" alt="QR code pour rejoindre le salon">
              }
            </div>
            <p>Les joueurs peuvent rejoindre avec le code ou le QR code.</p>
          }

          @if (api.gameState(); as state) {
            <article class="item grid">
              <h2>Animation</h2>
              @if (state.status === 'lobby') {
                <p>Les joueurs peuvent rejoindre la partie. Lancez le quiz quand tout le monde est pret.</p>
                <button type="button" (click)="startGame()">Lancer le quiz</button>
              } @else if (state.status === 'question' && state.activeQuestion) {
                <p class="muted">Question {{ state.currentQuestionIndex + 1 }} / {{ state.totalQuestions }}</p>
                <h3>{{ state.activeQuestion.prompt }}</h3>
                <p>
                  Temps restant : <strong>{{ remainingSeconds() }}s</strong>
                  · Reponses : <strong>{{ state.answerCount }}</strong> / {{ state.playerCount }}
                </p>
                @if (currentClue(state); as clue) {
                  <div class="current-clue">
                    <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue }" />
                  </div>
                }
                <div class="clue-list">
                  @for (clue of visibleClues(state); track clue.id || clue.content) {
                    <div class="clue-chip">
                      <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue }" />
                    </div>
                  }
                </div>
              } @else if (state.status === 'reveal' && state.activeQuestion) {
                <p class="muted">Reponse revelee</p>
                <h3>{{ state.activeQuestion.correctOption?.label }}</h3>
                <ol class="leaderboard podium">
                  @for (player of state.topLeaderboard; track player.id; let index = $index) {
                    <li>
                      <strong>{{ index + 1 }}</strong>
                      <span>{{ player.nickname }}</span>
                      <strong>{{ player.score }}</strong>
                    </li>
                  }
                </ol>
                <button type="button" (click)="nextQuestion()">Question suivante</button>
              }
            </article>
          }
        </section>

        <aside class="panel">
          <h2>Participants</h2>
          <p>{{ api.gameState()?.playerCount || 0 }} joueur(s) connecte(s)</p>
          <p class="muted">Le top 5 apparait a chaque revelation.</p>
        </aside>
      </main>
    }

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
export class RoomComponent implements OnInit, OnDestroy {
  room = signal<Room | undefined>(undefined);
  now = signal(Date.now());
  remainingSeconds = computed(() => {
    const endsAt = this.api.gameState()?.questionEndsAt;
    if (!endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(endsAt).getTime() - this.now()) / 1000));
  });
  podiumPlayers = computed(() => this.api.gameState()?.leaderboard.slice(0, 3) ?? []);
  private timerId: number | undefined;

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code') ?? '';
    this.api.getRoom(code).subscribe((room) => {
      this.room.set(room);
      this.api.leaderboard.set(room.leaderboard ?? []);
      this.api.gameState.set(room.gameState);
      void this.api.hostRoom(code).then((response) => {
        if (response.gameState) this.api.gameState.set(response.gameState);
      });
    });
    this.timerId = window.setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnDestroy(): void {
    if (this.timerId) window.clearInterval(this.timerId);
  }

  startGame(): void {
    const code = this.room()?.code;
    if (code) void this.api.startGame(code);
  }

  nextQuestion(): void {
    const code = this.room()?.code;
    if (code) void this.api.nextQuestion(code);
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, this.visibleClueCount(state, clues.length));
  }

  currentClue(state: GameState): Clue | undefined {
    const clues = this.visibleClues(state);
    return clues[clues.length - 1];
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
