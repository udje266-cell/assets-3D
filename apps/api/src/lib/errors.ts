/**
 * Erreurs applicatives.
 *
 * Une `AppError` porte un code stable destiné aux clients (applications mobiles
 * et administration) : le libellé peut changer, le code non. Toute erreur qui
 * n'est pas une `AppError` est traitée comme une erreur interne et n'est jamais
 * renvoyée telle quelle au client (§12).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Authentification requise.'): AppError =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Accès refusé.'): AppError =>
  new AppError(403, 'forbidden', message);

export const notFound = (resource: string): AppError =>
  new AppError(404, 'not_found', `${resource} introuvable.`);

export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, details);

export const tooManyRequests = (message = 'Trop de tentatives, réessayez plus tard.'): AppError =>
  new AppError(429, 'too_many_requests', message);

export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);
