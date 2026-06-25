import { Component, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  template: `
    <div class="app-shell">
      <header class="topbar">
        <a routerLink="/" class="brand">Quiz Teammates</a>
        @if (api.hostRoomMeta(); as room) {
          <div class="topbar-room">
            <div class="topbar-room-code">
              <span>Code</span>
              <strong>{{ room.code }}</strong>
            </div>
            @if (room.qrCodeDataUrl) {
              <img [src]="room.qrCodeDataUrl" alt="QR code pour rejoindre le salon">
            }
            <button
              type="button"
              class="secondary names-visibility"
              [class.active]="api.gameState()?.hidePlayerNames"
              [disabled]="visibilityPending()"
              (click)="togglePlayerNames(room.code)"
            >
              {{ visibilityPending()
                ? 'Mise à jour…'
                : api.gameState()?.hidePlayerNames
                  ? 'Afficher les pseudos'
                  : 'Masquer les pseudos' }}
            </button>
            <button type="button" class="secondary" (click)="copyJoinLink(room.code)">
              {{ linkCopied() ? 'Lien copié' : 'Copier le lien' }}
            </button>
          </div>
        }
      </header>
      <router-outlet />
    </div>
  `,
})
export class AppComponent {
  linkCopied = signal(false);
  visibilityPending = signal(false);

  constructor(public api: ApiService) {}

  async copyJoinLink(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
      this.linkCopied.set(true);
      window.setTimeout(() => this.linkCopied.set(false), 1800);
    } catch {
      this.linkCopied.set(false);
    }
  }

  async togglePlayerNames(code: string): Promise<void> {
    const state = this.api.gameState();
    if (!state || this.visibilityPending()) return;
    this.visibilityPending.set(true);
    try {
      await this.api.setPlayerNamesVisibility(code, !state.hidePlayerNames);
    } finally {
      this.visibilityPending.set(false);
    }
  }
}
