import { Component, HostListener, OnInit, computed, effect, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { AnswerSearchComponent } from './answer-search.component';
import { FieldErrorComponent } from './field-error.component';
import { AnswerDictionary, Quiz } from './types';

type AdminView = 'quizzes' | 'editor' | 'dictionaries';
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
  imports: [FormsModule, NgTemplateOutlet, FieldErrorComponent, AnswerSearchComponent],
  template: `
    <main class="page grid" [class.editor-page]="api.adminUser() && adminView() === 'editor'">
      @if (!api.authReady()) {
        <section class="auth-loading" aria-live="polite">
          <div class="brand-loader" aria-hidden="true"></div>
          <p>Ouverture de Quiz Teammates…</p>
        </section>
      } @else if (!api.adminUser()) {
        <section class="public-entry">
          <div>
            <p class="eyebrow">Quiz Teammates</p>
            <h1>Rejoindre une partie</h1>
            <p>Entrez le code affiché par l'animateur ou utilisez directement le QR code.</p>
            <form class="join-code-form" (ngSubmit)="joinByCode()">
              <label>
                Code de la partie
                <input
                  [(ngModel)]="publicRoomCode"
                  name="roomCode"
                  maxlength="8"
                  inputmode="text"
                  autocomplete="off"
                  placeholder="ABC123"
                >
              </label>
              <button type="submit" [disabled]="publicRoomCode.trim().length < 4">Rejoindre</button>
            </form>
          </div>
          <div class="admin-login">
            <h2>Créer et animer</h2>
            <p>Connectez-vous avec Google pour gérer vos quiz et lancer une partie.</p>
            <button type="button" class="secondary" (click)="api.signInWithGoogle()">Connexion avec Google</button>
            @if (api.authError()) {
              <p class="status-message error" role="alert">{{ api.authError() }}</p>
            }
          </div>
        </section>
      } @else {
        <header class="admin-header">
          <div>
            <p class="eyebrow">Espace de création</p>
            <h1>Bonjour {{ api.adminUser()?.name || api.adminUser()?.email }}</h1>
          </div>
          <button type="button" class="secondary" (click)="api.signOut()">Déconnexion</button>
        </header>

        <nav class="admin-tabs" aria-label="Administration">
          <button type="button" [class.active]="adminView() === 'quizzes'" (click)="switchView('quizzes')">Mes quiz</button>
          <button type="button" [class.active]="adminView() === 'editor'" (click)="openNewQuiz()">Éditeur</button>
          <button type="button" [class.active]="adminView() === 'dictionaries'" (click)="switchView('dictionaries')">Dictionnaires</button>
        </nav>

        @if (adminView() === 'quizzes') {
          <section class="panel grid">
            <div class="section-heading">
              <div>
                <h2>Mes quiz</h2>
                <p>Créez un salon, reprenez un quiz ou préparez une nouvelle animation.</p>
              </div>
              <button type="button" (click)="openNewQuiz()">Nouveau quiz</button>
            </div>
            @if (quizzes().length === 0) {
              <div class="empty-state">
                <h3>Aucun quiz</h3>
                <p>Créez votre premier quiz pour pouvoir ouvrir un salon.</p>
              </div>
            }
            <div class="quiz-list">
              @for (quiz of quizzes(); track quiz.id) {
                <article class="quiz-row">
                  <div>
                    <h3>{{ quiz.title }}</h3>
                    <p>{{ quiz.description || 'Sans description' }}</p>
                    <span>{{ quiz.rounds?.length || 0 }} manche(s) · {{ (quiz.rounds?.length || 0) * 4 }} question(s)</span>
                    <span>
                      {{ quiz.sequence_mode === 'works-first'
                        ? 'Œuvres mélangées, personnes à la fin'
                        : 'Déroulement par manche' }}
                    </span>
                    @if (quiz.hide_player_names) {
                      <span>Classements anonymisés</span>
                    }
                  </div>
                  <div class="row-actions">
                    <button type="button" (click)="createRoom(quiz.id)">Créer un salon</button>
                    <button type="button" class="secondary" (click)="editQuiz(quiz.id)">Éditer</button>
                    <button type="button" class="danger ghost" (click)="deleteQuiz(quiz)">Supprimer</button>
                  </div>
                </article>
              }
            </div>
          </section>
        }

        @if (adminView() === 'editor') {
          <section class="editor-layout">
            <div class="panel grid editor-main">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">{{ editingQuizId() ? 'Modification' : 'Nouveau quiz' }}</p>
                  <h2>{{ editingQuizId() ? draft.title || 'Quiz sans titre' : 'Créer un quiz' }}</h2>
                </div>
                <button type="button" class="secondary" (click)="cancelEdit()">Réinitialiser</button>
              </div>

              <div class="editor-summary" aria-label="Résumé du quiz">
                <span><strong>{{ draft.rounds.length }}</strong> manche(s)</span>
                <span><strong>{{ draft.rounds.length * 4 }}</strong> question(s)</span>
                <span><strong>{{ clueCount() }}</strong> indice(s)</span>
              </div>

              <div class="form-grid quiz-basics">
                <label>
                  Titre du quiz
                  <input [(ngModel)]="draft.title" placeholder="Cinéma et jeux d'enfance">
                  <app-field-error [errors]="fieldErrors()" path="title" />
                </label>
                <label>
                  Description
                  <textarea [(ngModel)]="draft.description" rows="2" placeholder="Session équipe du vendredi"></textarea>
                </label>
                <label class="sequence-mode-field">
                  Déroulement des questions
                  <select [(ngModel)]="draft.sequenceMode">
                    <option value="rounds">Par manche : 3 œuvres puis la personne</option>
                    <option value="works-first">Œuvres mélangées puis toutes les personnes</option>
                  </select>
                  <span class="field-help">
                    @if (draft.sequenceMode === 'works-first') {
                      Toutes les œuvres sont mélangées entre les manches. Les questions sur les personnes arrivent seulement à la fin.
                    } @else {
                      Chaque personne est demandée juste après les trois œuvres de sa manche.
                    }
                  </span>
                </label>
                <label class="privacy-mode-field">
                  <span class="checkbox-line">
                    <input type="checkbox" [(ngModel)]="draft.hidePlayerNames">
                    Masquer les pseudos dans les classements
                  </span>
                  <span class="field-help">
                    Chaque joueur reçoit un emoji animal ou fruit affiché à la place de son pseudo sur les écrans de score.
                  </span>
                </label>
              </div>

              @for (round of draft.rounds; track $index; let roundIndex = $index) {
                <article class="round-editor">
                  <header class="round-header">
                    <button
                      type="button"
                      class="disclosure"
                      [attr.aria-expanded]="!isRoundCollapsed(roundIndex)"
                      (click)="toggleRound(roundIndex)"
                    >
                      <span>{{ isRoundCollapsed(roundIndex) ? 'Afficher' : 'Masquer' }}</span>
                    </button>
                    <div>
                      <p class="eyebrow">Manche {{ roundIndex + 1 }}</p>
                      <h3>{{ round.title || 'Sans titre' }}</h3>
                    </div>
                    <div class="compact-actions">
                      <button type="button" class="secondary" (click)="moveRound(roundIndex, -1)" [disabled]="roundIndex === 0">Monter</button>
                      <button type="button" class="secondary" (click)="moveRound(roundIndex, 1)" [disabled]="roundIndex === draft.rounds.length - 1">Descendre</button>
                      <button type="button" class="secondary" (click)="duplicateRound(roundIndex)">Dupliquer</button>
                      <button type="button" class="danger ghost" (click)="removeRound(roundIndex)" [disabled]="draft.rounds.length === 1">Supprimer</button>
                    </div>
                  </header>

                  @if (!isRoundCollapsed(roundIndex)) {
                    <div class="round-body grid">
                      <div class="form-grid two">
                        <label>
                          Nom de la manche
                          <input [(ngModel)]="round.title">
                          <app-field-error [errors]="fieldErrors()" [path]="errorPath('rounds', roundIndex, 'title')" />
                        </label>
                        <label>
                          Personne cible
                          <input [(ngModel)]="round.person.name">
                          <app-field-error [errors]="fieldErrors()" [path]="errorPath('rounds', roundIndex, 'person', 'name')" />
                        </label>
                      </div>

                      <section class="works-section">
                        <div class="section-heading works-heading">
                          <div>
                            <h4>Œuvres de la manche</h4>
                            <p>{{ round.works.length }} / 3 œuvre(s) ajoutée(s)</p>
                          </div>
                          <button
                            type="button"
                            class="secondary"
                            (click)="addWork(roundIndex)"
                            [disabled]="round.works.length >= 3"
                          >
                            Ajouter une œuvre
                          </button>
                        </div>
                        @if (round.works.length < 3) {
                          <p class="works-requirement">
                            Ajoutez encore {{ 3 - round.works.length }} œuvre(s) pour compléter cette manche.
                          </p>
                        }
                        <div class="works-grid">
                          @for (work of round.works; track $index; let workIndex = $index) {
                            <section class="work-editor">
                            <div class="section-heading compact">
                              <div class="work-heading">
                                <span>{{ workIndex + 1 }}</span>
                                <div>
                                  <p class="eyebrow">Question œuvre</p>
                                  <h4>Œuvre {{ workIndex + 1 }}</h4>
                                </div>
                              </div>
                              <div class="compact-actions">
                                <button
                                  type="button"
                                  class="secondary"
                                  (click)="duplicateWork(roundIndex, workIndex)"
                                  [disabled]="round.works.length >= 3"
                                >
                                  Dupliquer
                                </button>
                                <button
                                  type="button"
                                  class="danger ghost"
                                  (click)="removeWork(roundIndex, workIndex)"
                                  [disabled]="round.works.length === 1"
                                >
                                  Supprimer
                                </button>
                              </div>
                            </div>
                            @for (clue of work.clues; track $index; let clueIndex = $index) {
                              <div class="clue-editor">
                                <div class="form-grid two">
                                  <label>
                                    Type d'indice
                                    <select [(ngModel)]="clue.kind" (ngModelChange)="changeClueKind(clue, $event)">
                                      <option value="text">Texte</option>
                                      <option value="image">Image</option>
                                      <option value="audio">Son</option>
                                      <option value="video">Vidéo</option>
                                    </select>
                                  </label>
                                  @if (clue.kind === 'text') {
                                    <label>
                                      Indice {{ clueIndex + 1 }}
                                      <input [(ngModel)]="clue.content" placeholder="Texte de l'indice">
                                    </label>
                                  } @else {
                                    <label class="media-upload">
                                      Fichier {{ clue.kind === 'image' ? 'image' : clue.kind === 'audio' ? 'audio' : 'vidéo' }}
                                      <input
                                        type="file"
                                        [accept]="acceptedMediaTypes(clue.kind)"
                                        [disabled]="isClueUploading(roundIndex, workIndex, clueIndex)"
                                        (change)="uploadClueFile($event, clue, roundIndex, workIndex, clueIndex)"
                                      >
                                      <span class="field-help">
                                        Maximum : {{ clue.kind === 'image' ? '5 Mo' : clue.kind === 'audio' ? '10 Mo' : '20 Mo' }}
                                      </span>
                                    </label>
                                  }
                                </div>
                                <app-field-error
                                  [errors]="fieldErrors()"
                                  [path]="errorPath('rounds', roundIndex, 'works', workIndex, 'clues', clueIndex, 'content')"
                                />
                                @if (isClueUploading(roundIndex, workIndex, clueIndex)) {
                                  <div class="upload-progress" role="status">
                                    <span></span>
                                    Téléversement en cours…
                                  </div>
                                }
                                @if (clue.content && clue.kind !== 'text') {
                                  <div class="media-preview">
                                    @if (clue.kind === 'image') {
                                      <img class="clue-preview" [src]="clue.content" alt="Aperçu de l'indice">
                                    } @else if (clue.kind === 'audio') {
                                      <audio [src]="clue.content" controls preload="metadata"></audio>
                                    } @else if (clue.kind === 'video') {
                                      <video [src]="clue.content" controls preload="metadata"></video>
                                    }
                                    <button type="button" class="danger ghost" (click)="clearClueMedia(clue)">Remplacer</button>
                                  </div>
                                }
                                @if (work.clues.length > 1) {
                                  <button type="button" class="danger ghost" (click)="removeClue(work, clueIndex)">Retirer</button>
                                }
                              </div>
                            }
                            <button type="button" class="secondary" (click)="addClue(work)">Ajouter un indice</button>
                            <div class="form-grid two answer-settings">
                              <label>
                                Mode de réponse
                                <select [(ngModel)]="work.answerMode">
                                  <option value="choices">4 propositions</option>
                                  <option value="autocomplete">Recherche avec autocomplétion</option>
                                </select>
                              </label>
                              @if (work.answerMode === 'autocomplete') {
                                <label>
                                  Dictionnaire
                                  <select [(ngModel)]="work.dictionaryId">
                                    <option value="">Tous les dictionnaires</option>
                                    @for (dictionary of dictionaries(); track dictionary.id) {
                                      <option [value]="dictionary.id">{{ dictionary.name }}</option>
                                    }
                                  </select>
                                </label>
                              }
                            </div>
                            <div class="answer-editor">
                              <ng-container
                                *ngTemplateOutlet="answerEditor; context: {
                                  target: work,
                                  prefix: errorPath('rounds', roundIndex, 'works', workIndex),
                                  radioName: 'work-' + roundIndex + '-' + workIndex,
                                  label: 'œuvre'
                                }"
                              />
                            </div>
                            </section>
                          }
                        </div>
                      </section>

                      <section class="person-editor">
                        <h4>Question sur la personne reliée</h4>
                        <div class="form-grid two">
                          <label>
                            Mode de réponse
                            <select [(ngModel)]="round.person.answerMode">
                              <option value="choices">4 propositions</option>
                              <option value="autocomplete">Recherche avec autocomplétion</option>
                            </select>
                          </label>
                          @if (round.person.answerMode === 'autocomplete') {
                            <label>
                              Dictionnaire
                              <select [(ngModel)]="round.person.dictionaryId">
                                <option value="">Tous les dictionnaires</option>
                                @for (dictionary of dictionaries(); track dictionary.id) {
                                  <option [value]="dictionary.id">{{ dictionary.name }}</option>
                                }
                              </select>
                            </label>
                          }
                        </div>
                        <div class="answer-editor">
                          <ng-container
                            *ngTemplateOutlet="answerEditor; context: {
                              target: round.person,
                              prefix: errorPath('rounds', roundIndex, 'person'),
                              radioName: 'person-' + roundIndex,
                              label: 'personne'
                            }"
                          />
                        </div>
                      </section>
                    </div>
                  }
                </article>
              }

              <button type="button" class="secondary add-round" (click)="addRound()">Ajouter une manche</button>
            </div>

            <aside class="panel editor-sidebar">
              <h3>Résumé</h3>
              <p>{{ draft.rounds.length }} manche(s), soit {{ draft.rounds.length * 4 }} questions.</p>
              <p>{{ clueCount() }} indice(s) seront révélés progressivement.</p>
              @if (dirty()) {
                <p class="status-message warning">Modifications non enregistrées</p>
              }
            </aside>
          </section>

          <div class="sticky-save">
            <p>{{ message() }}</p>
            <div class="row-actions">
              <button type="button" class="secondary" (click)="switchView('quizzes')">Fermer</button>
              <button type="button" (click)="saveQuiz()" [disabled]="saving() || hasUploadInProgress()">
                {{ saving() ? 'Enregistrement…' : editingQuizId() ? 'Enregistrer les modifications' : 'Créer le quiz' }}
              </button>
            </div>
          </div>
        }

        @if (adminView() === 'dictionaries') {
          <section class="dictionary-layout">
            <div class="panel grid">
              <div class="section-heading">
                <div>
                  <h2>{{ editingDictionaryId() ? 'Modifier le dictionnaire' : 'Nouveau dictionnaire' }}</h2>
                  <p>Collez une valeur par ligne ou importez un fichier texte ou CSV.</p>
                </div>
                <button type="button" class="secondary" (click)="newDictionary()">Nouveau</button>
              </div>
              <label>
                Nom du dictionnaire
                <input [ngModel]="dictionaryName()" (ngModelChange)="dictionaryName.set($event)" placeholder="Films et séries">
              </label>
              <label>
                Valeurs
                <textarea
                  [ngModel]="dictionaryText()"
                  (ngModelChange)="onDictionaryTextChange($event)"
                  rows="14"
                  placeholder="Interstellar&#10;The Legend of Zelda&#10;Christopher Nolan"
                ></textarea>
              </label>
              <div class="dictionary-stats">
                <span><strong>{{ dictionaryStats().unique }}</strong> valeur(s)</span>
                <span><strong>{{ dictionaryStats().duplicates }}</strong> doublon(s) retiré(s)</span>
              </div>
              <div class="row-actions">
                <label class="file-button secondary">
                  Importer un fichier
                  <input type="file" accept=".txt,.csv,text/plain,text/csv" (change)="importDictionaryFile($event)">
                </label>
                <button type="button" (click)="saveDictionary()">Enregistrer</button>
              </div>

              <div class="dictionary-preview">
                <label>
                  Rechercher dans l'aperçu
                  <input [ngModel]="dictionarySearch()" (ngModelChange)="setDictionarySearch($event)" placeholder="Filtrer les valeurs">
                </label>
                <ol>
                  @for (value of dictionaryPreview(); track value) {
                    <li>{{ value }}</li>
                  }
                </ol>
                <div class="pagination">
                  <button type="button" class="secondary" (click)="changeDictionaryPage(-1)" [disabled]="dictionaryPage() === 0">Précédent</button>
                  <span>Page {{ dictionaryPage() + 1 }} / {{ dictionaryPageCount() }}</span>
                  <button type="button" class="secondary" (click)="changeDictionaryPage(1)" [disabled]="dictionaryPage() + 1 >= dictionaryPageCount()">Suivant</button>
                </div>
              </div>
            </div>

            <aside class="panel grid">
              <h2>Mes dictionnaires</h2>
              @if (dictionaries().length === 0) {
                <p>Aucun dictionnaire enregistré.</p>
              }
              @for (dictionary of dictionaries(); track dictionary.id) {
                <article class="dictionary-row" [class.active]="editingDictionaryId() === dictionary.id">
                  <div>
                    <h3>{{ dictionary.name }}</h3>
                    <p>{{ dictionary.values.length }} valeur(s) · utilisé par {{ dictionary.usage_count || 0 }} quiz</p>
                  </div>
                  <div class="row-actions">
                    <button type="button" class="secondary" (click)="editDictionary(dictionary)">Éditer</button>
                    <button type="button" class="danger ghost" (click)="deleteDictionary(dictionary)">Supprimer</button>
                  </div>
                </article>
              }
            </aside>
          </section>
        }

        @if (adminView() !== 'editor' && message()) {
          <p class="status-message" role="status">{{ message() }}</p>
        }
      }
    </main>

    <ng-template #answerEditor let-target="target" let-prefix="prefix" let-radioName="radioName" let-label="label">
      @if (target.answerMode === 'choices') {
        <div class="options-grid">
          @for (option of target.options; track $index; let optionIndex = $index) {
            <label>
              Proposition {{ optionIndex + 1 }}
              <span class="option-line">
                <input
                  class="radio"
                  type="radio"
                  [name]="radioName"
                  [value]="optionIndex"
                  [(ngModel)]="target.correctOptionIndex"
                  [attr.aria-label]="'Définir la proposition ' + (optionIndex + 1) + ' comme bonne réponse'"
                >
                <input [(ngModel)]="target.options[optionIndex]">
              </span>
              <app-field-error [errors]="fieldErrors()" [path]="prefix + '.options.' + optionIndex" />
            </label>
          }
        </div>
        <app-field-error [errors]="fieldErrors()" [path]="prefix + '.options'" />
        <app-field-error [errors]="fieldErrors()" [path]="prefix + '.correctOptionIndex'" />
      } @else {
        <app-answer-search
          [values]="dictionaryValuesFor(target.dictionaryId)"
          [value]="target.correctAnswer"
          (valueChange)="target.correctAnswer = $event"
          [label]="'Bonne réponse ' + label"
          placeholder="Rechercher puis sélectionner une réponse"
        />
        <app-field-error [errors]="fieldErrors()" [path]="prefix + '.correctAnswer'" />
      }
    </ng-template>
  `,
})
export class HomeComponent implements OnInit {
  quizzes = signal<Quiz[]>([]);
  dictionaries = signal<AnswerDictionary[]>([]);
  dictionaryValues = signal<string[]>([]);
  adminView = signal<AdminView>('quizzes');
  message = signal('');
  fieldErrors = signal<Record<string, string[]>>({});
  saving = signal(false);
  editingQuizId = signal<string | undefined>(undefined);
  dirty = signal(false);
  collapsedRounds = signal<Record<number, boolean>>({});
  uploadingClues = signal<Record<string, boolean>>({});
  hasUploadInProgress = computed(() => Object.values(this.uploadingClues()).some(Boolean));
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

