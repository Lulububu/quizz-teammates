import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

type SearchEntry = {
  label: string;
  normalized: string;
};

@Component({
  selector: 'app-answer-search',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="autocomplete">
      <label>
        {{ label }}
        <input
          [ngModel]="query"
          (ngModelChange)="updateQuery($event)"
          [placeholder]="placeholder"
          [disabled]="disabled"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="filteredSuggestions.length > 0"
          (keydown)="handleKey($event)"
        >
      </label>

      @if (filteredSuggestions.length > 0 && !selectedValue) {
        <div class="suggestion-list" role="listbox">
          @for (suggestion of filteredSuggestions; track suggestion; let index = $index) {
            <button
              type="button"
              role="option"
              [class.active]="activeIndex === index"
              [attr.aria-selected]="activeIndex === index"
              [disabled]="disabled"
              (click)="selectSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          }
        </div>
      }

      @if (query.trim().length >= minimumCharacters && filteredSuggestions.length === 0 && !selectedValue) {
        <p class="search-empty">Aucun résultat pour cette recherche.</p>
      }

      @if (selectedValue) {
        <div class="selected-search-answer">
          <span>Réponse sélectionnée</span>
          <strong>{{ selectedValue }}</strong>
          <button type="button" class="secondary" [disabled]="disabled" (click)="clear()">Modifier</button>
        </div>
      }
    </div>
  `,
})
export class AnswerSearchComponent implements OnChanges {
  @Input() values: string[] = [];
  @Input() value = '';
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
    if (changes['value'] && this.value !== this.selectedValue) {
      this.selectedValue = this.value;
      this.query = this.value;
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
  }

  selectSuggestion(suggestion: string): void {
    this.selectedValue = suggestion;
    this.query = suggestion;
    this.filteredSuggestions = [];
    this.activeIndex = 0;
    this.valueChange.emit(suggestion);
  }

  clear(): void {
    this.selectedValue = '';
    this.query = '';
    this.filteredSuggestions = [];
    this.activeIndex = 0;
    this.valueChange.emit('');
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
