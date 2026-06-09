import type { NextFunction, Request, Response } from 'express';
import { firebaseAuth } from './firebase.js';

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

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Connexion Firebase requise' });
    return;
  }

  try {
    req.adminUser = await verifyAdminToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Session Firebase invalide' });
  }
}

export async function verifyAdminToken(token: string): Promise<AdminUser> {
  const decoded = await firebaseAuth.verifyIdToken(token);
  if (!decoded.uid || !decoded.email) {
    throw new Error('Compte Firebase invalide');
  }

  return {
    id: decoded.uid,
    email: decoded.email,
    name: decoded.name ?? '',
    picture: decoded.picture ?? '',
  };
}

function getBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice('Bearer '.length).trim();
}
