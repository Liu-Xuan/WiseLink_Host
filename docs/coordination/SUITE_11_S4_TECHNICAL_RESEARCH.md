# Suite 1.1 S4: Cytoscape Technical Research and Validation

**Created**: 2026-09-18  
**Purpose**: Validate Cytoscape HTML card rendering approach before full implementation

---

## 1. Research Goals

### Primary Goal
Confirm that Cytoscape can render custom HTML cards (not just styled nodes) for document/matter groups using the popper.js extension.

### Secondary Goals
- Validate performance with 50-100+ nodes
- Confirm responsive layout works with three-column design
- Test camera position save/restore
- Verify perspective switching doesn't break layout

---

## 2. Cytoscape Popper Extension

### 2.1 Installation

```bash
npm install cytoscape-popper
npm install @popperjs/core
```

Or verify already installed:
```bash
grep -E "cytoscape|popper" package.json
```

### 2.2 Basic Setup

```typescript
import Cytoscape from 'cytoscape';
import popper from 'cytoscape-popper';

// Register extension
Cytoscape.use(popper);

// Create instance
const cy = Cytoscape({
  container: document.getElementById('cy'),
  style: [/* ... */],
  elements: [/* ... */]
});
```

---

## 3. HTML Card Rendering Strategy

### 3.1 Approach: Invisible Node + HTML Overlay

Instead of trying to render HTML inside Cytoscape nodes, use **invisible nodes as anchors** for HTML overlays positioned via Popper.

```typescript
// 1. Create invisible anchor node
cy.add({
  group: 'nodes',
  data: {
    id: 'group-anchor-1',
    type: 'group-anchor'
  },
  position: { x: 100, y: 100 }
});

// 2. Create HTML card element
const cardElement = document.createElement('div');
cardElement.className = 'cytoscape-html-card';
cardElement.innerHTML = `
  <div class="card-header">
    <h3>工程文档组 1</h3>
    <span class="badge">12篇</span>
  </div>
  <div class="card-body">
    <div class="doc-item">文档A - 第3版</div>
    <div class="doc-item">文档B - 第2版</div>
    <div class="doc-item">文档C - 第5版</div>
    <div class="more">+ 9 more</div>
  </div>
`;

// 3. Position card using Popper
const anchorNode = cy.getElementById('group-anchor-1');
const popperInstance = anchorNode.popper({
  content: () => cardElement,
  popper: {
    placement: 'top',
    modifiers: [
      {
        name: 'offset',
        options: {
          offset: [0, 0]
        }
      }
    ]
  }
});

// 4. Update position on viewport changes
cy.on('pan zoom resize', () => {
  popperInstance.update();
});
```

### 3.2 Card Styling

```css
.cytoscape-html-card {
  background: var(--surface-elevated);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  width: 240px;
  max-height: 320px;
  overflow: hidden;
  pointer-events: auto; /* Enable interactions */
}

.card-header {
  padding: 12px;
  border-bottom: 1px solid var(--border-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.badge {
  background: var(--accent-sky);
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
}

.card-body {
  padding: 8px;
  max-height: 256px;
  overflow-y: auto;
}

.doc-item {
  padding: 8px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
}

.doc-item:hover {
  background: var(--surface-hover);
}

.more {
  padding: 8px;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}
```

### 3.3 Virtual Scrolling for Long Lists

When a group has 50+ documents, use virtual scrolling inside the card:

```typescript
import { FixedSizeList } from 'react-window';

function DocumentGroupCard({ documents }: { documents: Document[] }) {
  const visibleCount = 10;
  const hasMore = documents.length > visibleCount;
  
  return (
    <div className="cytoscape-html-card">
      <div className="card-header">
        <h3>工程文档组 1</h3>
        <span className="badge">{documents.length}篇</span>
      </div>
      <div className="card-body">
        {documents.length <= visibleCount ? (
          // Simple list
          documents.map(doc => (
            <div key={doc.id} className="doc-item">
              {doc.title} - 第{doc.version}版
            </div>
          ))
        ) : (
          // Virtual scrolling
          <FixedSizeList
            height={256}
            itemCount={documents.length}
            itemSize={36}
            width="100%"
          >
            {({ index, style }) => (
              <div style={style} className="doc-item">
                {documents[index].title} - 第{documents[index].version}版
              </div>
            )}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}
```

---

## 4. Edge Rendering Between Groups

### 4.1 Connect Invisible Anchors

Edges connect the invisible anchor nodes, not the HTML cards:

```typescript
cy.add({
  group: 'edges',
  data: {
    id: 'edge-1-2',
    source: 'group-anchor-1',
    target: 'group-anchor-2',
    label: '引用关系'
  }
});
```

### 4.2 Edge Styling

