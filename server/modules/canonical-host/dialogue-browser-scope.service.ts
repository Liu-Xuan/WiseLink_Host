import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionResolver } from '../identity/session-resolver.service';

/** Hosted native browser scope; external OAuth remains a separate delegation. */
@Injectable()
export class DialogueBrowserScope {
  constructor(private readonly sessions: SessionResolver) {}

  /** Read through platform authenticated SQL with the original native actor. */
  async runRead<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.sessions.withNativeBrowserIdentity(request, () =>
      this.sessions.withVerifiedNativeBrowserSql(operation),
    );
  }

  /** Browser-owned ReviewAction writes use the real actor's SQL role and RLS. */
  async runNativeWrite<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.sessions.withNativeBrowserIdentity(request, () =>
      this.sessions.withVerifiedNativeBrowserSql(operation),
    );
  }

  /** Internal browser mutation; the called service must check its fresh grant. */
  async run<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.sessions.withNativeBrowserIdentity(request, () =>
      this.sessions.withVerifiedNativeBrowserServiceSql(operation),
    );
  }

  /** Legacy OAuth-authorized mutation requiring the original request session ALS. */
  async runOAuth<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.sessions.withRequestSession(request, () =>
      this.sessions.withVerifiedBrowserSql(operation),
    );
  }
}
