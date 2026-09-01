/**
 * WiseLink 3.1 applicability-fleet: property registry for Kleene asserts.
 *
 * Migrated from the mature v8 applicability property registry usage onto
 * WiseLink 3.1 FleetMasterData property names. Every assert property must be
 * registered here; unregistered properties evaluate to interpretation_unknown
 * instead of being silently guessed.
 */

export type ApplicabilityPropertyValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date';

export type ApplicabilityNormalizerName =
  | 'normalizeAircraftModel'
  | 'normalizeSbNumber'
  | 'normalizeOptionCode'
  | 'normalizePartNumber'
  | 'normalizeEquipmentModel'
  | 'normalizeIdentifier'
  | 'normalizeSoftwareVersion'
  | 'normalizeDateOnly'
  | null;

export interface ApplicabilityPropertyDefinition {
  property: string;
  valueType: ApplicabilityPropertyValueType;
  normalizer: ApplicabilityNormalizerName;
  /** When set, snapshot values are maps keyed by this normalized qualifier. */
  qualifierNormalizer: ApplicabilityNormalizerName;
  supportedOperators: string[];
  factType:
    | 'fleet_configuration'
    | 'sb_incorporation'
    | 'data_quality_issue';
}

const STRING_OPS = Object.freeze(['eq', 'neq', 'in', 'not_in']);
const NUMBER_OPS = Object.freeze([
  'eq',
  'neq',
  'in',
  'not_in',
  'range',
  'gte',
  'lte',
]);
const BOOLEAN_OPS = Object.freeze(['eq', 'neq']);

const REGISTRY: ApplicabilityPropertyDefinition[] = [
  {
    property: 'model',
    valueType: 'string',
    normalizer: 'normalizeAircraftModel',
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'data_quality_issue',
  },
  {
    property: 'fleetFamily',
    valueType: 'string',
    normalizer: null,
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'series',
    valueType: 'string',
    normalizer: null,
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'tailNumber',
    valueType: 'string',
    normalizer: 'normalizeIdentifier',
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'registrationNumber',
    valueType: 'string',
    normalizer: 'normalizeIdentifier',
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'operatorCode',
    valueType: 'string',
    normalizer: 'normalizeIdentifier',
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'variableNumber',
    valueType: 'string',
    normalizer: 'normalizeIdentifier',
    qualifierNormalizer: null,
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'msn',
    valueType: 'number',
    normalizer: null,
    qualifierNormalizer: null,
    supportedOperators: [...NUMBER_OPS],
    factType: 'data_quality_issue',
  },
  {
    property: 'lineNumber',
    valueType: 'number',
    normalizer: null,
    qualifierNormalizer: null,
    supportedOperators: [...NUMBER_OPS],
    factType: 'data_quality_issue',
  },
  {
    property: 'deliveryDate',
    valueType: 'date',
    normalizer: 'normalizeDateOnly',
    qualifierNormalizer: null,
    supportedOperators: [...NUMBER_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'sbIncorporated',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeSbNumber',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'sb_incorporation',
  },
  {
    property: 'optionInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeOptionCode',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'pnInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizePartNumber',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'equipmentModelInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeEquipmentModel',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'componentPartNumberInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizePartNumber',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'componentSerialNumberInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'equipmentNumberInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'finPositionOccupied',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'softwarePartNumberInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizePartNumber',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'softwareSerialNumberInstalled',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'softwareVersion',
    valueType: 'string',
    normalizer: 'normalizeSoftwareVersion',
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...STRING_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'modificationEmbodied',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
  {
    property: 'repairPresent',
    valueType: 'boolean',
    normalizer: null,
    qualifierNormalizer: 'normalizeIdentifier',
    supportedOperators: [...BOOLEAN_OPS],
    factType: 'fleet_configuration',
  },
];

export function getRegistry(): {
  properties: ApplicabilityPropertyDefinition[];
} {
  return { properties: REGISTRY };
}
