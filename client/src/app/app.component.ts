import { Component, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';
import { IconComponent } from './icon.component';
import { CopyJoinLinkComponent } from './copy-join-link.component';
import { DismissPopoverDirective } from './dismiss-popover.directive';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet, IconComponent, CopyJoinLinkComponent, DismissPopoverDirective],
  template: `
    <div class="app-shell" [class.game-shell]="gameView()" [class.player-shell-layout]="playerView()">
      @if (!playerView()) {
        <header class="topbar">
          <a routerLink="/" class="brand"><app-icon name="copy" [size]="26" /> Quiz Teammates</a>
          @if (api.hostRoomMeta(); as room) {
            @if (api.gameState()?.status !== 'finished') {
              <div class="topbar-room">
                @if (api.gameState()?.status !== 'lobby') {
                  <div class="topbar-room-code"><span>Code</span><strong>{{ room.code }}</strong></div>
                }
                <details class="room-share" appDismissPopover>
                  <summary class="icon-button" aria-label="Afficher le QR code" title="Afficher le QR code"><app-icon name="qr" /></summary>
                  <div class="share-popover">
                    @if (room.qrCodeDataUrl) { <img [src]="room.qrCodeDataUrl" alt="QR code pour rejoindre la partie"> }
                    <strong>{{ room.code }}</strong>
                    <app-copy-join-link [code]="room.code" />
                  </div>
                </details>
                <button type="button" class="secondary names-visibility" [class.active]="api.gameState()?.hidePlayerNames"
                  [disabled]="visibilityPending()" [attr.aria-pressed]="api.gameState()?.hidePlayerNames"
                  [title]="api.gameState()?.hidePlayerNames ? 'Afficher les pseudos' : 'Masquer les pseudos'"
                  (click)="togglePlayerNames(room.code)">
                  <app-icon [name]="api.gameState()?.hidePlayerNames ? 'eye-off' : 'eye'" />
                  <span>{{ visibilityPending() ? 'Mise à jour…' : api.gameState()?.hidePlayerNames ? 'Pseudos masqués' : 'Pseudos visibles' }}</span>
                </button>
              </div>
            } @else {
              <a routerLink="/" class="icon-button" title="Retour aux quiz" aria-label="Retour aux quiz"><app-icon name="arrow-right" /></a>
            }
          }
        </header>
      }
      <router-outlet />
    </div>
  `,
})
export class AppComponent {
  visibilityPending = signal(false);
  gameView = signal(this.isGamePath(window.location.pathname));
  playerView = signal(window.location.pathname.startsWith('/join/'));

  constructor(public api: ApiService, router: Router) {
    router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (!(event instanceof NavigationEnd)) return;
      this.gameView.set(this.isGamePath(event.urlAfterRedirects));
      this.playerView.set(event.urlAfterRedirects.startsWith('/join/'));
    });
  }

  private isGamePath(path: string): boolean {
    return path.startsWith('/rooms/') || path.startsWith('/join/');
  }

  async togglePlayerNames(code: string): Promise<void> {
    const state = this.api.gameState();
    if (!state || this.visibilityPending()) return;
    this.visibilityPending.set(true);
    try { await this.api.setPlayerNamesVisibility(code, !state.hidePlayerNames); }
    finally { this.visibilityPending.set(false); }
  }
}
