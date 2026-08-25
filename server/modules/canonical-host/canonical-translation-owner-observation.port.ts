import type { CanonicalTranslationOwnerObservation } from './canonical-reader-consumption';

export interface CanonicalTranslationOwnerObservationPort {
  readonly configured: boolean;
  /**
   * Read the owner's current translation owner observation for the exact
   * document/revision. Returns null when the owner reports none; it must
   * never fabricate counts, lineage, or a product state.
   */
  readObservation(input: {
    documentId: string;
    revisionId: string;
  }): Promise<CanonicalTranslationOwnerObservation | null>;
}

export class UnconfiguredCanonicalTranslationOwnerObservationAdapter implements CanonicalTranslationOwnerObservationPort {
  readonly configured = false;

  async readObservation(_input: {
    documentId: string;
    revisionId: string;
  }): Promise<CanonicalTranslationOwnerObservation | null> {
    throw new Error('CANONICAL_TRANSLATION_OWNER_OBSERVATION_NOT_CONFIGURED');
  }
}
