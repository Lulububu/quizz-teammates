import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { AnswerSearchComponent } from './answer-search.component';
import { FieldErrorComponent } from './field-error.component';
import { ActiveRoomSummary, AnswerDictionary, Quiz } from './types';
import { IconComponent } from './icon.component';

type AdminView = 'quizzes' | 'active-rooms' | 'editor' | 'dictionaries';
type DraftClueKind = 'text' | 'image' | 'audio' | 'video';
type DraftAnswerTarget = {
  answerMode: 'choices' | 'autocomplete';
  dictionaryId: string;
  options: string[];
  correctOptionIndex: number;
  correctAnswer: string;
};
type DraftWork = DraftAnswerTarget & {
  clues: Array<{ kind: DraftClueKind; content: string }>;
};
type DraftRound = {
  title: string;
  person: DraftAnswerTarget & { name: string };
  works: DraftWork[];
};
type DraftQuiz = {
  title: string;
  description: string;
  sequenceMode: 'rounds' | 'works-first';
  hidePlayerNames: boolean;
  rounds: DraftRound[];
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, FieldErrorComponent, AnswerSearchComponent, IconComponent, RouterLink, DatePipe],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  @ViewChild('questionList') private questionList?: ElementRef<HTMLElement>;
  @ViewChild('editorContent') private editorContent?: ElementRef<HTMLElement>;
  @ViewChild('editorToolbar') private editorToolbar?: ElementRef<HTMLElement>;
  quizzes = signal<Quiz[]>([]);
  activeRooms = signal<ActiveRoomSummary[]>([]);
  activeRoomsLoading = signal(false);
  activeRoomsError = signal('');
  private activeRoomsRequest = 0;
  dictionaries = signal<AnswerDictionary[]>([]);
  dictionaryValues = signal<string[]>([]);
  adminView = signal<AdminView>('quizzes');
  editorTab = signal<'questions' | 'settings'>('questions');
  activeRoundIndex = signal(0);
  activeWorkIndex = signal(0);
  activeClueIndex = signal(0);
  editingPerson = signal(false);
  previewOpen = signal(false);
  mobileQuestionNavOpen = signal(false);
  private modalTrigger?: HTMLElement;
  message = signal('');
  fieldErrors = signal<Record<string, string[]>>({});
  saving = signal(false);
  launchingQuizId = signal<string | undefined>(undefined);
  dictionarySaving = signal(false);
  feedbackMessage = signal('');
  feedbackTone = signal<'success' | 'info' | 'error'>('success');
  editingQuizId = signal<string | undefined>(undefined);
  dirty = signal(false);
  uploadingClues = signal<Record<string, boolean>>({});
  hasUploadInProgress = computed(() => Object.values(this.uploadingClues()).some(Boolean));
  importModalOpen = signal(false);
  importProcessing = signal(false);
  importProgress = signal(0);
  importProgressLabel = signal('');
  importDictionaryId = signal('');
  importErrors = signal<string[]>([]);
  importErrorDetailsOpen = signal(false);
  missingDictionaryValues = signal<string[]>([]);
  addingMissingDictionaryValues = signal(false);
  editingDictionaryId = signal<string | undefined>(undefined);
  dictionaryName = signal('');
  dictionaryText = signal('');
  dictionarySearch = signal('');
  dictionaryPage = signal(0);
  dictionaryStats = computed(() => {
    const lines = this.rawDictionaryValues(this.dictionaryText());
    return { unique: new Set(lines).size, duplicates: lines.length - new Set(lines).size };
  });
  dictionaryPageCount = computed(() => Math.max(1, Math.ceil(this.filteredDictionaryValues().length / 20)));
  dictionaryPreview = computed(() => {
    const start = this.dictionaryPage() * 20;
    return this.filteredDictionaryValues().slice(start, start + 20);
  });
  publicRoomCode = '';
  draft: DraftQuiz = this.emptyQuiz();
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  private importProgressTimer: ReturnType<typeof setInterval> | undefined;

  constructor(public api: ApiService) {
    effect(() => {
      if (this.api.adminUser()) {
        this.refresh();
        this.loadDictionaries();
      } else {
        this.quizzes.set([]);
        this.dictionaries.set([]);
        this.activeRooms.set([]);
        this.activeRoomsLoading.set(false);
        this.activeRoomsRequest++;
        this.adminView.set('quizzes');
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    if (this.api.adminUser()) {
      this.refresh();
      this.loadDictionaries();
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
  }

  @HostListener('input', ['$event'])
  @HostListener('change', ['$event'])
  markEditorDirty(event: Event): void {
    if ((event.target as HTMLElement).closest('.question-preview-modal')) return;
    if (this.adminView() === 'editor') this.dirty.set(true);
  }

  joinByCode(): void {
    const code = this.publicRoomCode.trim().toUpperCase();
    if (code.length >= 4) window.location.href = `/join/${encodeURIComponent(code)}`;
  }

  switchView(view: AdminView): void {
    if (view !== 'editor' && !this.confirmDiscard()) return;
    this.adminView.set(view);
    this.message.set('');
    if (view === 'active-rooms') this.loadActiveRooms();
  }

  loadActiveRooms(): void {
    const ownerId = this.api.adminUser()?.id;
    if (!ownerId) return;
    const request = ++this.activeRoomsRequest;
    this.activeRoomsLoading.set(true);
    this.activeRoomsError.set('');
    this.api.listActiveRooms().subscribe({
      next: (rooms) => {
        if (request !== this.activeRoomsRequest || this.api.adminUser()?.id !== ownerId) return;
        this.activeRooms.set(rooms);
        this.activeRoomsLoading.set(false);
      },
      error: () => {
        if (request !== this.activeRoomsRequest || this.api.adminUser()?.id !== ownerId) return;
        this.activeRoomsLoading.set(false);
        this.activeRoomsError.set('Impossible de charger les parties en cours. Réessayez.');
      },
    });
  }

  openNewQuiz(): void {
    if (this.adminView() === 'editor' && !this.confirmDiscard()) return;
    this.resetForm();
    this.adminView.set('editor');
  }

  selectQuestion(roundIndex: number, workIndex: number | null): void {
    this.activeRoundIndex.set(roundIndex);
    this.editingPerson.set(workIndex === null);
    this.activeWorkIndex.set(workIndex ?? 0);
    this.activeClueIndex.set(0);
    this.editorTab.set('questions');
    this.mobileQuestionNavOpen.set(false);
    window.setTimeout(() => {
      const content = this.editorContent?.nativeElement;
      content?.scrollTo({ top: 0, behavior: 'instant' });
      this.scrollActiveQuestionIntoView();
      if (content && window.matchMedia('(max-width: 600px)').matches) {
        const top = content.getBoundingClientRect().top;
        const toolbarBottom = this.editorToolbar?.nativeElement.getBoundingClientRect().bottom ?? 0;
        if (top < toolbarBottom || top > window.innerHeight - 80) {
          window.scrollBy({ top: top - toolbarBottom, behavior: 'instant' });
        }
      }
    });
  }

  toggleQuestionNavigation(): void {
    this.mobileQuestionNavOpen.update(open => !open);
    if (this.mobileQuestionNavOpen()) window.setTimeout(() => {
      const toggle = this.questionList?.nativeElement.previousElementSibling;
      if (toggle) {
        const toolbarHeight = this.editorToolbar?.nativeElement.offsetHeight ?? 0;
        window.scrollTo({ top: window.scrollY + toggle.getBoundingClientRect().top - toolbarHeight - 8, behavior: 'instant' });
      }
      this.scrollActiveQuestionIntoView();
    });
  }

  private scrollActiveQuestionIntoView(): void {
    const list = this.questionList?.nativeElement;
    const selected = list?.querySelector<HTMLElement>('.question-nav-item.active');
    if (!list?.clientHeight || !selected) return;
    const bounds = list.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    // Only scroll the navigation, leaving the editor and the page in place.
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }

  activeRound(): DraftRound {
    return this.draft.rounds[Math.min(this.activeRoundIndex(), this.draft.rounds.length - 1)];
  }

  activeWork(): DraftWork | undefined {
    if (this.editingPerson()) return undefined;
    return this.activeRound().works[Math.min(this.activeWorkIndex(), this.activeRound().works.length - 1)];
  }

  activeTarget(): DraftAnswerTarget {
    return this.activeWork() ?? this.activeRound().person;
  }

  activePrefix(): string {
    return this.editingPerson()
      ? this.errorPath('rounds', this.activeRoundIndex(), 'person')
      : this.errorPath('rounds', this.activeRoundIndex(), 'works', this.activeWorkIndex());
  }

  clueSeconds(index: number, count: number): number { return Math.round(index * 40 / Math.max(1, count)); }

  changeAnswerMode(mode: 'choices' | 'autocomplete'): void {
    this.activeTarget().answerMode = mode;
    this.dirty.set(true);
  }

  questionHasErrors(prefix: string): boolean {
    return Object.keys(this.fieldErrors()).some(path => path === prefix || path.startsWith(prefix + '.'));
  }

  closeActionMenu(event: Event): void { (event.target as HTMLElement).closest('details')?.removeAttribute('open'); }

  openPreview(): void { this.previewOpen.set(true); this.focusModal(); }
  closePreview(): void { this.previewOpen.set(false); this.modalTrigger?.focus(); }

  private focusModal(): void {
    this.modalTrigger = document.activeElement as HTMLElement;
    window.setTimeout(() => document.querySelector<HTMLElement>('.modal-panel button, .modal-panel select')?.focus());
  }

  @HostListener('document:keydown', ['$event'])
  handleDialogKeys(event: KeyboardEvent): void {
    if (!this.previewOpen() && !this.importModalOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.previewOpen() ? this.closePreview() : this.closeImportModal(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.modal-panel button:not(:disabled), .modal-panel input:not(:disabled), .modal-panel select:not(:disabled), .modal-panel textarea:not(:disabled), .modal-panel a[href]')).filter(el => el.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  private revealFirstError(errors: Record<string, string[]>): void {
    const path = Object.keys(errors)[0];
    const match = path?.match(/^rounds\.(\d+)\.(?:works\.(\d+)|person)(?:\.clues\.(\d+))?/);
    if (match) {
      this.selectQuestion(Number(match[1]), match[2] === undefined ? null : Number(match[2]));
      if (match[3]) this.activeClueIndex.set(Number(match[3]));
    } else if (path) this.editorTab.set('settings');
    window.setTimeout(() => document.querySelector('.editor-main .field-error, .editor-properties .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  clueCount(): number {
    return this.draft.rounds.reduce(
      (roundTotal, round) => roundTotal + round.works.reduce((workTotal, work) => workTotal + work.clues.length, 0),
      0,
    );
  }

  addRound(): void {
    this.draft.rounds.push(this.newRound());
    this.selectQuestion(this.draft.rounds.length - 1, 0);
    this.dirty.set(true);
  }

  removeRound(index: number): void {
    if (this.draft.rounds.length <= 1) return;
    this.draft.rounds.splice(index, 1);
    this.selectQuestion(Math.min(index, this.draft.rounds.length - 1), 0);
    this.dirty.set(true);
  }

  duplicateRound(index: number): void {
    this.draft.rounds.splice(index + 1, 0, structuredClone(this.draft.rounds[index]));
    this.selectQuestion(index + 1, 0);
    this.dirty.set(true);
  }

  moveRound(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.draft.rounds.length) return;
    [this.draft.rounds[index], this.draft.rounds[target]] = [this.draft.rounds[target], this.draft.rounds[index]];
    this.selectQuestion(target, 0);
    this.dirty.set(true);
  }

  duplicateWork(roundIndex: number, workIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length >= 3) return;
    works.splice(workIndex + 1, 0, structuredClone(works[workIndex]));
    this.selectQuestion(roundIndex, workIndex + 1);
    this.dirty.set(true);
  }

  addWork(roundIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length >= 3) return;
    works.push(this.newWork());
    this.selectQuestion(roundIndex, works.length - 1);
    this.dirty.set(true);
  }

  removeWork(roundIndex: number, workIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length <= 1) return;
    works.splice(workIndex, 1);
    this.selectQuestion(roundIndex, Math.min(workIndex, works.length - 1));
    this.dirty.set(true);
  }

  addClue(work: DraftWork): void {
    work.clues.push({ kind: 'text', content: '' });
    this.activeClueIndex.set(work.clues.length - 1);
    this.dirty.set(true);
  }

  changeClueKind(clue: DraftWork['clues'][number], kind: DraftClueKind): void {
    clue.kind = kind;
    clue.content = '';
    this.dirty.set(true);
  }

  acceptedMediaTypes(kind: DraftClueKind): string {
    if (kind === 'image') return 'image/*';
    if (kind === 'audio') return 'audio/*';
    if (kind === 'video') return 'video/*';
    return '';
  }

  isClueUploading(roundIndex: number, workIndex: number, clueIndex: number): boolean {
    return Boolean(this.uploadingClues()[this.clueUploadKey(roundIndex, workIndex, clueIndex)]);
  }

  async uploadClueFile(
    event: Event,
    clue: DraftWork['clues'][number],
    roundIndex: number,
    workIndex: number,
    clueIndex: number,
  ): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || clue.kind === 'text') return;
    const key = this.clueUploadKey(roundIndex, workIndex, clueIndex);
    this.uploadingClues.update((uploads) => ({ ...uploads, [key]: true }));
    this.message.set('');
    try {
      clue.content = await this.api.uploadClueFile(file, clue.kind);
      this.dirty.set(true);
      this.message.set('Fichier téléversé. Enregistrez le quiz pour conserver cet indice.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Impossible de téléverser ce fichier.');
    } finally {
      this.uploadingClues.update((uploads) => ({ ...uploads, [key]: false }));
      input.value = '';
    }
  }

  removeClue(work: DraftWork, clueIndex: number): void {
    if (work.clues.length <= 1) return;
    work.clues.splice(clueIndex, 1);
    this.activeClueIndex.set(Math.min(clueIndex, work.clues.length - 1));
    this.dirty.set(true);
  }

  saveQuiz(): void {
    if (this.saving() || this.hasUploadInProgress()) return;
    const incompleteRoundIndex = this.draft.rounds.findIndex((round) => round.works.length !== 3);
    if (incompleteRoundIndex >= 0) {
      this.message.set(`La manche ${incompleteRoundIndex + 1} doit contenir exactement trois œuvres.`);
      this.selectQuestion(incompleteRoundIndex, 0);
      return;
    }
    this.saving.set(true);
    this.fieldErrors.set({});
    const editingId = this.editingQuizId();
    const request = editingId ? this.api.updateQuiz(editingId, this.toPayload(this.draft)) : this.api.createQuiz(this.toPayload(this.draft));
    request.subscribe({
      next: () => {
        const confirmation = editingId ? 'Les modifications du quiz ont été enregistrées.' : 'Le quiz a été créé et enregistré.';
        this.message.set(confirmation);
        this.showFeedback(confirmation);
        this.dirty.set(false);
        this.resetForm();
        this.refresh();
        this.adminView.set('quizzes');
        this.saving.set(false);
      },
      error: (error) => {
        const errors = this.extractFieldErrors(error);
        this.fieldErrors.set(errors);
        this.revealFirstError(errors);
        this.message.set(Object.keys(errors).length ? 'Certains champs doivent être corrigés.' : "Impossible d'enregistrer ce quiz.");
        this.saving.set(false);
      },
    });
  }

  editQuiz(quizId: string): void {
    if (!this.confirmDiscard()) return;
    this.api.getQuizForEditing(quizId).subscribe({
      next: (quiz) => {
        this.editingQuizId.set(quiz.id);
        this.draft = this.toDraftQuiz(quiz);
        this.selectQuestion(0, 0);
        this.dirty.set(false);
        this.adminView.set('editor');
        this.message.set("Les salons existants de ce quiz seront supprimés à l'enregistrement.");
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: () => this.message.set('Impossible de charger ce quiz pour édition.'),
    });
  }

  duplicateQuiz(quiz: Quiz): void {
    if (!window.confirm(`Dupliquer le quiz "${quiz.title}" ?`)) return;
    this.api.duplicateQuiz(quiz.id).subscribe({
      next: (copy) => {
        this.refresh();
        this.showFeedback(`Le quiz "${copy.title}" a été créé.`);
      },
      error: () => this.message.set('Impossible de dupliquer ce quiz.'),
    });
  }

  exportQuiz(quizId: string): void {
    this.api.getQuizForEditing(quizId).subscribe({
      next: (quiz) => {
        const payload = this.toPayload(this.toDraftQuiz(quiz));
        const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.exportFileName(quiz.title);
        link.click();
        URL.revokeObjectURL(url);
        this.showFeedback(`Le quiz "${quiz.title}" a été exporté.`);
      },
      error: () => this.message.set("Impossible d'exporter ce quiz."),
    });
  }

  openImportModal(): void {
    this.clearImportProgressTimer();
    this.importModalOpen.set(true);
    this.focusModal();
    this.importProcessing.set(false);
    this.importProgress.set(0);
    this.importProgressLabel.set('');
    this.importErrors.set([]);
    this.importErrorDetailsOpen.set(false);
    this.missingDictionaryValues.set([]);
  }

  closeImportModal(): void {
    if (this.importProcessing() || this.addingMissingDictionaryValues()) return;
    this.clearImportProgressTimer();
    this.importModalOpen.set(false);
    this.modalTrigger?.focus();
    this.importProgress.set(0);
    this.importProgressLabel.set('');
    this.importErrors.set([]);
    this.importErrorDetailsOpen.set(false);
    this.missingDictionaryValues.set([]);
  }

  onImportDictionaryChange(dictionaryId: string): void {
    this.importDictionaryId.set(dictionaryId);
  }

  toggleImportErrorDetails(): void {
    this.importErrorDetailsOpen.update((open) => !open);
  }

  importErrorSummary(): string {
    if (this.missingDictionaryValues().length > 0) {
      return 'Certaines bonnes réponses ne sont pas présentes dans le dictionnaire sélectionné.';
    }
    return this.importErrors()[0] ?? "Le fichier n'a pas pu être importé.";
  }

  private startImportProgress(label: string, progress: number): void {
    this.clearImportProgressTimer();
    this.importProcessing.set(true);
    this.importProgressLabel.set(label);
    this.importProgress.set(progress);
    this.importErrors.set([]);
    this.importErrorDetailsOpen.set(false);
  }

  private setImportProgress(label: string, progress: number): void {
    this.importProgressLabel.set(label);
    this.importProgress.set(Math.max(this.importProgress(), progress));
  }

  private startImportWaitingProgress(): void {
    this.clearImportProgressTimer();
    this.importProgressTimer = setInterval(() => {
      this.importProgress.update((progress) => Math.min(92, progress + (progress < 75 ? 4 : 1)));
    }, 900);
  }

  private finishImportProgress(label: string): void {
    this.clearImportProgressTimer();
    this.importProgressLabel.set(label);
    this.importProgress.set(100);
  }

  private stopImportProgress(label: string): void {
    this.clearImportProgressTimer();
    this.importProgressLabel.set(label);
    this.importProgress.set(0);
  }

  private clearImportProgressTimer(): void {
    if (this.importProgressTimer) clearInterval(this.importProgressTimer);
    this.importProgressTimer = undefined;
  }

  importQuizJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.startImportProgress('Lecture du fichier JSON…', 8);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.setImportProgress('Préparation du quiz…', 28);
        const payload = JSON.parse(String(reader.result ?? '')) as unknown;
        const preparedPayload = this.prepareImportedQuiz(payload);
        this.importProcessing.set(true);
        this.importErrors.set([]);
        this.importErrorDetailsOpen.set(false);
        this.missingDictionaryValues.set([]);
        this.setImportProgress('Validation du dictionnaire et création du quiz…', 48);
        this.startImportWaitingProgress();
        this.api.createQuiz(preparedPayload).subscribe({
          next: (quiz) => {
            this.finishImportProgress('Quiz importé.');
            this.importProcessing.set(false);
            this.missingDictionaryValues.set([]);
            this.importModalOpen.set(false);
            this.refresh();
            this.showFeedback(`Le quiz "${quiz.title}" a été importé.`);
          },
          error: (error) => {
            this.stopImportProgress('Import interrompu.');
            this.importProcessing.set(false);
            const errors = this.extractFieldErrors(error);
            this.missingDictionaryValues.set(this.extractMissingDictionaryValues(errors));
            this.importErrors.set(this.importErrorMessages(errors));
          },
        });
      } catch {
        this.stopImportProgress('');
        this.importProcessing.set(false);
        this.missingDictionaryValues.set([]);
        this.importErrorDetailsOpen.set(false);
        this.importErrors.set(['Le fichier sélectionné ne contient pas un JSON de quiz valide.']);
      } finally {
        input.value = '';
      }
    };
    reader.onerror = () => {
      this.stopImportProgress('');
      this.importProcessing.set(false);
      this.importErrorDetailsOpen.set(false);
      this.importErrors.set(['Impossible de lire ce fichier.']);
      input.value = '';
    };
    reader.readAsText(file);
  }

  addMissingValuesToSelectedDictionary(): void {
    const dictionaryId = this.importDictionaryId();
    const missingValues = this.missingDictionaryValues();
    if (!dictionaryId) {
      this.importErrorDetailsOpen.set(false);
      this.importErrors.set(['Sélectionnez un dictionnaire œuvres avant d’ajouter les valeurs manquantes.']);
      return;
    }
    if (missingValues.length === 0 || this.addingMissingDictionaryValues()) return;
    this.importErrors.set([]);
    this.importErrorDetailsOpen.set(false);
    const dictionary = this.dictionaries().find((item) => item.id === dictionaryId);
    if (!dictionary) {
      this.importErrors.set(['Le dictionnaire sélectionné est introuvable.']);
      return;
    }

    const mergedValues = Array.from(new Set([...dictionary.values, ...missingValues].map((value) => value.trim()).filter(Boolean)));
    this.addingMissingDictionaryValues.set(true);
    this.api.saveAnswerDictionary({ id: dictionary.id, name: dictionary.name, values: mergedValues }).subscribe({
      next: (savedDictionary) => {
        this.addingMissingDictionaryValues.set(false);
        this.missingDictionaryValues.set([]);
        this.importErrors.set([]);
        this.loadDictionaries();
        this.showFeedback(`${missingValues.length} valeur(s) ajoutée(s) au dictionnaire "${savedDictionary.name}".`);
      },
      error: () => {
        this.addingMissingDictionaryValues.set(false);
        this.importErrors.set(["Impossible d'ajouter les valeurs au dictionnaire sélectionné."]);
      },
    });
  }

  cancelEdit(): void {
    if (!this.confirmDiscard()) return;
    this.resetForm();
  }

  createRoom(quizId: string): void {
    if (this.launchingQuizId()) return;
    this.launchingQuizId.set(quizId);
    this.message.set('Création du salon…');
    this.api.createRoom(quizId).subscribe({
      next: (room) => {
        window.location.href = `/rooms/${room.code}`;
      },
      error: () => {
        this.launchingQuizId.set(undefined);
        this.message.set('Impossible de créer le salon.');
        this.showFeedback('Le salon n’a pas pu être créé. Réessayez.', 'error');
      },
    });
  }

  deleteQuiz(quiz: Quiz): void {
    const confirmed = window.confirm(`Supprimer le quiz "${quiz.title}" ? Les salons et scores associés seront aussi supprimés.`);
    if (!confirmed) return;
    this.api.deleteQuiz(quiz.id).subscribe({
      next: () => {
        this.message.set('Quiz supprimé.');
        this.refresh();
      },
      error: () => this.message.set('Impossible de supprimer ce quiz.'),
    });
  }

  onDictionaryTextChange(value: string): void {
    this.dictionaryText.set(value);
    this.dictionaryPage.set(0);
  }

  setDictionarySearch(value: string): void {
    this.dictionarySearch.set(value);
    this.dictionaryPage.set(0);
  }

  changeDictionaryPage(direction: -1 | 1): void {
    const next = this.dictionaryPage() + direction;
    if (next >= 0 && next < this.dictionaryPageCount()) this.dictionaryPage.set(next);
  }

  importDictionaryFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      const normalized = file.name.toLowerCase().endsWith('.csv')
        ? content.split(/\r?\n/).flatMap((line) => line.split(/[;,]/)).join('\n')
        : content;
      this.dictionaryText.set(normalized);
      this.dictionaryPage.set(0);
      this.message.set(`${file.name} importé.`);
      input.value = '';
    };
    reader.onerror = () => this.message.set("Impossible de lire ce fichier.");
    reader.readAsText(file);
  }

  saveDictionary(): void {
    const name = this.dictionaryName().trim();
    if (!name) {
      this.message.set('Le nom du dictionnaire est obligatoire.');
      return;
    }
    if (this.editingDictionaryId() && !window.confirm('Remplacer le contenu actuel de ce dictionnaire ?')) return;
    const values = this.parseDictionaryText(this.dictionaryText());
    this.dictionarySaving.set(true);
    this.api.saveAnswerDictionary({ id: this.editingDictionaryId(), name, values }).subscribe({
      next: () => {
        this.newDictionary();
        this.loadDictionaries();
        this.message.set('Dictionnaire enregistré.');
        this.showFeedback('Le dictionnaire a été enregistré.');
        this.dictionarySaving.set(false);
      },
      error: (error) => {
        const errorMessage = this.apiErrorMessage(error, "Impossible d'enregistrer le dictionnaire.");
        this.message.set(errorMessage);
        this.showFeedback(errorMessage, 'error');
        this.dictionarySaving.set(false);
      },
    });
  }

  editDictionary(dictionary: AnswerDictionary): void {
    this.editingDictionaryId.set(dictionary.id);
    this.dictionaryName.set(dictionary.name);
    this.dictionaryText.set(dictionary.values.join('\n'));
    this.dictionarySearch.set('');
    this.dictionaryPage.set(0);
  }

  newDictionary(): void {
    this.editingDictionaryId.set(undefined);
    this.dictionaryName.set('');
    this.dictionaryText.set('');
    this.dictionarySearch.set('');
    this.dictionaryPage.set(0);
  }

  deleteDictionary(dictionary: AnswerDictionary): void {
    const usage = dictionary.usage_count || 0;
    const detail = usage > 0 ? ` Il est utilisé par ${usage} quiz, qui devront être modifiés.` : '';
    if (!window.confirm(`Supprimer le dictionnaire "${dictionary.name}" ?${detail}`)) return;
    this.api.deleteAnswerDictionary(dictionary.id).subscribe({
      next: () => {
        if (this.editingDictionaryId() === dictionary.id) this.newDictionary();
        this.loadDictionaries();
        this.message.set('Dictionnaire supprimé.');
      },
      error: () => this.message.set('Impossible de supprimer ce dictionnaire.'),
    });
  }

  errorPath(...parts: Array<string | number>): string {
    return parts.join('.');
  }

  dictionaryValuesFor(dictionaryId: string): string[] {
    if (!dictionaryId) return this.dictionaryValues();
    return this.dictionaries().find((dictionary) => dictionary.id === dictionaryId)?.values ?? [];
  }

  private confirmDiscard(): boolean {
    if (!this.dirty()) return true;
    return window.confirm('Abandonner les modifications non enregistrées ?');
  }

  feedbackTitle(): string {
    if (this.feedbackTone() === 'error') return 'Action impossible';
    return this.feedbackTone() === 'success' ? 'Action terminée' : 'Information';
  }

  private showFeedback(message: string, tone: 'success' | 'info' | 'error' = 'success'): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTone.set(tone);
    this.feedbackMessage.set(message);
    this.feedbackTimer = setTimeout(() => this.feedbackMessage.set(''), 4200);
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    const response = error as { status?: number; error?: { error?: unknown; details?: unknown; message?: unknown } };
    const apiError = response.error;
    const details = typeof apiError?.details === 'string' ? apiError.details : undefined;
    const message = typeof apiError?.message === 'string' ? apiError.message : undefined;
    const label = typeof apiError?.error === 'string' ? apiError.error : undefined;
    if (response.status === 413) {
      return details
        ? `Dictionnaire trop volumineux : ${details}`
        : 'Dictionnaire trop volumineux. Le serveur a refusé la taille de la requête.';
    }
    return details ?? message ?? label ?? fallback;
  }

  private refresh(): void {
    this.api.listQuizzes().subscribe({
      next: (quizzes) => this.quizzes.set(quizzes),
      error: () => this.message.set('Impossible de charger les quiz.'),
    });
  }

  private loadDictionaries(): void {
    this.api.listAnswerDictionaries().subscribe({
      next: (dictionaries) => {
        this.dictionaries.set(dictionaries);
        this.dictionaryValues.set(Array.from(new Set(dictionaries.flatMap((dictionary) => dictionary.values))));
      },
      error: () => this.message.set('Impossible de charger les dictionnaires.'),
    });
  }

  private resetForm(): void {
    this.editingQuizId.set(undefined);
    this.fieldErrors.set({});
    this.draft = this.emptyQuiz();
    this.selectQuestion(0, 0);
    this.previewOpen.set(false);
    this.dirty.set(false);
  }

  private emptyQuiz(): DraftQuiz {
    return {
      title: 'Quiz découverte',
      description: '',
      sequenceMode: 'rounds',
      hidePlayerNames: false,
      rounds: [this.newRound()],
    };
  }

  private extractFieldErrors(error: unknown): Record<string, string[]> {
    const issues = (error as { error?: { issues?: Array<{ path: Array<string | number>; message: string }> } })?.error?.issues ?? [];
    const errors: Record<string, string[]> = {};
    for (const issue of issues) {
      const key = issue.path.join('.');
      errors[key] = [...(errors[key] ?? []), issue.message];
    }
    return errors;
  }

  private importErrorMessages(errors: Record<string, string[]>): string[] {
    const messages = Object.values(errors).flat();
    if (messages.length === 0) return ["Impossible d'importer ce fichier JSON."];
    return messages;
  }

  private extractMissingDictionaryValues(errors: Record<string, string[]>): string[] {
    const missingValues = Object.values(errors)
      .flat()
      .flatMap((message) => Array.from(message.matchAll(/"([^"]+)"/g), (match) => match[1]?.trim() ?? ''))
      .filter(Boolean);
    return Array.from(new Set(missingValues));
  }

  private exportFileName(title: string): string {
    const slug = title
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${slug || 'quiz'}.json`;
  }

  private toDraftQuiz(quiz: Quiz): DraftQuiz {
    return {
      title: quiz.title,
      description: quiz.description,
      sequenceMode: quiz.sequence_mode ?? 'rounds',
      hidePlayerNames: quiz.hide_player_names ?? false,
      rounds: (quiz.rounds ?? []).map((round) => ({
        title: round.title,
        person: {
          name: round.person.name,
          answerMode: round.person.answer_mode ?? quiz.answer_mode ?? 'choices',
          dictionaryId: round.person.dictionary_id ?? '',
          options: this.optionLabels(round.person.options),
          correctOptionIndex: this.correctOptionIndex(round.person.options),
          correctAnswer: this.correctAnswer(round.person.options),
        },
        works: round.works.map((work) => ({
          clues: work.clues.length > 0
            ? work.clues.map((clue) => ({
                kind: this.toDraftClueKind(clue.kind),
                content: clue.content,
              }))
            : [{ kind: 'text' as const, content: '' }],
          answerMode: work.answer_mode ?? quiz.answer_mode ?? 'choices',
          dictionaryId: work.dictionary_id ?? '',
          options: this.optionLabels(work.options),
          correctOptionIndex: this.correctOptionIndex(work.options),
          correctAnswer: this.correctAnswer(work.options),
        })),
      })),
    };
  }

  private toPayload(draft: DraftQuiz) {
    return {
      title: draft.title,
      description: draft.description,
      sequenceMode: draft.sequenceMode,
      hidePlayerNames: draft.hidePlayerNames,
      rounds: draft.rounds.map((round, roundIndex) => ({
        title: this.roundPayloadTitle(roundIndex),
        person: {
          name: this.personPayloadName(round.person),
          ...this.answerPayload(round.person, ''),
        },
        works: round.works.map((work, workIndex) => ({
          title: work.answerMode === 'autocomplete'
            ? work.correctAnswer.trim() || `Œuvre ${workIndex + 1}`
            : work.options[work.correctOptionIndex]?.trim() || `Œuvre ${workIndex + 1}`,
          kind: 'other',
          clues: work.clues.filter((clue) => clue.content.trim().length > 0),
          ...this.answerPayload(work, work.correctAnswer),
        })),
      })),
    };
  }

  private prepareImportedQuiz(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid quiz payload');
    const quiz = structuredClone(payload) as {
      rounds?: Array<{
        works?: Array<{ answerMode?: string; dictionaryId?: string }>;
      }>;
    };
    const dictionaryId = this.importDictionaryId();
    if (dictionaryId) {
      for (const round of quiz.rounds ?? []) {
        for (const work of round.works ?? []) {
          if (work.answerMode === 'autocomplete') work.dictionaryId = dictionaryId;
        }
      }
    }
    return quiz;
  }

  private answerPayload(target: DraftAnswerTarget, fallbackAnswer: string) {
    if (target.answerMode === 'autocomplete') {
      return {
        answerMode: target.answerMode,
        dictionaryId: target.dictionaryId,
        correctAnswer: target.correctAnswer.trim() || fallbackAnswer.trim(),
      };
    }
    return {
      answerMode: target.answerMode,
      options: target.options,
      correctOptionIndex: target.correctOptionIndex,
    };
  }

  private roundPayloadTitle(roundIndex: number): string {
    return `Manche ${roundIndex + 1}`;
  }

  private personPayloadName(person: DraftRound['person']): string {
    return this.answerLabel(person) || 'Personne à définir';
  }

  answerLabel(target: DraftAnswerTarget): string {
    if (target.answerMode === 'autocomplete') return target.correctAnswer.trim();
    return target.options[target.correctOptionIndex]?.trim() ?? '';
  }

  private optionLabels(options: Array<{ label: string }> | undefined): string[] {
    return [0, 1, 2, 3].map((index) => options?.[index]?.label ?? '');
  }

  private correctOptionIndex(options: Array<{ isCorrect?: number }> | undefined): number {
    const index = options?.findIndex((option) => option.isCorrect === 1) ?? -1;
    return index >= 0 ? index : 0;
  }

  private correctAnswer(options: Array<{ label: string; isCorrect?: number }> | undefined): string {
    return options?.find((option) => option.isCorrect === 1)?.label ?? '';
  }

  private rawDictionaryValues(value: string): string[] {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  private parseDictionaryText(value: string): string[] {
    return Array.from(new Set(this.rawDictionaryValues(value)));
  }

  private filteredDictionaryValues(): string[] {
    const search = this.dictionarySearch().trim().toLocaleLowerCase('fr-FR');
    const values = this.parseDictionaryText(this.dictionaryText());
    return search ? values.filter((value) => value.toLocaleLowerCase('fr-FR').includes(search)) : values;
  }

  private clueUploadKey(roundIndex: number, workIndex: number, clueIndex: number): string {
    return `${roundIndex}.${workIndex}.${clueIndex}`;
  }

  private toDraftClueKind(kind: string): DraftClueKind {
    return kind === 'image' || kind === 'audio' || kind === 'video' ? kind : 'text';
  }

  private newRound(): DraftRound {
    return {
      title: '',
      person: {
        name: '',
        answerMode: 'choices',
        dictionaryId: '',
        options: ['', '', '', ''],
        correctOptionIndex: 0,
        correctAnswer: '',
      },
      works: [this.newWork()],
    };
  }

  private newWork(): DraftWork {
    return {
      clues: [{ kind: 'text', content: '' }],
      answerMode: 'choices',
      dictionaryId: '',
      options: ['', '', '', ''],
      correctOptionIndex: 0,
      correctAnswer: '',
    };
  }
}
