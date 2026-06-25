import { NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  effect,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from './api.service';
import { Clue, GameState, Room } from './types';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @if (loading()) {
      <main class="page"><p class="loading-state">Chargement du salon…</p></main>
    } @else if (error()) {
      <main class="page">
        <section class="empty-state" role="alert">
          <h1>Salon inaccessible</h1>
          <p>{{ error() }}</p>
          <a class="button-link secondary" href="/">Retour à l'accueil</a>
        </section>
      </main>
    } @else if (api.gameState()?.status === 'finished') {
      <main class="podium-screen">
        <h1>Classement final</h1>
        @if (finalRevealMessage()) {
          <p class="final-reveal-message">{{ finalRevealMessage() }}</p>
        }
        @if (podiumPlayers(); as podium) {
          <section class="final-podium" aria-label="Podium final">
            @if (podium[1]) {
              <article class="podium-place second">
                <p [class.name-revealed]="isFinalNameRevealed(podium[1])">{{ finalPlayerName(podium[1]) }}</p>
                <div class="medal">2</div>
                <strong>{{ podium[1].score }}</strong>
              </article>
            }
            @if (podium[0]) {
              <article class="podium-place first">
                <p [class.name-revealed]="isFinalNameRevealed(podium[0])">{{ finalPlayerName(podium[0]) }}</p>
                <div class="medal">1</div>
                <strong>{{ podium[0].score }}</strong>
              </article>
            }
            @if (podium[2]) {
              <article class="podium-place third">
                <p [class.name-revealed]="isFinalNameRevealed(podium[2])">{{ finalPlayerName(podium[2]) }}</p>
                <div class="medal">3</div>
                <strong>{{ podium[2].score }}</strong>
              </article>
            }
          </section>
        }
        <section class="final-ranking">
          <h2>Classement complet</h2>
          <ol class="leaderboard">
            @for (player of api.gameState()?.leaderboard || []; track player.id; let index = $index) {
              <li>
                <strong>{{ index + 1 }}</strong>
                <span [class.name-revealed]="isFinalNameRevealed(player)">{{ finalPlayerName(player) }}</span>
                <strong>{{ player.score }}</strong>
              </li>
            }
          </ol>
        </section>
      </main>
    } @else {
      <main class="page host-page">
        <section class="panel grid host-stage">
          @if (api.gameState(); as state) {
            <article class="host-question grid">
              @if (state.status === 'lobby') {
                <div class="empty-state compact">
                  <h2>Prêt à lancer le quiz</h2>
                  <p>Les joueurs peuvent rejoindre avec le code ou le QR code.</p>
                  <button type="button" (click)="startGame()" [disabled]="commandPending()">
                    {{ commandPending() ? 'Lancement…' : 'Lancer le quiz' }}
                  </button>
                </div>
              } @else if (state.status === 'question' && state.activeQuestion) {
                <div class="question-meta">
                  <span>Question {{ state.currentQuestionIndex + 1 }} / {{ state.totalQuestions }}</span>
                  <div
                    class="timer-ring"
                    [style.--progress]="timerProgress() + '%'"
                    [class.urgent]="remainingSeconds() <= 5"
                  >
                    {{ remainingSeconds() }}
                  </div>
                </div>
                <h2>{{ state.activeQuestion.prompt }}</h2>
                <p class="answer-progress">
                  {{ state.answerCount }} réponse(s) sur {{ state.playerCount }}
                  <span><i [style.width.%]="answerProgress(state)"></i></span>
                </p>

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
                  @if (currentClue(state); as clue) {
                    <div class="current-clue">
                      <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue, autoplay: true }" />
                    </div>
                  }
                  @if (previousClues(state).length > 0) {
                    <div class="clue-list">
                      @for (clue of previousClues(state); track clue.id || clue.content) {
                        <div class="clue-chip">
                          <ng-container *ngTemplateOutlet="clueTpl; context: { clue: clue, autoplay: false }" />
                        </div>
                      }
                    </div>
                  }
                }
              } @else if (state.status === 'reveal' && state.activeQuestion) {
                <div class="reveal-heading">
                  <p class="eyebrow">Réponse révélée</p>
                  <h2>{{ state.activeQuestion.correctOption?.label || 'Réponse indisponible' }}</h2>
                </div>
                <ol class="leaderboard podium">
                  @for (player of state.topLeaderboard; track player.id; let index = $index) {
                    <li>
                      <strong>{{ index + 1 }}</strong>
                      <span>{{ player.nickname }}</span>
                      <strong>{{ player.score }}</strong>
                    </li>
                  }
                </ol>
                <button type="button" (click)="nextQuestion()" [disabled]="commandPending()">
                  {{ commandPending() ? 'Chargement…' : 'Question suivante' }}
                </button>
              }
            </article>
          }
          @if (message()) {
            <p class="status-message" [class.error]="messageIsError()" role="status">{{ message() }}</p>
          }
        </section>

      </main>
    }

    <ng-template #clueTpl let-clue="clue" let-autoplay="autoplay">
      @if (clue.kind === 'image' || isImageUrl(clue.content)) {
        <figure class="clue-figure">
          <img [src]="clue.content" alt="Indice visuel">
        </figure>
      } @else if (clue.kind === 'audio') {
        <div class="clue-media audio-clue">
          <span>Indice sonore</span>
          <audio
            #hostMedia
            [src]="clue.content"
            [autoplay]="autoplay"
            [attr.data-autoplay]="autoplay ? 'true' : null"
            controls
            preload="auto"
          ></audio>
          @if (autoplay && autoplayBlocked()) {
            <button type="button" (click)="retryMediaPlayback()">Lancer l'indice sonore</button>
          }
        </div>
      } @else if (clue.kind === 'video') {
        <div class="clue-media">
          <video
            #hostMedia
            [src]="clue.content"
            [autoplay]="autoplay"
            [attr.data-autoplay]="autoplay ? 'true' : null"
            controls
            preload="auto"
            playsinline
          ></video>
          @if (autoplay && autoplayBlocked()) {
            <button type="button" (click)="retryMediaPlayback()">Lancer la vidéo</button>
          }
        </div>
      } @else {
        <p><strong>Indice :</strong> {{ clue.content }}</p>
      }
    </ng-template>
  `,
})
export class RoomComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChildren('hostMedia') hostMediaElements!: QueryList<ElementRef<HTMLMediaElement>>;
  room = signal<Room | undefined>(undefined);
  loading = signal(true);
  error = signal('');
  message = signal('');
  messageIsError = signal(false);
  commandPending = signal(false);
  autoplayBlocked = signal(false);
  revealedFinalPlayerIds = signal<Set<string>>(new Set());
  finalRevealMessage = signal('');
  now = signal(Date.now());
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
  podiumPlayers = computed(() => this.api.gameState()?.leaderboard.slice(0, 3) ?? []);
  private timerId: number | undefined;
  private finalRevealTimers: number[] = [];
  private finalRevealStarted = false;

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {
    effect(() => {
      const state = this.api.gameState();
      if (state?.status !== 'finished') {
        this.resetFinalReveal();
        return;
      }
      if (!state.hidePlayerNames) {
        this.clearFinalRevealTimers();
        this.revealedFinalPlayerIds.set(new Set(state.leaderboard.map((player) => player.id)));
        this.finalRevealMessage.set('');
        return;
      }
      if (!this.finalRevealStarted) this.startFinalReveal(state.leaderboard);
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.api.hostRoomMeta.set(undefined);
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();
    this.api.getRoom(code).subscribe({
      next: (room) => {
        this.room.set(room);
        this.api.hostRoomMeta.set(room);
        this.api.gameState.set(room.gameState);
        void this.api.hostRoom(code).then((response) => {
          this.loading.set(false);
          if (!response.ok) {
            this.error.set(response.error ?? "Vous n'êtes pas autorisé à piloter ce salon.");
            return;
          }
          if (response.gameState) this.api.gameState.set(response.gameState);
        });
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Ce salon est introuvable ou a été supprimé.');
      },
    });
    this.timerId = window.setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnDestroy(): void {
    if (this.timerId) window.clearInterval(this.timerId);
    this.clearFinalRevealTimers();
    this.api.hostRoomMeta.set(undefined);
  }

  ngAfterViewInit(): void {
    this.hostMediaElements.changes.subscribe(() => {
      void this.playCurrentMedia();
    });
    void this.playCurrentMedia();
  }

  async startGame(): Promise<void> {
    const code = this.room()?.code;
    if (!code) return;
    if ((this.api.gameState()?.playerCount ?? 0) === 0 && !window.confirm('Lancer le quiz sans aucun joueur ?')) return;
    this.commandPending.set(true);
    const response = await this.api.startGame(code);
    this.commandPending.set(false);
    if (!response.ok) this.showMessage(response.error ?? 'Impossible de lancer le quiz.', true);
  }

  async nextQuestion(): Promise<void> {
    const code = this.room()?.code;
    if (!code) return;
    this.commandPending.set(true);
    const response = await this.api.nextQuestion(code);
    this.commandPending.set(false);
    if (!response.ok) this.showMessage(response.error ?? 'Impossible de passer à la question suivante.', true);
  }

  async retryMediaPlayback(): Promise<void> {
    await this.playCurrentMedia();
  }

  answerProgress(state: GameState): number {
    return state.playerCount > 0 ? Math.min(100, (state.answerCount / state.playerCount) * 100) : 0;
  }

  finalPlayerName(player: { id: string; nickname: string; realNickname?: string }): string {
    if (!this.api.gameState()?.hidePlayerNames || this.revealedFinalPlayerIds().has(player.id)) {
      return player.realNickname || player.nickname;
    }
    return player.nickname;
  }

  isFinalNameRevealed(player: { id: string }): boolean {
    return this.revealedFinalPlayerIds().has(player.id);
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, this.visibleClueCount(state, clues.length));
  }

  previousClues(state: GameState): Clue[] {
    return this.visibleClues(state).slice(0, -1);
  }

  currentClue(state: GameState): Clue | undefined {
    return this.visibleClues(state).at(-1);
  }

  isImageUrl(value: string): boolean {
    return isLikelyImage(value);
  }

  private showMessage(message: string, error = false): void {
    this.message.set(message);
    this.messageIsError.set(error);
  }

  private startFinalReveal(leaderboard: Array<{ id: string }>): void {
    this.finalRevealStarted = true;
    this.revealedFinalPlayerIds.set(new Set());
    this.finalRevealMessage.set('Découvrons les participants…');

    this.scheduleFinalReveal(700, leaderboard.slice(3).map((player) => player.id));
    const podiumStart = 1800;
    if (leaderboard[2]) {
      this.finalRevealTimers.push(window.setTimeout(() => {
        this.finalRevealMessage.set('Troisième place');
        this.revealFinalPlayers([leaderboard[2].id]);
      }, podiumStart));
    }
    if (leaderboard[1]) {
      this.finalRevealTimers.push(window.setTimeout(() => {
        this.finalRevealMessage.set('Deuxième place');
        this.revealFinalPlayers([leaderboard[1].id]);
      }, podiumStart + 1600));
    }
    if (leaderboard[0]) {
      this.finalRevealTimers.push(window.setTimeout(() => {
        this.finalRevealMessage.set('Et le gagnant est…');
        this.revealFinalPlayers([leaderboard[0].id]);
      }, podiumStart + 3400));
    }
    this.finalRevealTimers.push(window.setTimeout(() => {
      this.finalRevealMessage.set('');
    }, podiumStart + 5000));
  }

  private scheduleFinalReveal(delay: number, playerIds: string[]): void {
    if (!playerIds.length) return;
    this.finalRevealTimers.push(window.setTimeout(() => this.revealFinalPlayers(playerIds), delay));
  }

  private revealFinalPlayers(playerIds: string[]): void {
    this.revealedFinalPlayerIds.update((current) => new Set([...current, ...playerIds]));
  }

  private resetFinalReveal(): void {
    this.clearFinalRevealTimers();
    this.finalRevealStarted = false;
    this.revealedFinalPlayerIds.set(new Set());
    this.finalRevealMessage.set('');
  }

  private clearFinalRevealTimers(): void {
    for (const timer of this.finalRevealTimers) window.clearTimeout(timer);
    this.finalRevealTimers = [];
  }

  private async playCurrentMedia(): Promise<void> {
    const media = this.hostMediaElements
      ?.toArray()
      .map((element) => element.nativeElement)
      .find((element) => element.dataset['autoplay'] === 'true');
    if (!media) return;
    for (const element of this.hostMediaElements.toArray()) {
      if (element.nativeElement !== media) element.nativeElement.pause();
    }
    try {
      media.currentTime = 0;
      await media.play();
      this.autoplayBlocked.set(false);
    } catch {
      this.autoplayBlocked.set(true);
      this.showMessage('Le navigateur a bloqué la lecture automatique. Appuyez sur Lecture pour lancer l’indice.', true);
    }
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
