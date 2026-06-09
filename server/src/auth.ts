import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db.js';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const oauthClient = new OAuth2Client(googleClientId);

export function getGoogleClientId(): string {
  return googleClientId;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Connexion Google requise' });
    return;
  }

  try {
    req.adminUser = await verifyAdminToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Session Google invalide' });
  }
}

export async function verifyAdminToken(token: string): Promise<AdminUser> {
  if (!googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID doit etre configure cote serveur');
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: token,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Compte Google invalide');
  }

  const user: AdminUser = {
    id: payload.sub,
    email: payload.email,
    name: payload.name ?? '',
    picture: payload.picture ?? '',
  };
  upsertAdminUser(user);
  return user;
}

function getBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice('Bearer '.length).trim();
}

function upsertAdminUser(user: AdminUser): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO admin_users (id, email, name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_login_at = excluded.last_login_at`,
  ).run(user.id, user.email, user.name, user.picture, now, now);
}
