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

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideRouter(routes)],
}).catch((error) => console.error(error));
