/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from 'http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;

// credentials are one token68 word encoded in base64
const AUTH_HEADER_RE = /^ *(?i:Basic) +(?<credentials>[A-Za-z0-9._~+/-]+=*) *$/;
// user-id and password are separated by a colon, and may not contain control characters
const USER_PASS_RE = /^(?<username>[^\x00-\x1F\x7F]*?):(?<password>[^\x00-\x1F\x7F]*)$/u;

/** Escape for use inside a quoted-string in HTTP header parameters (RFC 7230 §3.2.6: backslash escapes next octet). */
function escapeQS(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Extracts the username and password from the authorization header.
 * @param headers - The HTTP headers to extract the authorization header from.
 * @returns The username and password from the authorization header.
 * @throws {Error} If the authorization header is not a valid Basic Authorization header or if the credentials are malformed.
 */
function getBasicAuthCredentials(headers: Record<string, string>): { username: string; password: string } {
  const header = headers.authorization ?? '';
  const match = header.match(AUTH_HEADER_RE);
  if (!match) throw new Error('Not a valid Basic Authorization header');
  const { credentials } = match.groups!;
  const userPass = Buffer.from(credentials ?? '', 'base64')
    .toString()
    .match(USER_PASS_RE);
  if (!userPass) throw new Error('Malformed credentials in Basic Authorization header');
  const { username, password } = userPass.groups!;
  return { username, password };
}

/**
 * Creates middleware that authenticates a single username and password using HTTP Basic Authentication.
 *
 * @param username - The valid username. (Can't contain colons.)
 * @param password - The valid password.
 * @param realm - Sent in the authentication challenge to identify the site.
 */
export function basicAuthSingleUser(username: string, password: string, realm: string = 'Secure Area'): Middleware {
  return (req: IncomingMessage, res: ServerResponse, next) => {
    let credentials: { username: string; password: string };
    try {
      credentials = getBasicAuthCredentials(req.headers as Record<string, string>);
    } catch {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', `Basic realm="${escapeQS(realm)}"`);
      res.end('Authorization required');
      return;
    }
    if (username !== credentials.username || password !== credentials.password) {
      res.statusCode = 403;
      res.setHeader('WWW-Authenticate', `Basic realm="${escapeQS(realm)}"`);
      res.end('Access denied');
      return;
    }
    next();
  };
}
