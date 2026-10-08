import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from './api.service';
import { questionProgress, remainingQuestionSeconds, visibleClueCount } from './clue-timing';
import { finalPlayerName, getFinalRevealState } from './final-reveal';
import { Clue, GameState, Room } from './types';
import { IconComponent } from './icon.component';
import { CopyJoinLinkComponent } from './copy-join-link.component';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [NgTemplateOutlet, DecimalPipe, IconComponent, RouterLink, CopyJoinLinkComponent],
  templateUrl: './room.component.html',
})
export class RoomComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChildren('hostMedia') hostMediaElements!: QueryList<ElementRef<HTMLMediaElement>>;
  room = signal<Room | undefined>(undefined);
  loading = signal(true);
  error = signal('');
  message = signal('');
  messageIsError = signal(false);
  commandPending = signal(false);
  pausePending = signal(false);
  autoplayBlocked = signal(false);
  now = signal(Date.now());
  selectedClueIndex = signal<number | null>(null);
  readonly podiumOrder = [1, 0, 2];
  readonly confettiPieces = Array.from({ length: 12 }, (_, i) => i);
  finalAnimationOffset = computed(() => {
    const started = this.api.gameState()?.finalRevealStartedAt;
    const timestamp = Date.parse(started ?? '');
    return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 1000) : 20;
  });
  answerMarkers = computed(() => Array.from({ length: this.api.gameState()?.playerCount ?? 0 }, (_, i) => i < (this.api.gameState()?.answerCount ?? 0)));
  finalReveal = computed(() => getFinalRevealState(this.api.gameState(), this.now()));
  finalRevealMessage = computed(() => this.finalReveal().message);
  remainingSeconds = computed(() => remainingQuestionSeconds(this.api.gameState(), this.now()));
  timerProgress = computed(() => questionProgress(this.api.gameState(), this.now()));
  podiumPlayers = computed(() => this.api.gameState()?.leaderboard.slice(0, 3) ?? []);
  leftLobbyPlayers = computed(() => (this.api.gameState()?.players ?? []).filter((_, index) => index % 2 === 0));
  rightLobbyPlayers = computed(() => (this.api.gameState()?.players ?? []).filter((_, index) => index % 2 === 1));
  leftLobbyReactions = computed(() => this.api.lobbyReactions().filter((reaction) => reaction.side === 'left'));
  rightLobbyReactions = computed(() => this.api.lobbyReactions().filter((reaction) => reaction.side === 'right'));
  private timerId: number | undefined;
  private clueRevision = '';
  private readonly destroyRef = inject(DestroyRef);
  private hostRequest = 0;
  private hostAbort?: AbortController;
  private destroyed = false;
  private pausedMedia = new Set<HTMLMediaElement>();

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {
    effect(() => {
      const paused = !!this.api.gameState()?.questionPausedAt;
      untracked(() => this.syncMediaPause(paused));
    });
    effect(() => {
      const state = this.api.gameState();
      if (!state) return;
      const revision = state.currentQuestionIndex + ':' + this.visibleClues(state).length;
      if (revision !== this.clueRevision) {
        this.clueRevision = revision;
        this.selectedClueIndex.set(null);
      }
    }, { allowSignalWrites: true });
    effect(() => {
      const room = this.room();
      const ready = this.api.authReady();
      const admin = this.api.adminUser();
      const connected = this.api.connected();
      this.hostRequest++;
      this.hostAbort?.abort();
      if (!room || !ready) return;
      if (!admin) {
        this.api.leaveHostRoom(room.code);
        this.loading.set(false);
        this.error.set('Connectez-vous avec le compte qui a créé ce quiz pour reprendre la partie.');
        return;
      }
      if (!connected) {
        this.loading.set(true);
        return;
      }
      untracked(() => void this.connectHost());
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.api.hostRoomMeta.set(undefined);
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();
    this.api.getRoom(code).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (room) => {
        this.room.set(room);
        this.api.hostRoomMeta.set(room);
        this.api.gameState.set(room.gameState);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Ce salon est introuvable ou a été supprimé.');
      },
    });
    this.timerId = window.setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.hostRequest++;
    this.hostAbort?.abort();
    const code = this.room()?.code;
    if (code) this.api.leaveHostRoom(code);
    if (this.timerId) window.clearInterval(this.timerId);
    this.api.hostRoomMeta.set(undefined);
    this.api.lobbyReactions.set([]);
  }

  async connectHost(): Promise<void> {
    const code = this.room()?.code;
    if (!code || !this.api.adminUser() || !this.api.connected()) return;
    const request = ++this.hostRequest;
    this.hostAbort?.abort();
    this.hostAbort = new AbortController();
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await this.api.hostRoom(code, this.hostAbort.signal);
      if (this.destroyed || request !== this.hostRequest) return;
      if (!response.ok) {
        this.error.set(response.error ?? "Vous n'êtes pas autorisé à piloter ce salon.");
      } else if (response.gameState) {
        this.api.gameState.set(response.gameState);
      }
    } catch {
      if (!this.destroyed && request === this.hostRequest) {
        this.error.set('Impossible de reprendre le salon. Vérifiez votre connexion et réessayez.');
      }
    } finally {
      if (!this.destroyed && request === this.hostRequest) this.loading.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.hostMediaElements.changes.subscribe(() => {
      void this.playCurrentMedia();
    });
    void this.playCurrentMedia();
  }

  async startGame(): Promise<void> {
    const code = this.room()?.code;
    if (!code || this.commandPending()) return;
    if ((this.api.gameState()?.playerCount ?? 0) === 0 && !window.confirm('Lancer le quiz sans aucun joueur ?')) return;
    this.commandPending.set(true);
    const response = await this.api.startGame(code);
    this.commandPending.set(false);
    if (!response.ok) this.showMessage(response.error ?? 'Impossible de lancer le quiz.', true);
  }

  async nextQuestion(): Promise<void> {
    const code = this.room()?.code;
    if (!code || this.commandPending()) return;
    this.commandPending.set(true);
    const response = await this.api.nextQuestion(code);
    this.commandPending.set(false);
    if (!response.ok) this.showMessage(response.error ?? 'Impossible de passer à la question suivante.', true);
  }

  async togglePause(): Promise<void> {
    const code = this.room()?.code;
    const state = this.api.gameState();
    if (!code || state?.status !== 'question' || this.pausePending() || !this.api.connected()) return;
    this.pausePending.set(true);
    try {
      const result = await this.api.setQuestionPaused(code, state.currentQuestionIndex, !state.questionPausedAt);
      if (!result.ok) this.showMessage(result.error ?? 'Impossible de modifier la pause.', true);
      else this.showMessage('');
    } catch {
      this.showMessage("Le serveur n'a pas confirmé la commande. Vérifiez l'état de la partie avant de réessayer.", true);
    } finally { this.pausePending.set(false); }
  }

  async retryMediaPlayback(): Promise<void> {
    await this.playCurrentMedia();
  }

  answerCorrectRate(stats: { total: number; correct: number }): number {
    return stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  }

  answerStatWidth(value: number, total: number): number {
    return total > 0 ? Math.max(4, Math.min(100, (value / total) * 100)) : 0;
  }

  finalPlayerName(player: { id: string; nickname: string; realNickname?: string }): string {
    return finalPlayerName(this.api.gameState(), this.finalReveal(), player);
  }

  isFinalNameRevealed(player: { id: string }): boolean {
    return this.finalReveal().revealedPlayerIds.has(player.id);
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, visibleClueCount(state, this.now(), clues.length));
  }

  currentClue(state: GameState): Clue | undefined {
    return this.visibleClues(state)[this.currentClueIndex(state)];
  }

  currentClueIndex(state: GameState): number {
    const last = this.visibleClues(state).length - 1;
    return Math.min(last, this.selectedClueIndex() ?? last);
  }

  clueLabel(clue: Clue): string {
    if (clue.kind === 'image' || this.isImageUrl(clue.content)) return 'Image';
    return clue.kind === 'audio' ? 'Son' : clue.kind === 'video' ? 'Vidéo' : 'Texte';
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { this.showMessage('Le plein écran est indisponible sur ce navigateur.', true); }
  }

  isImageUrl(value: string): boolean {
    return isLikelyImage(value);
  }

  private showMessage(message: string, error = false): void {
    this.message.set(message);
    this.messageIsError.set(error);
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
    this.pausedMedia.clear();
    if (this.api.gameState()?.questionPausedAt) {
      media.pause();
      this.pausedMedia.add(media);
      return;
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

  private syncMediaPause(paused: boolean): void {
    if (paused) {
      for (const element of this.hostMediaElements?.toArray() ?? []) {
        const media = element.nativeElement;
        if (!media.paused && !media.ended) { this.pausedMedia.add(media); media.pause(); }
      }
    } else {
      for (const media of this.pausedMedia) {
        if (media.isConnected) void media.play().catch(() => this.autoplayBlocked.set(true));
      }
      this.pausedMedia.clear();
    }
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
