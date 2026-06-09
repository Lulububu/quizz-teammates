import { Component, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from './api.service';
import { Quiz } from './types';

type DraftQuiz = {
  title: string;
  description: string;
  rounds: Array<{
    title: string;
    person: { name: string; options: string[]; correctOptionIndex: number };
    works: Array<{
      clues: Array<{ kind: 'text'; content: string }>;
      options: string[];
      correctOptionIndex: number;
    }>;
  }>;
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page grid two-columns">
      @if (!api.adminUser()) {
        <section class="panel grid">
          <h1>Connexion admin</h1>
          <p>Connectez-vous avec Google pour creer, consulter et modifier vos quiz.</p>
          <button type="button" (click)="api.signInWithGoogle()">Connexion avec Google</button>
          @if (api.authError()) {
            <p class="answer-state">{{ api.authError() }}</p>
          }
        </section>
      } @else {
        <section class="panel grid">
          <div class="row">
            <div>
              <h1>{{ editingQuizId() ? 'Edition du quiz' : 'Creation de quiz' }}</h1>
              <p>Composez des manches de trois oeuvres reliees a une personne cible.</p>
            </div>
            <button type="button" class="secondary" (click)="api.signOut()">Deconnexion</button>
          </div>
          <p class="muted">Connecte : {{ api.adminUser()?.email }}</p>

          <label>
            Titre du quiz
            <input [(ngModel)]="draft.title" placeholder="Cinema et jeux d'enfance">
          </label>

          <label>
            Description
            <textarea [(ngModel)]="draft.description" rows="2" placeholder="Session equipe du vendredi"></textarea>
          </label>

          @for (round of draft.rounds; track $index; let roundIndex = $index) {
            <article class="item grid">
              <h2>Manche {{ roundIndex + 1 }}</h2>
              <div class="row">
                <label>
                  Nom de la manche
                  <input [(ngModel)]="round.title">
                </label>
                <label>
                  Personne cible
                  <input [(ngModel)]="round.person.name">
                </label>
              </div>

              @for (work of round.works; track $index; let workIndex = $index) {
                <div class="grid">
                  <h3>Oeuvre {{ workIndex + 1 }}</h3>
                  @for (clue of work.clues; track $index; let clueIndex = $index) {
                    <div class="row">
                      <label>
                        Indice {{ clueIndex + 1 }}
                        <input [(ngModel)]="clue.content" placeholder="Texte ou URL d'image">
                      </label>
                      @if (work.clues.length > 1) {
                        <button type="button" class="danger" (click)="removeClue(work, clueIndex)">Retirer</button>
                      }
                    </div>
                  }
                  <button type="button" class="secondary" (click)="addClue(work)">Ajouter un indice</button>
                </div>
                <div class="options-grid">
                  @for (option of work.options; track $index; let optionIndex = $index) {
                    <label>
                      Proposition oeuvre {{ optionIndex + 1 }}
                      <span class="option-line">
                        <input
                          class="radio"
                          type="radio"
                          [name]="'work-' + roundIndex + '-' + workIndex"
                          [value]="optionIndex"
                          [(ngModel)]="work.correctOptionIndex"
                        >
                        <input [(ngModel)]="work.options[optionIndex]">
                      </span>
                    </label>
                  }
                </div>
              }

              <h3>Question personne reliee</h3>
              <div class="options-grid">
                @for (option of round.person.options; track $index; let optionIndex = $index) {
                  <label>
                    Proposition personne {{ optionIndex + 1 }}
                    <span class="option-line">
                      <input
                        class="radio"
                        type="radio"
                        [name]="'person-' + roundIndex"
                        [value]="optionIndex"
                        [(ngModel)]="round.person.correctOptionIndex"
                      >
                      <input [(ngModel)]="round.person.options[optionIndex]">
                    </span>
                  </label>
                }
              </div>
            </article>
          }

          <div class="row">
            <button type="button" class="secondary" (click)="addRound()">Ajouter une manche</button>
            @if (editingQuizId()) {
              <button type="button" class="secondary" (click)="cancelEdit()">Annuler</button>
            }
            <button type="button" (click)="saveQuiz()" [disabled]="saving()">
              {{ editingQuizId() ? 'Enregistrer' : 'Creer le quiz' }}
            </button>
          </div>
          <p class="answer-state">{{ message() }}</p>
        </section>

        <aside class="panel grid">
          <h2>Mes quiz</h2>
          @if (quizzes().length === 0) {
            <p>Aucun quiz cree pour le moment.</p>
          }
          @for (quiz of quizzes(); track quiz.id) {
            <article class="item grid">
              <h3>{{ quiz.title }}</h3>
              <p>{{ quiz.description || 'Sans description' }}</p>
              <div class="row">
                <button type="button" (click)="createRoom(quiz.id)">Creer un salon</button>
                <button type="button" class="secondary" (click)="editQuiz(quiz.id)">Editer</button>
                <button type="button" class="danger" (click)="deleteQuiz(quiz)">Supprimer</button>
              </div>
            </article>
          }
        </aside>
      }
    </main>
  `,
})
export class HomeComponent implements OnInit {
  quizzes = signal<Quiz[]>([]);
  message = signal('');
  saving = signal(false);
  editingQuizId = signal<string | undefined>(undefined);
  draft: DraftQuiz = {
    title: 'Quiz decouverte',
    description: '',
    rounds: [this.newRound()],
  };

  constructor(public api: ApiService) {
    effect(() => {
      if (this.api.adminUser()) {
        this.refresh();
      } else {
        this.quizzes.set([]);
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    if (this.api.adminUser()) this.refresh();
  }

  addRound(): void {
    this.draft.rounds.push(this.newRound());
  }

  addClue(work: DraftQuiz['rounds'][number]['works'][number]): void {
    work.clues.push({ kind: 'text', content: '' });
  }

  removeClue(work: DraftQuiz['rounds'][number]['works'][number], clueIndex: number): void {
    if (work.clues.length <= 1) return;
    work.clues.splice(clueIndex, 1);
  }

  saveQuiz(): void {
    this.saving.set(true);
    const editingId = this.editingQuizId();
    const payload = this.toPayload(this.draft);
    const request = editingId ? this.api.updateQuiz(editingId, payload) : this.api.createQuiz(payload);
    request.subscribe({
      next: () => {
        this.message.set(editingId ? 'Quiz modifie.' : 'Quiz cree.');
        this.resetForm();
        this.saving.set(false);
        this.refresh();
      },
      error: () => {
        this.message.set('Impossible de creer ce quiz. Verifiez les 3 oeuvres, la personne et les 4 propositions de chaque question.');
        this.saving.set(false);
      },
    });
  }

  editQuiz(quizId: string): void {
    this.api.getQuizForEditing(quizId).subscribe({
      next: (quiz) => {
        this.editingQuizId.set(quiz.id);
        this.draft = this.toDraftQuiz(quiz);
        this.message.set('Modification en cours. Les salons existants de ce quiz seront supprimes a l enregistrement.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: () => {
        this.message.set('Impossible de charger ce quiz pour edition.');
      },
    });
  }

  cancelEdit(): void {
    this.resetForm();
    this.message.set('Edition annulee.');
  }

  createRoom(quizId: string): void {
    this.api.createRoom(quizId).subscribe((room) => {
      window.location.href = `/rooms/${room.code}`;
    });
  }

  deleteQuiz(quiz: Quiz): void {
    const confirmed = window.confirm(`Supprimer le quiz "${quiz.title}" ? Les salons et scores associes seront aussi supprimes.`);
    if (!confirmed) return;

    this.api.deleteQuiz(quiz.id).subscribe({
      next: () => {
        this.message.set('Quiz supprime.');
        this.refresh();
      },
      error: () => {
        this.message.set('Impossible de supprimer ce quiz.');
      },
    });
  }

  private refresh(): void {
    this.api.listQuizzes().subscribe((quizzes) => this.quizzes.set(quizzes));
  }

  private resetForm(): void {
    this.editingQuizId.set(undefined);
    this.draft = { title: '', description: '', rounds: [this.newRound()] };
  }

  private toDraftQuiz(quiz: Quiz): DraftQuiz {
    return {
      title: quiz.title,
      description: quiz.description,
      rounds: (quiz.rounds ?? []).map((round) => ({
        title: round.title,
        person: {
          name: round.person.name,
          options: this.optionLabels(round.person.options),
          correctOptionIndex: this.correctOptionIndex(round.person.options),
        },
        works: round.works.map((work) => ({
          clues:
            work.clues.length > 0
              ? work.clues.map((clue) => ({ kind: 'text' as const, content: clue.content }))
              : [{ kind: 'text' as const, content: '' }],
          options: this.optionLabels(work.options),
          correctOptionIndex: this.correctOptionIndex(work.options),
        })),
      })),
    };
  }

  private toPayload(draft: DraftQuiz) {
    return {
      title: draft.title,
      description: draft.description,
      rounds: draft.rounds.map((round) => ({
        title: round.title,
        person: round.person,
        works: round.works.map((work, workIndex) => ({
          title: work.options[work.correctOptionIndex]?.trim() || `Oeuvre ${workIndex + 1}`,
          kind: 'other',
          clues: work.clues.filter((clue) => clue.content.trim().length > 0),
          options: work.options,
          correctOptionIndex: work.correctOptionIndex,
        })),
      })),
    };
  }

  private optionLabels(options: Array<{ label: string }> | undefined): string[] {
    return [0, 1, 2, 3].map((index) => options?.[index]?.label ?? '');
  }

  private correctOptionIndex(options: Array<{ isCorrect?: number }> | undefined): number {
    const index = options?.findIndex((option) => option.isCorrect === 1) ?? -1;
    return index >= 0 ? index : 0;
  }

  private newRound(): DraftQuiz['rounds'][number] {
    return {
      title: 'Nouvelle manche',
      person: { name: '', options: ['', '', '', ''], correctOptionIndex: 0 },
      works: [0, 1, 2].map(() => ({
        clues: [{ kind: 'text', content: '' }],
        options: ['', '', '', ''],
        correctOptionIndex: 0,
      })),
    };
  }
}