```typescript
const style = [
  {
    selector: 'node[type="group-anchor"]',
    style: {
      'width': 1,
      'height': 1,
      'opacity': 0, // Invisible
      'events': 'no' // No interactions
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 2,
      'line-color': 'var(--border-primary)',
      'target-arrow-color': 'var(--border-primary)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 1.2,
      'label': 'data(label)',
      'font-size': '12px',
      'text-background-color': 'var(--surface-primary)',
      'text-background-opacity': 1,
      'text-background-padding': '4px'
    }
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': 'var(--accent-sky)',
      'target-arrow-color': 'var(--accent-sky)',
      'width': 3
    }
  }
];
```

---

## 5. Layout Strategy

### 5.1 Initial Layout: Cola

Use Cola (constraint-based) layout for automatic positioning with alignment constraints:

```typescript
const layout = cy.layout({
  name: 'cola',
  animate: true,
  animationDuration: 500,
  animationEasing: 'ease-out',
  nodeSpacing: 80, // Space between cards
  edgeLength: 200, // Preferred edge length
  alignment: [
    // Align groups vertically when they share domain
    { axis: 'y', left: 'group-1', right: 'group-2', gap: 20 }
  ],
  flow: {
    axis: 'x', // Primary flow left-to-right
    minSeparation: 150
  },
  avoidOverlap: true,
  handleDisconnected: true,
  infinite: false
});

layout.run();
```

### 5.2 Manual Positioning Mode

Allow users to drag cards and save positions:

```typescript
// Enable node dragging
cy.nodes().grabify();

// Save positions on drag end
cy.on('dragfree', 'node', (event) => {
  const node = event.target;
  const position = node.position();
  
  saveNodePosition(node.id(), position);
});

// Restore saved positions
function restoreLayout(savedPositions: Record<string, { x: number; y: number }>) {
  Object.entries(savedPositions).forEach(([nodeId, position]) => {
    const node = cy.getElementById(nodeId);
    if (node) {
      node.position(position);
    }
  });
}
```

---

## 6. Camera State Management

### 6.1 Save Camera State

```typescript
interface CameraState {
  pan: { x: number; y: number };
  zoom: number;
}

function getCameraState(): CameraState {
  return {
    pan: cy.pan(),
    zoom: cy.zoom()
  };
}

function saveCameraState() {
  const state = getCameraState();
  localStorage.setItem(
    `graph-camera-${matterId}`,
    JSON.stringify(state)
  );
}

// Auto-save on viewport changes
let saveTimeout: NodeJS.Timeout;
cy.on('pan zoom', () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveCameraState, 500);
});
```

### 6.2 Restore Camera State

```typescript
function restoreCameraState() {
  const stored = localStorage.getItem(`graph-camera-${matterId}`);
  if (!stored) return;
  
  const state: CameraState = JSON.parse(stored);
  
  cy.viewport({
    zoom: state.zoom,
    pan: state.pan
  });
}

// Restore after graph loads
cy.ready(() => {
  restoreCameraState();
});
```

### 6.3 Camera Controls

```typescript
// Fit to viewport
function fitToView() {
  cy.fit(undefined, 50); // 50px padding
}

// Center on specific node
function centerOnNode(nodeId: string) {
  const node = cy.getElementById(nodeId);
  if (!node) return;
  
  cy.animate({
    center: { eles: node },
    zoom: 1.5,
    duration: 400,
    easing: 'ease-out'
  });
}

// Reset zoom
function resetZoom() {
  cy.animate({
    zoom: 1,
    duration: 300,
    easing: 'ease-out'
  });
}
```

---

## 7. Performance Optimization

### 7.1 Render Throttling

```typescript
// Only update popper positions when idle
let updateTimeout: NodeJS.Timeout;
cy.on('pan zoom', () => {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    popperInstances.forEach(p => p.update());
  }, 50); // 50ms throttle
});
```

### 7.2 Viewport Culling

Hide cards outside viewport to improve performance:

```typescript
function updateCardVisibility() {
  const extent = cy.extent();
  
  cy.nodes().forEach(node => {
    const pos = node.position();
    const visible = (
      pos.x >= extent.x1 - 200 &&
      pos.x <= extent.x2 + 200 &&
      pos.y >= extent.y1 - 200 &&
      pos.y <= extent.y2 + 200
    );
    
    const cardElement = cardMap.get(node.id());
    if (cardElement) {
      cardElement.style.display = visible ? 'block' : 'none';
    }
  });
}

cy.on('pan zoom', debounce(updateCardVisibility, 100));
```

### 7.3 Large Graph Strategy

For graphs with 100+ nodes:

1. **Progressive Loading**: Load visible nodes first
2. **Detail Levels**: Show simplified cards when zoomed out
3. **Clustering**: Group distant nodes into meta-nodes
4. **Pagination**: Limit initial nodes to 50, load more on demand

