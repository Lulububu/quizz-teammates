import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from './api.service';
import { AnswerSearchComponent } from './answer-search.component';
import { finalPlayerName, getFinalRevealState } from './final-reveal';
import { visibleClueCount } from './clue-timing';
import { Clue, GameState, Room } from './types';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-join',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, AnswerSearchComponent, DecimalPipe, IconComponent],
  templateUrl: './join.component.html',
})
export class JoinComponent implements OnInit, OnDestroy {
  code = signal('');
  room = signal<Room | undefined>(undefined);
  playerId = signal('');
  playerAvatar = signal('');
  totalScore = signal(0);
  loading = signal(true);
  joining = signal(false);
  roomError = signal('');
  message = signal('');
  messageIsError = signal(false);
  sendingAnswer = signal(false);
  reactionPending = signal(false);
  answeredQuestionIndex = signal<number | undefined>(undefined);
  selectedAnswer = signal('');
  selectedAutocompleteAnswer = signal('');
  now = signal(Date.now());
  finalReveal = computed(() => getFinalRevealState(this.api.gameState(), this.now()));
  canAnswer = computed(
    () => Boolean(this.playerId()) && this.api.gameState()?.status === 'question'
      && !this.sendingAnswer() && this.answeredQuestionIndex() !== this.api.gameState()?.currentQuestionIndex
      && this.remainingSeconds() > 0,
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
  nickname = '';
  reactionChoices = randomReactionChoices();
  private timerId: number | undefined;
  private currentQuestionIndex: number | undefined;

  constructor(
    public api: ApiService,
    private route: ActivatedRoute,
  ) {
    effect(() => {
      const result = this.api.playerResult();
      if (result) this.totalScore.set(result.totalScore);
    }, { allowSignalWrites: true });
    effect(() => {
      const index = this.api.gameState()?.currentQuestionIndex;
      if (index !== undefined && index !== this.currentQuestionIndex) {
        this.currentQuestionIndex = index;
        this.selectedAutocompleteAnswer.set('');
        this.selectedAnswer.set('');
        this.sendingAnswer.set(false);
        this.answeredQuestionIndex.set(undefined);
        this.message.set('');
        this.messageIsError.set(false);
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
    this.api.playerResult.set(undefined);
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
    this.playerAvatar.set(response.player?.avatar ?? '');
    this.totalScore.set(response.player?.score ?? 0);
    sessionStorage.setItem(this.sessionKey(), JSON.stringify({ playerId: response.playerId, nickname: this.nickname.trim() }));
    if (response.gameState) this.api.gameState.set(response.gameState);
    this.showMessage('Vous êtes inscrit.');
  }

  async answer(optionId: string, label: string): Promise<void> {
    if (!this.canAnswer()) return;
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
      if (this.api.gameState()?.currentQuestionIndex !== questionIndex) return;
      if (!response.ok) {
        this.selectedAnswer.set('');
        this.showMessage(response.error ?? 'Réponse refusée.', true);
        return;
      }
      this.answeredQuestionIndex.set(questionIndex);
      this.showMessage('Réponse envoyée et enregistrée.');
    } catch {
      if (this.api.gameState()?.currentQuestionIndex !== questionIndex) return;
      this.selectedAnswer.set('');
      this.showMessage("La réponse n'a pas pu être envoyée. Réessayez.", true);
    } finally {
      if (this.api.gameState()?.currentQuestionIndex === questionIndex) this.sendingAnswer.set(false);
    }
  }

  async sendReaction(emoji: string): Promise<void> {
    if (!this.playerId() || this.reactionPending()) return;
    this.reactionPending.set(true);
    try {
      await this.api.sendLobbyReaction(this.code(), this.playerId(), emoji);
    } finally {
      window.setTimeout(() => this.reactionPending.set(false), 500);
    }
  }

  async answerTextValue(): Promise<void> {
    if (!this.canAnswer()) return;
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
      if (this.api.gameState()?.currentQuestionIndex !== questionIndex) return;
      if (!response.ok) {
        this.selectedAnswer.set('');
        this.showMessage(response.error ?? 'Réponse refusée.', true);
        return;
      }
      this.answeredQuestionIndex.set(questionIndex);
      this.showMessage('Réponse envoyée et enregistrée.');
    } catch {
      if (this.api.gameState()?.currentQuestionIndex !== questionIndex) return;
      this.selectedAnswer.set('');
      this.showMessage("La réponse n'a pas pu être envoyée. Réessayez.", true);
    } finally {
      if (this.api.gameState()?.currentQuestionIndex === questionIndex) this.sendingAnswer.set(false);
    }
  }

  visibleClues(state: GameState): Clue[] {
    const clues = state.activeQuestion?.clues ?? [];
    if (state.status !== 'question') return clues;
    return clues.slice(0, visibleClueCount(state, this.now(), clues.length));
  }

  isImageUrl(value: string): boolean {
    return isLikelyImage(value);
  }

  finalPlayerName(player: { id: string; nickname: string; realNickname?: string; score: number }): string {
    return finalPlayerName(this.api.gameState(), this.finalReveal(), player);
  }

  isFinalNameRevealed(player: { id: string }): boolean {
    return this.finalReveal().revealedPlayerIds.has(player.id);
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
      this.playerAvatar.set(response.player?.avatar ?? '');
      this.totalScore.set(response.player?.score ?? 0);
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

function randomReactionChoices(): string[] {
  const reactions = ['👏', '🔥', '🎉', '❤️', '😂', '🤩', '🚀', '💡', '😎', '🥳', '⭐', '🙌'];
  return reactions
    .map((emoji) => ({ emoji, order: Math.random() }))
    .sort((left, right) => left.order - right.order)
    .slice(0, 5)
    .map(({ emoji }) => emoji);
}
