import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from './icon.component';

let searchSequence = 0;

type SearchEntry = {
  label: string;
  normalized: string;
};

@Component({
  selector: 'app-answer-search',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="autocomplete">
      @if (!selectedValue) {
      <label [for]="inputId">{{ label }}</label>
      <div class="search-input-wrap">
        <app-icon name="search" />
        <input
          #searchInput
          [id]="inputId"
          [ngModel]="query"
          (ngModelChange)="updateQuery($event)"
          [placeholder]="placeholder"
          [disabled]="disabled"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="filteredSuggestions.length > 0 && !selectedValue"
          [attr.aria-controls]="inputId + '-list'"
          [attr.aria-activedescendant]="filteredSuggestions.length ? inputId + '-option-' + activeIndex : null"
          (keydown)="handleKey($event)"
        >
      </div>
      }

      @if (filteredSuggestions.length > 0 && !selectedValue) {
        <div class="suggestion-list" role="listbox" [id]="inputId + '-list'" [attr.aria-label]="label">
          @for (suggestion of filteredSuggestions; track suggestion; let index = $index) {
            <button
              type="button"
              role="option"
              [id]="inputId + '-option-' + index"
              [class.active]="activeIndex === index"
              [attr.aria-selected]="activeIndex === index"
              [disabled]="disabled"
              [title]="suggestion"
              (click)="selectSuggestion(suggestion)"
            >
              <span class="suggestion-label">{{ suggestion }}</span>
            </button>
          }
        </div>
      }

      @if (query.trim().length >= minimumCharacters && filteredSuggestions.length === 0 && !selectedValue) {
        <p class="search-empty">Aucun résultat pour cette recherche.</p>
      }

      @if (selectedValue) {
        <div class="selected-search-answer">
          <app-icon name="check" />
          <div><span>{{ label }}</span><strong>{{ selectedValue }}</strong></div>
          <button #editSelection type="button" class="secondary icon-button" title="Modifier la réponse" aria-label="Modifier la réponse" [disabled]="disabled" (click)="clear()"><app-icon name="pencil" /></button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { min-width: 0; }
    .suggestion-list { display: flex; flex-direction: column; align-items: stretch; overflow-x: hidden; }
    .suggestion-list button { flex: 0 0 auto; width: 100%; min-width: 0; height: auto; }
    .suggestion-label, .selected-search-answer strong {
      display: block; white-space: normal; overflow-wrap: anywhere; word-break: normal;
      overflow: visible; text-overflow: clip; -webkit-line-clamp: unset;
    }
  `],
})
export class AnswerSearchComponent implements OnChanges {
  readonly inputId = 'answer-search-' + ++searchSequence;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('editSelection') editSelection?: ElementRef<HTMLButtonElement>;
  @Input() values: string[] = [];
  @Input() value = '';
  @Input() resetKey = '';
  @Input() label = 'Rechercher une réponse';
  @Input() placeholder = 'Saisissez au moins 2 caractères';
  @Input() disabled = false;
  @Input() minimumCharacters = 2;
  @Output() valueChange = new EventEmitter<string>();

  query = '';
  selectedValue = '';
  filteredSuggestions: string[] = [];
  activeIndex = 0;
  private searchIndex: SearchEntry[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['values']) {
      this.searchIndex = this.values.map((label) => ({ label, normalized: normalize(label) }));
      this.refreshSuggestions();
    }
    if (changes['resetKey'] || (changes['value'] && this.value !== this.selectedValue)) {
      this.selectedValue = this.value;
      this.query = this.value;
      this.activeIndex = 0;
      this.refreshSuggestions();
    }
  }

  updateQuery(value: string): void {
    this.query = value;
    if (value !== this.selectedValue) {
      this.selectedValue = '';
      this.valueChange.emit('');
    }
    this.activeIndex = 0;
    this.refreshSuggestions();
  }

  handleKey(event: KeyboardEvent): void {
    if (this.disabled) return;
    if (!this.filteredSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = Math.min(this.filteredSuggestions.length - 1, this.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = Math.max(0, this.activeIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.selectSuggestion(this.filteredSuggestions[this.activeIndex]);
    } else if (event.key === 'Escape') {
      this.clear();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      document.getElementById(this.inputId + '-option-' + this.activeIndex)?.scrollIntoView({ block: 'nearest' });
    }
  }

  selectSuggestion(suggestion: string): void {
    if (this.disabled) return;
    this.selectedValue = suggestion;
    this.query = suggestion;
    this.filteredSuggestions = [];
    this.activeIndex = 0;
    this.valueChange.emit(suggestion);
    window.setTimeout(() => this.editSelection?.nativeElement.focus({ preventScroll: true }));
  }

  clear(): void {
    this.selectedValue = '';
    this.query = '';
    this.filteredSuggestions = [];
    this.activeIndex = 0;
    this.valueChange.emit('');
    window.setTimeout(() => this.searchInput?.nativeElement.focus());
  }

  private refreshSuggestions(): void {
    const query = normalize(this.query);
    if (query.length < this.minimumCharacters || this.selectedValue) {
      this.filteredSuggestions = [];
      return;
    }
    const startsWith: string[] = [];
    const contains: string[] = [];
    for (const entry of this.searchIndex) {
      if (entry.normalized.startsWith(query)) startsWith.push(entry.label);
      else if (contains.length < 8 && entry.normalized.includes(query)) contains.push(entry.label);
      if (startsWith.length >= 8) break;
    }
    this.filteredSuggestions = [...startsWith, ...contains].slice(0, 8);
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
