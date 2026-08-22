import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import {
  IDENTITY_VERIFICATION,
  type IdentityVerificationPort,
} from './identity-verification.port';
import type { WhoamiObjectAccessProbe, WhoamiResponse } from './identity.types';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalActorContext,
  type CanonicalObjectAccessInput,
  type CanonicalObjectAccessPort,
  unavailableServiceActorContext,
} from '../work-item/canonical-object-access.port';

/**
 * DEV/UAT whoami seam. Returns the unverified Miaoda gateway context
 * alongside a `null` verified identity and a live object-access probe.
 *
 * The probe constructs a CanonicalActorContext from the gateway header
 * (always UNAVAILABLE in G0 because the header is caller-constructible)
 * and submits it to the real CanonicalObjectAccessPort. This proves the
 * identity → object-access seam is wired and fail-closed — the 503 comes
 * from the production adapter, not a hard-coded constant.
 *
 * This endpoint is NOT an object-access route and does not carry
 * `ProductionMiaodaBrowserObjectIngressGuard`. The probe uses a synthetic
 * READ_WORK_ITEM action on a zero-id work item; no real object I/O
 * occurs because the actor is UNAVAILABLE and the adapter returns 503
 * before any repository query.
 */
@NeedLogin()
@Controller('api/identity')
export class WhoamiController {
  constructor(
    @Inject(IDENTITY_VERIFICATION)
    private readonly identityVerification: IdentityVerificationPort,
    @Optional()
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess?: CanonicalObjectAccessPort,
  ) {}

  @Get('whoami')
  async whoami(@Req() httpRequest: Request): Promise<WhoamiResponse> {
    const context = httpRequest.userContext;
    const claimedUserId = context?.userId ?? null;
    const claimedTenantId = context?.tenantId ? String(context.tenantId) : null;

    // System/bot accounts are never eligible for identity verification —
    // they cannot be cast into a final user even if a future adapter is
    // wired. The Miaoda gateway context is caller-constructible, so
    // isSystemAccount merely reflects the unverified header claim.
    const isSystemAccount = context?.isSystemAccount === true;

    const result =
      claimedUserId && !isSystemAccount
        ? await this.identityVerification.verify({
            contextUserId: claimedUserId,
            contextTenantId: claimedTenantId ?? '',
          })
        : null;

    const verifiedIdentity =
      result?.kind === 'VERIFIED'
        ? {
            provenance: result.identity.provenance,
            miaodaUserId: result.identity.miaodaUserId,
            tenantId: result.identity.tenantId,
            feishuUserId: result.identity.feishuUserId,
            feishuOpenId: result.identity.feishuOpenId,
            namespacedSubject: result.identity.namespacedSubject,
            verifiedAt: result.identity.verifiedAt,
          }
        : null;

    // ── Live object-access probe ──────────────────────────────────
    // Build the ActorContext that the production object-access router
    // would receive. In G0 no verified identity can be resolved from the
    // caller-constructible gateway header, so the actor is always
    // UNAVAILABLE. We submit it to the real port to prove the seam is
    // wired and the denial comes from the adapter, not a constant.
    const actor: CanonicalActorContext = unavailableServiceActorContext();

    const probe = await this.probeObjectAccess(actor);

    return {
      verifiedIdentity,
      claimedContext: {
        miaodaUserId: claimedUserId,
        tenantId: claimedTenantId,
        appId: context?.appId ?? null,
        env: context?.env ?? null,
        roles: [...(context?.roles ?? [])],
        isSystemAccount,
      },
      objectAccessProbe: probe,
      objectAccessStatus: 'UNAVAILABLE_503',
      session: null,
    };
  }

  /**
   * Submit the actor to the real CanonicalObjectAccessPort with a
   * synthetic READ_WORK_ITEM action. No real object I/O occurs because
   * the UNAVAILABLE actor causes the adapter to return 503 immediately.
   */
  private async probeObjectAccess(
    actor: CanonicalActorContext,
  ): Promise<WhoamiObjectAccessProbe> {
    if (!this.objectAccess) {
      return {
        actorKind: actor.principalKind,
        unavailableReason:
          actor.principalKind === 'UNAVAILABLE'
            ? actor.unavailableReason
            : null,
        accessResult: null,
      };
    }

    const input: CanonicalObjectAccessInput = {
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'whoami-probe' },
    };

    const accessResult = await this.objectAccess.freshRead(input);

    // Narrow the union before accessing denial-only fields. The probe
    // contract (WhoamiObjectAccessProbe) only represents a 503 denial;
    // a non-503 denial from an UNAVAILABLE-actor probe is unexpected
    // and reported as null (fail-closed).
    let denial: WhoamiObjectAccessProbe['accessResult'] = null;
    if (accessResult.allowed === false && accessResult.statusCode === 503) {
      denial = {
        allowed: false,
        code: accessResult.code,
        statusCode: accessResult.statusCode,
        denialSource: accessResult.denialSource,
      };
    }

    return {
      actorKind: actor.principalKind,
      unavailableReason:
        actor.principalKind === 'UNAVAILABLE' ? actor.unavailableReason : null,
      accessResult: denial,
    };
  }
}
