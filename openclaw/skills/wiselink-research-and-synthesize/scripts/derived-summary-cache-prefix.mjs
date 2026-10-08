import { canonicalJson } from './validate-payload.mjs';

const INPUT_ORDER = ['evidence', 'members', 'classificationStatus', 'scope',
  'limitations', 'instruction'];
const MEMBER_ORDER = ['evidenceRef', 'member', 'headline', 'understanding', 'body',
  'issues', 'evidenceRefs', 'rootRefs', 'leaves', 'current', 'overviewStatus', 'limitations'];
function orderedObject(value, order, serializeField = (_key, field) => canonicalJson(field)) {
  const keys = [...order.filter(key => Object.hasOwn(value, key)),
    ...Object.keys(value).filter(key => !order.includes(key)).sort()];
  const fields = [];
  for (const key of keys) {
    const serialized = serializeField(key, value[key]);
    // Match the existing JSON projection: absent/undefined fields are not added.
    if (serialized !== undefined) fields.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${fields.join(',')}}`;
}

/** Only model INPUT layout changes. Generic identity/task hashing remains canonical.
 * Arrays, complete values and root locator paths are retained exactly. */
export function serializeDerivedSummaryCachePrefix(view) {
  return orderedObject(view, INPUT_ORDER, (key, value) => {
    if (key === 'members' && value !== undefined) {
      return `[${value.map(member => orderedObject(member, MEMBER_ORDER)).join(',')}]`;
    }
    return canonicalJson(value);
  });
}
