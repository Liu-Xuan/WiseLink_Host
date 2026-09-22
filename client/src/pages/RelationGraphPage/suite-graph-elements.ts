import type { Core, ElementDefinition } from 'cytoscape';
import type { CytoscapeSuiteElement } from './suite-graph-model';

const idOf = (element: CytoscapeSuiteElement) => String(element.data.id);
const replaced = (before: CytoscapeSuiteElement, after: CytoscapeSuiteElement) =>
  before.group !== after.group || (after.group === 'edges'
    && (before.data.source !== after.data.source || before.data.target !== after.data.target));

/** Reconcile declared data without replacing stable objects or dragged positions. */
export function reconcileSuiteGraphElements(
  cy: Core, previous: CytoscapeSuiteElement[], next: CytoscapeSuiteElement[], beforeLayout: () => void,
) {
  const prior = new Map(previous.map((element) => [idOf(element), element]));
  const incoming = new Map(next.map((element) => [idOf(element), element]));
  const removed = previous.filter((element) => !incoming.has(idOf(element))
    || replaced(element, incoming.get(idOf(element))!));
  const moved = new Set(next.filter((element) => {
    const before = prior.get(idOf(element));
    return element.group === 'nodes' && before?.group === 'nodes'
      && (before.position.x !== element.position.x || before.position.y !== element.position.y);
  }).map(idOf));
  const layoutRequired = removed.length > 0 || moved.size > 0 || next.some((element) => {
    const before = prior.get(idOf(element));
    return !before || replaced(before, element) || (element.group === 'nodes'
      && (before.data.w !== element.data.w || before.data.h !== element.data.h));
  });
  if (layoutRequired) beforeLayout();
  const positions: Record<string, { x: number; y: number }> = {};
  cy.batch(() => {
    // Removing a node also removes incident edges; add missing nodes before edges.
    removed.forEach((element) => cy.getElementById(idOf(element)).remove());
    for (const group of ['nodes', 'edges']) {
      next.filter((element) => element.group === group).forEach((element) => {
        const id = idOf(element);
        let live = cy.getElementById(id);
        const before = prior.get(id);
        if (!live.length) {
          const definition: ElementDefinition = element.group === 'nodes'
            ? { ...element, data: { ...element.data }, position: { ...element.position } }
            : { ...element, data: { ...element.data } };
          live = cy.add(definition);
        } else if (before) {
          Object.keys(before.data).filter((key) => !(key in element.data)).forEach((key) => live.removeData(key));
          Object.entries(element.data).forEach(([key, value]) => {
            if (!Object.is(before.data[key], value)) live.data(key, value);
          });
          if (before.classes !== element.classes) {
            if (before.classes) live.removeClass(before.classes);
            if (element.classes) live.addClass(element.classes);
          }
          if (element.group === 'nodes' && before.group === 'nodes') {
            if (element.grabbable !== before.grabbable) {
              if (element.grabbable === false) live.ungrabify(); else live.grabify();
            }
            if (element.selectable !== before.selectable) {
              if (element.selectable === false) live.unselectify(); else live.selectify();
            }
          }
        }
        if (element.group === 'nodes') positions[id] = moved.has(id) ? { ...element.position } : { ...live.position() };
      });
    }
  });
  return { layoutRequired, positions };
}
