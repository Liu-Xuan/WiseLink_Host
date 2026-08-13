import { Injectable } from '@nestjs/common';

import type { DocumentManagementIngestAuthorizer } from '../document-management/src/hosted/nest';

export const PHASE2D_VALIDATION_ROLE = '__wiselink_phase2d_validation__';

function deny(reason: string): never {
  throw Object.assign(
    new Error('Document Management Phase 2D validation action is disabled.'),
    {
      code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
      statusCode: 403,
      details: { reason },
    },
  );
}

@Injectable()
// Bound through DocumentManagementHostedModule.register(); static lint cannot
// follow the provider supplied to a DynamicModule.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class Phase2dValidationAuthorizer
implements DocumentManagementIngestAuthorizer {
  async assertCanIngest(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_INGEST';
  }): Promise<void> {
    this.assertValidationContext(input, 'DOCUMENT_INGEST');
  }

  async assertCanRead(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_READ';
  }): Promise<void> {
    this.assertValidationContext(input, 'DOCUMENT_READ');
  }

  private assertValidationContext(
    input: { actorUserId: string; tenantId: string; roles: string[] },
    action: 'DOCUMENT_INGEST' | 'DOCUMENT_READ',
  ): void {
    if (process.env.WL_DM_PHASE2D_VALIDATION_ENABLED !== 'true') {
      deny('VALIDATION_WINDOW_DISABLED');
    }
    if (!process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID?.trim()) {
      deny('VALIDATION_RUN_ID_MISSING');
    }
    if (!input.actorUserId || !input.tenantId) {
      deny('AUTHENTICATED_CONTEXT_MISSING');
    }
    if (!input.roles.includes(PHASE2D_VALIDATION_ROLE)) {
      deny(`SERVER_VALIDATION_ROLE_MISSING:${action}`);
    }
  }
}
