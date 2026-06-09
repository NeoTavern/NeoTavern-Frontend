import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { basicAuthSingleUser, type Middleware } from './web-middleware.ts';

export class BasicAuthPlugin implements Plugin {
  name = 'basic-auth';
  middleware: Middleware;
  protected username: string;
  protected password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
    this.middleware = basicAuthSingleUser(this.username, this.password);
  }

  configureServer(server: ViteDevServer) {
    server.middlewares.use(this.middleware);
  }

  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(this.middleware);
  }
}
