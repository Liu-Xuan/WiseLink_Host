import { Injectable } from '@nestjs/common';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { TdmsBrowserSourceAuthorization } from './tdms-browser-source-authorization';
import type {
  TdmsAction, TdmsImportMemberClaims, TdmsPublicActor,
  TdmsSourceAuthorization, TdmsSourceScope,
} from './tdms-source.types';

/** Receiver imports use the existing verified Native session; reads keep the current browser/DM fences. */
@Injectable()
export class TdmsReceiverSourceAuthorization implements TdmsSourceAuthorization {
  readonly available = true;
  constructor(
    private readonly imports: MiaodaTdmsSourceAuthorization,
    private readonly reads: TdmsBrowserSourceAuthorization,
    private readonly sessions: SessionResolver,
  ) {}
  catalogue(actor: TdmsPublicActor, context: TdmsReadContext) {
    return this.reads.catalogue(actor, context);
  }
  authorize(actor: TdmsPublicActor, scope: TdmsSourceScope, action: TdmsAction, context: TdmsReadContext) {
    return action === 'IMPORT'
      ? this.sessions.withVerifiedNativeBrowserSql(() => this.imports.authorize(actor, scope, action, context))
      : this.reads.authorize(actor, scope, action, context);
  }
  authorizeImport(actor: TdmsPublicActor, scope: TdmsSourceScope, claims: TdmsImportMemberClaims) {
    return this.sessions.withVerifiedNativeBrowserSql(() => this.imports.authorizeImport(actor, scope, claims));
  }
  authorizeReadMembers(actor: TdmsPublicActor, scope: TdmsSourceScope,
    action: 'READ_RECORD' | 'READ_HISTORY', claims: TdmsImportMemberClaims) {
    return this.reads.authorizeReadMembers(actor, scope, action, claims);
  }
}