```typescript
function loadGraphProgressively(allNodes: Node[]) {
  // Phase 1: Core nodes (directly connected to current selection)
  const coreNodes = allNodes.filter(n => n.distance <= 1);
  addNodesToGraph(coreNodes);
  
  // Phase 2: Secondary nodes (distance 2)
  setTimeout(() => {
    const secondaryNodes = allNodes.filter(n => n.distance === 2);
    addNodesToGraph(secondaryNodes);
  }, 500);
  
  // Phase 3: Tertiary nodes (distance 3+)
  setTimeout(() => {
    const tertiaryNodes = allNodes.filter(n => n.distance >= 3);
    addNodesToGraph(tertiaryNodes);
  }, 1000);
}
```

---

## 8. Validation Tests

### 8.1 Test Cases

**Test 1: Basic HTML Rendering**
- [ ] Create 5 group nodes with HTML cards
- [ ] Verify cards display correctly
- [ ] Verify cards move with pan/zoom
- [ ] Verify cards don't overlap

**Test 2: Edge Connections**
- [ ] Connect groups with edges
- [ ] Verify edges render between card centers (not corners)
- [ ] Verify edge labels readable
- [ ] Verify hover/selection states work

**Test 3: Interactions**
- [ ] Click on document item inside card
- [ ] Hover document item shows tooltip
- [ ] Drag card to new position
- [ ] Select card (border highlight)

**Test 4: Large Lists**
- [ ] Create card with 50 documents
- [ ] Verify virtual scrolling works
- [ ] Verify scroll performance smooth
- [ ] Verify "show all" expands correctly

**Test 5: Performance**
- [ ] Load 50 nodes
- [ ] Measure initial render time (<2s target)
- [ ] Measure pan/zoom FPS (60fps target)
- [ ] Measure card update latency (<100ms target)

**Test 6: Camera State**
- [ ] Pan and zoom to arbitrary position
- [ ] Save state (localStorage)
- [ ] Reload page
- [ ] Verify camera restored to exact position

**Test 7: Responsive Layout**
- [ ] Resize viewport to 1024px width
- [ ] Verify cards don't overflow
- [ ] Verify three-column layout adjusts
- [ ] Verify cards reflow correctly

**Test 8: Perspective Switch**
- [ ] Load matter perspective (10 nodes)
- [ ] Switch to document perspective (30 nodes)
- [ ] Verify smooth transition
- [ ] Verify no layout explosion
- [ ] Verify camera state preserved

### 8.2 Success Criteria

✅ **Pass if**:
- All HTML cards render correctly
- Interactions work (click, hover, drag)
- Performance targets met (60fps, <2s load)
- Camera state persists across reloads
- Perspective switches smooth

❌ **Fail if**:
- Cards don't follow nodes on pan/zoom
- Significant lag with 50+ nodes
- Edges point to wrong positions
- Memory leaks on repeated perspective switches

---

## 9. Alternative Approach (If Popper Fails)

If Cytoscape popper extension doesn't work as expected, use **absolute positioning overlay**:

```typescript
// Render cards as React components in absolute-positioned divs
function GraphWithOverlayCards() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const cyRef = useRef<Cytoscape.Core>();
  
  const getCardPosition = (nodeId: string) => {
    const node = cyRef.current?.getElementById(nodeId);
    if (!node) return { x: 0, y: 0 };
    
    const renderedPos = node.renderedPosition();
    return {
      x: renderedPos.x - 120, // Center card (240px / 2)
      y: renderedPos.y - 160  // Center card (320px / 2)
    };
  };
  
  return (
    <div className="graph-container">
      <div ref={cyContainer} className="cytoscape-canvas" />
      <div className="cards-overlay">
        {nodes.map(node => {
          const pos = getCardPosition(node.id);
          return (
            <div
              key={node.id}
              className="cytoscape-html-card"
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                transform: `scale(${zoom})`
              }}
            >
              <DocumentGroupCard documents={node.documents} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Pros**: Full React component control, easier state management  
**Cons**: Need to manually sync positions on every pan/zoom

---

## 10. Next Steps After Validation

Once validation succeeds:

1. **Create Base Components**:
   - `RelationGraphPage/GraphCanvas.tsx`
   - `RelationGraphPage/DocumentGroupCard.tsx`
   - `RelationGraphPage/GraphControls.tsx`

2. **Implement Perspectives**:
   - Matter perspective (groups by matter)
   - Document perspective (groups by document family)
   - Domain perspective (groups by domain tags)
   - Panoramic perspective (all matters as meta-nodes)

3. **Integrate Timeline**:
   - Timeline ↔ graph selection sync
   - Event highlight on graph
   - Graph zoom on timeline selection

4. **State Management**:
   - Camera persistence
   - Node position persistence
   - Perspective persistence
   - Selection persistence

---

**Research Lead**: Luna  
**Review**: Astra  
**Timeline**: 1 day for validation, then proceed to S4 Phase 1
