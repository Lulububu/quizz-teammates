import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { LOCALE_ID } from '@angular/core';
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

const availableThemes = ['studio', 'academy', 'cosmic', 'orbit', 'arcade'] as const;
type AppTheme = typeof availableThemes[number];

async function bootstrap(): Promise<void> {
  registerLocaleData(localeFr);
  const theme = await loadTheme();
  document.documentElement.dataset['theme'] = theme;
  await bootstrapApplication(AppComponent, {
    providers: [provideHttpClient(), provideRouter(routes), { provide: LOCALE_ID, useValue: 'fr' }],
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
    return availableThemes.includes(config.theme as AppTheme) ? config.theme as AppTheme : 'studio';
  } catch {
    return 'studio';
  }
}

void bootstrap().catch((error) => console.error(error));
