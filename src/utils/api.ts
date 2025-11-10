import { token } from '../stores/auth.store';

export function getRequestHeaders({ omitContentType = false } = {}) {
  const tokenValue = token.get();
  if (!tokenValue) {
    throw new Error('CSRF token is not set');
  }

  const headers: {
    'Content-Type'?: string;
    'X-CSRF-Token': string;
  } = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': tokenValue,
  };

  if (omitContentType) {
    delete headers['Content-Type'];
  }

  return headers;
}
