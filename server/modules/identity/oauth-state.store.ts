import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { IdentityRepository } from './identity.repository';

@Injectable()
export class OauthStateStore {
  private static readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly repository: IdentityRepository) {}

  async issue(codeVerifier: string): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    await this.repository.issueOauthState({
      stateHash: digest(state),
      codeVerifier,
      expiresAt: new Date(Date.now() + OauthStateStore.TTL_MS),
    });
    return state;
  }

  async consume(state: string): Promise<{ codeVerifier: string } | null> {
    if (!state || state.trim().length === 0) return null;
    return this.repository.consumeOauthState(digest(state), new Date());
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
