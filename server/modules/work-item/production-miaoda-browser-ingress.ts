import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

/**
 * The installed Miaoda middleware parses a caller-constructible header. Until
 * hosted ingress provenance is application-verifiable, no production browser
 * actor may enter object reads, ingest, parsing, or WorkItem creation.
 *
 * This internal assertion deliberately inspects no caller-controlled fields.
 */
export function assertProductionMiaodaBrowserIdentityAvailable(): never {
  throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
    code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    statusCode: 503,
    denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
  });
}

@Injectable()
export class ProductionMiaodaBrowserObjectIngressGuard
  implements CanActivate
{
  canActivate(_context: ExecutionContext): never {
    return assertProductionMiaodaBrowserIdentityAvailable();
  }
}