  constructor(public api: ApiService) {
    effect(() => {
      if (this.api.adminUser()) {
        this.refresh();
        this.loadDictionaries();
      } else {
        this.quizzes.set([]);
        this.dictionaries.set([]);
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

  @HostListener('input')
  @HostListener('change')
  markEditorDirty(): void {
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
  }

  openNewQuiz(): void {
    if (this.adminView() === 'editor' && !this.confirmDiscard()) return;
    this.resetForm();
    this.adminView.set('editor');
  }

  toggleRound(index: number): void {
    this.collapsedRounds.update((rounds) => ({ ...rounds, [index]: !rounds[index] }));
  }

  isRoundCollapsed(index: number): boolean {
    return Boolean(this.collapsedRounds()[index]);
  }

  clueCount(): number {
    return this.draft.rounds.reduce(
      (roundTotal, round) => roundTotal + round.works.reduce((workTotal, work) => workTotal + work.clues.length, 0),
      0,
    );
  }

  addRound(): void {
    this.draft.rounds.push(this.newRound());
    this.dirty.set(true);
  }

  removeRound(index: number): void {
    if (this.draft.rounds.length <= 1) return;
    this.draft.rounds.splice(index, 1);
    this.dirty.set(true);
  }

  duplicateRound(index: number): void {
    this.draft.rounds.splice(index + 1, 0, structuredClone(this.draft.rounds[index]));
    this.dirty.set(true);
  }

  moveRound(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.draft.rounds.length) return;
    [this.draft.rounds[index], this.draft.rounds[target]] = [this.draft.rounds[target], this.draft.rounds[index]];
    this.dirty.set(true);
  }

  duplicateWork(roundIndex: number, workIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length >= 3) return;
    works.splice(workIndex + 1, 0, structuredClone(works[workIndex]));
    this.dirty.set(true);
  }

  addWork(roundIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length >= 3) return;
    works.push(this.newWork());
    this.dirty.set(true);
  }

  removeWork(roundIndex: number, workIndex: number): void {
    const works = this.draft.rounds[roundIndex].works;
    if (works.length <= 1) return;
    works.splice(workIndex, 1);
    this.dirty.set(true);
  }

  addClue(work: DraftWork): void {
    work.clues.push({ kind: 'text', content: '' });
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

  clearClueMedia(clue: DraftWork['clues'][number]): void {
    clue.content = '';
    this.dirty.set(true);
  }

  removeClue(work: DraftWork, clueIndex: number): void {
    if (work.clues.length <= 1) return;
    work.clues.splice(clueIndex, 1);
    this.dirty.set(true);
  }

  saveQuiz(): void {
    const incompleteRoundIndex = this.draft.rounds.findIndex((round) => round.works.length !== 3);
    if (incompleteRoundIndex >= 0) {
      this.message.set(`La manche ${incompleteRoundIndex + 1} doit contenir exactement trois œuvres.`);
      this.collapsedRounds.update((rounds) => ({ ...rounds, [incompleteRoundIndex]: false }));
      return;
    }
    this.saving.set(true);
    this.fieldErrors.set({});
    const editingId = this.editingQuizId();
    const request = editingId ? this.api.updateQuiz(editingId, this.toPayload(this.draft)) : this.api.createQuiz(this.toPayload(this.draft));
    request.subscribe({
      next: () => {
        this.message.set(editingId ? 'Quiz modifié.' : 'Quiz créé.');
        this.dirty.set(false);
        this.resetForm();
        this.refresh();
        this.adminView.set('quizzes');
        this.saving.set(false);
      },
      error: (error) => {
        const errors = this.extractFieldErrors(error);
        this.fieldErrors.set(errors);
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
        this.collapsedRounds.set({});
        this.dirty.set(false);
        this.adminView.set('editor');
        this.message.set("Les salons existants de ce quiz seront supprimés à l'enregistrement.");
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: () => this.message.set('Impossible de charger ce quiz pour édition.'),
    });
  }

  cancelEdit(): void {
    if (!this.confirmDiscard()) return;
    this.resetForm();
  }

  createRoom(quizId: string): void {
    this.message.set('Création du salon…');
    this.api.createRoom(quizId).subscribe({
      next: (room) => {
        window.location.href = `/rooms/${room.code}`;
      },
      error: () => this.message.set('Impossible de créer le salon.'),
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
    this.api.saveAnswerDictionary({ id: this.editingDictionaryId(), name, values }).subscribe({
      next: () => {
        this.newDictionary();
        this.loadDictionaries();
        this.message.set('Dictionnaire enregistré.');
      },
      error: () => this.message.set("Impossible d'enregistrer le dictionnaire."),
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
    this.collapsedRounds.set({});
    this.draft = this.emptyQuiz();
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
      rounds: draft.rounds.map((round) => ({
        title: round.title,
        person: {
          name: round.person.name,
          ...this.answerPayload(round.person, round.person.correctAnswer || round.person.name),
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
      title: 'Nouvelle manche',
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
