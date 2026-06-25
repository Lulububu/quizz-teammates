import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomeComponent } from './app/home.component';
import { JoinComponent } from './app/join.component';
import { RoomComponent } from './app/room.component';

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'rooms/:code', component: RoomComponent },
  { path: 'join/:code', component: JoinComponent },
  { path: '**', redirectTo: '' },
];

const availableThemes = ['academy', 'cosmic', 'orbit', 'arcade'] as const;
type AppTheme = typeof availableThemes[number];

async function bootstrap(): Promise<void> {
  const theme = await loadTheme();
  document.documentElement.dataset['theme'] = theme;
  await bootstrapApplication(AppComponent, {
    providers: [provideHttpClient(), provideRouter(routes)],
  });
}

async function loadTheme(): Promise<AppTheme> {
  const previewTheme = new URLSearchParams(window.location.search).get('theme');
  if (availableThemes.includes(previewTheme as AppTheme)) {
    return previewTheme as AppTheme;
  }

  try {
    const response = await fetch('/api/app/config');
    const config = await response.json() as { theme?: string };
    return availableThemes.includes(config.theme as AppTheme) ? config.theme as AppTheme : 'academy';
  } catch {
    return 'academy';
  }
}

void bootstrap().catch((error) => console.error(error));
