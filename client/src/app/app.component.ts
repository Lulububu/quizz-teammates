import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  template: `
    <div class="app-shell">
      <header class="topbar">
        <a routerLink="/" class="brand">Quiz Teammates</a>
      </header>
      <router-outlet />
    </div>
  `,
})
export class AppComponent {}
