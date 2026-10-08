import { Component, Input, OnDestroy, signal } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-copy-join-link',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button type="button" class="secondary" (click)="copy()" [disabled]="pending()" [class.is-loading]="pending()">
      <app-icon [name]="copied() ? 'check' : 'link'" /> {{ pending() ? 'Copie…' : copied() ? 'Lien copié' : 'Copier le lien' }}
    </button>
    <span class="sr-only" role="status">{{ copied() ? 'Lien copié dans le presse-papiers.' : '' }}</span>
    @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
  `,
  styles: [`:host { display: grid; gap: 6px; min-width: 0; } p { margin: 0; max-width: 260px; }`],
})
export class CopyJoinLinkComponent implements OnDestroy {
  @Input({ required: true }) code = '';
  pending = signal(false);
  copied = signal(false);
  error = signal('');
  private resetTimer?: number;

  async copy(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    try {
      await navigator.clipboard.writeText(window.location.origin + '/join/' + this.code);
      this.copied.set(true);
      window.clearTimeout(this.resetTimer);
      this.resetTimer = window.setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
      this.error.set('Copie impossible. Réessayez ou partagez le code de la partie.');
    } finally { this.pending.set(false); }
  }

  ngOnDestroy(): void { window.clearTimeout(this.resetTimer); }
}
