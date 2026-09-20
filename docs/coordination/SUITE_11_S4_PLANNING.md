# Suite 1.1 S4: Graph and Timeline Implementation Plan

**Created**: 2026-09-18  
**Status**: Planning  
**Dependencies**: S0-S3 completed and committed

---

## 1. Overview

S4 is the most complex phase of Suite 1.1, requiring a complete refactoring of the relationship graph page into a three-column layout with integrated timeline, Cytoscape HTML card rendering, and four perspective switches.

**Timeline**: 7-10 days  
**Priority**: High - Core feature of WiseLink Suite

---

## 2. Key Requirements

### 2.1 Three-Column Layout

```
┌─────────────┬──────────────────────┬─────────────┐
│  Timeline   │    Graph Canvas      │  Knowledge  │
│  (Events)   │  (Cytoscape + HTML)  │  (Wiki)     │
│             │                       │             │
│  - Events   │  - Center matter     │  - Context  │
│  - Ranges   │  - Grouped cards     │  - Sources  │
│  - Filter   │  - Relationships     │  - Details  │
│             │  - 4 perspectives    │             │
└─────────────┴──────────────────────┴─────────────┘
```

**Desktop (1672px+)**: All three columns visible  
**Tablet (1024-1671px)**: Two columns, toggle third  
**Mobile (390-1023px)**: Single active pane with tabs

---

### 2.2 Graph Canvas Requirements

**HTML Card Rendering**:
- NOT pure Cytoscape nodes - grouped HTML cards
- Center matter card with image or placeholder
- Grouped relationship cards (4-6 groups based on actual data)
- Multi-line text, semantic colors, soft materials

**Four Perspectives**:
1. **Matter Graph**: Focus on selected matter relationships
2. **Engineering Document**: Document-centric view
3. **Domain Focus**: ATA metadata annotations (PENDING_REVIEW observations)
4. **Panoramic Directory**: Paginated all-matters view

**Interaction**:
- Aggregated/individual relationship toggle
- Filter by group
- Zoom/pan/fit/reset camera
- Selection highlighting
- Overflow list with keyboard navigation
- Camera position restoration on return

---

### 2.3 Timeline Integration

**Left Panel**:
- Engineering timeline events
- Event categories/ranges
- Occurred vs acquired time distinction
- Predicted history tracking

**Timeline ↔ Graph Sync**:
- Select event → highlight related node
- Select node → show related events
- Navigate to full timeline page
- Return preserves camera/selection/filters

---

### 2.4 Right Panel Knowledge

**Content**:
- Engineering knowledge encyclopedia
- Source materials
- Discussion/review records
- Current understanding
- Recognition changes
- Key evidence

**Behavior**:
- Default: matter-level context
- Select node → load that object's explanation
- Preserve scroll position on node switch
- Return to matter context

---

## 3. Technical Implementation

### 3.1 Component Structure

```
RelationGraphPage/
├── index.tsx                 # Main layout orchestrator
├── GraphHeader.tsx           # Title, matter info, perspective switcher
├── TimelinePanel.tsx         # Left: events, filters, ranges
├── GraphCanvas.tsx           # Center: Cytoscape + HTML rendering
├── KnowledgePanel.tsx        # Right: Wiki-style knowledge display
├── GraphControls.tsx         # Zoom, pan, fit, filter, view options
├── OverflowList.tsx          # Off-screen nodes list
├── PerspectiveSwitcher.tsx   # 4 perspective tabs
└── relation-graph.css        # Complete styles (~1500 lines)
```

### 3.2 Cytoscape HTML Integration

**Approach**: Use Cytoscape's `popper.js` extension for HTML overlays

```typescript
// Group card rendering
cy.nodes().forEach(node => {
  const popper = node.popper({
    content: () => {
      const div = document.createElement('div');
      div.className = 'graph-card';
      div.innerHTML = `
        <div class="card-header">${node.data('title')}</div>
        <div class="card-body">${node.data('description')}</div>
      `;
      return div;
    },
    popper: {
      placement: 'top',
      modifiers: [/* ... */]
    }
  });
});
```

**Performance**: 
- Render HTML cards only for visible nodes
- Use virtual scrolling for overflow list
- Debounce camera updates
- Release resources on unmount

---

### 3.3 Four Perspectives Data Flow

#### 3.3.1 Matter Graph (Default)
```typescript
GET /api/canonical-host/matters/:matterId/graph
Response: {
  center: MatterNode,
  groups: [
    {
      id: 'objects',
      title: '对象与构型',
      nodes: [...],
      edges: [...]
    },
    // ... other groups
  ]
}
```

#### 3.3.2 Engineering Document
```typescript
// Reuse existing suiteDocumentPerspective
GET /api/canonical-host/documents/:docId/relationships
// Filter to authorized documents only
```

#### 3.3.3 Domain Focus
```typescript
// Use existing metadata GET with ATA annotations
GET /api/canonical-host/documents/:docId/metadata?revision=xxx
// Extract ACTUAL_PDF_TEXT PENDING_REVIEW observations
// Show as annotation nodes, NOT formal system/part entities
```

#### 3.3.4 Panoramic Directory
```typescript
// Paginated matter list
GET /api/canonical-host/engineering-matters?page=1&limit=20
// Load individual catalogs on expand
// Show loaded range explicitly
```

---

### 3.4 State Management

```typescript
interface GraphState {
  // Identity
  matterId: string;
  perspective: 'matter' | 'document' | 'domain' | 'panoramic';
  
  // Graph data
  nodes: Node[];
  edges: Edge[];
  groups: Group[];
  
  // View state
  selectedNodeId: string | null;
  highlightedEventId: string | null;
  camera: { zoom: number; pan: { x: number; y: number } };
  
  // Filters
  activeGroups: string[];
  edgeMode: 'aggregated' | 'individual';
  timeRange: { start: Date; end: Date } | null;
  
  // Panel visibility (mobile)
  activePanel: 'timeline' | 'graph' | 'knowledge';
  
  // Return state
  sourceRef: string; // For restoration
}
```

**Persistence**: `localStorage` with `matterId` key  
**Restoration**: On return, restore camera, selection, filters, scroll

---

## 4. Style System

### 4.1 Graph Canvas Styles

```css
/* relation-graph.css */

.relation-graph-page {
  display: grid;
  grid-template-columns: 280px 1fr 360px;
  height: 100vh;
}

.graph-canvas {
  position: relative;
  background: var(--suite-bg-primary);
}

.graph-card {
  background: var(--suite-card-bg);
  border: 1px solid var(--suite-border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: var(--suite-shadow-md);
}

.graph-card-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--suite-text-primary);
  margin-bottom: 8px;
}

.graph-card-body {
  font-size: 12px;
  color: var(--suite-text-secondary);
}

/* Group semantic colors */
.group-objects { --group-color: #3b82f6; }
.group-positioning { --group-color: #8b5cf6; }
.group-technical { --group-color: #10b981; }
.group-observations { --group-color: #f59e0b; }
.group-systems { --group-color: #ef4444; }
.group-questions { --group-color: #ec4899; }
```

### 4.2 Responsive Breakpoints

```css
/* Desktop: 1672px+ */
@media (min-width: 1672px) {
  .relation-graph-page {
    grid-template-columns: 280px 1fr 360px;
  }
}

/* Tablet: 1024-1671px */
@media (min-width: 1024px) and (max-width: 1671px) {
  .relation-graph-page {
    grid-template-columns: 240px 1fr 320px;
  }
}

/* Mobile: 390-1023px */
@media (max-width: 1023px) {
  .relation-graph-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  
  .graph-panel {
    display: none;
  }
  
  .graph-panel.active {
    display: block;
  }
}
```

---

## 5. Integration Points

### 5.1 Route Integration

```typescript
// client/src/app.tsx
<Route 
  path="/matters/:matterId/graph" 
  element={<RelationGraphPage />} 
/>
<Route 
  path="/matters/:matterId/timeline" 
  element={<TimelinePage />} 
/>
```

### 5.2 Navigation Entry Points

**From Matter Library**:
```typescript
<button onClick={() => navigate(`/matters/${matterId}/graph`)}>
  关系图谱
</button>
```

**From Wiki**:
```typescript
<button onClick={() => navigate(`/matters/${matterId}/graph?nodeId=${objectId}`)}>
  查看关系
</button>
```

**From Timeline**:
```typescript
<button onClick={() => navigate(`/matters/${matterId}/graph?eventId=${eventId}`)}>
  查看关联
</button>
```

### 5.3 Return State Preservation

```typescript
// Save state before navigation
const saveGraphState = () => {
  const state = {
    camera: cyRef.current.zoom(),
    pan: cyRef.current.pan(),
    selectedNodeId,
    perspective,
    filters: activeGroups,
    edgeMode,
  };
  localStorage.setItem(
    `graph-state-${matterId}`,
    JSON.stringify(state)
  );
};

// Restore on mount
useEffect(() => {
  const saved = localStorage.getItem(`graph-state-${matterId}`);
  if (saved) {
    const state = JSON.parse(saved);
    cyRef.current.zoom(state.camera);
    cyRef.current.pan(state.pan);
    setSelectedNodeId(state.selectedNodeId);
    // ... restore other state
  }
}, [matterId]);
```

---

## 6. Implementation Phases

### Phase 1: Foundation (Days 1-2)
- [ ] Create RelationGraphPage directory structure
- [ ] Set up three-column responsive layout
- [ ] Integrate Cytoscape canvas
- [ ] Implement basic zoom/pan controls
- [ ] Add perspective switcher UI

### Phase 2: HTML Card Rendering (Days 3-4)
- [ ] Integrate Cytoscape popper extension
- [ ] Implement grouped HTML card rendering
- [ ] Add semantic group colors
- [ ] Handle card interactions (hover, select)
- [ ] Implement overflow list

### Phase 3: Four Perspectives (Days 5-6)
- [ ] Matter graph data integration
- [ ] Engineering document perspective
- [ ] Domain focus (metadata annotations)
- [ ] Panoramic directory with pagination

### Phase 4: Timeline Integration (Day 7)
- [ ] TimelinePanel component
- [ ] Event → node highlighting
- [ ] Timeline ↔ graph navigation
- [ ] Time range filtering

### Phase 5: Knowledge Panel (Day 8)
- [ ] KnowledgePanel component
- [ ] Matter-level context display
- [ ] Node selection → knowledge loading
- [ ] Source materials integration

### Phase 6: State & Polish (Days 9-10)
- [ ] Complete state persistence
- [ ] Return state restoration
- [ ] Mobile responsive refinement
- [ ] Performance optimization
- [ ] Visual acceptance testing

---

## 7. Testing & Acceptance

### 7.1 Functional Testing

- [ ] All four perspectives load correct data
- [ ] HTML cards render without layout issues
- [ ] Node selection updates knowledge panel
- [ ] Timeline events highlight correct nodes
- [ ] Camera controls work smoothly
- [ ] Overflow list shows all off-screen nodes
- [ ] Return navigation restores exact state
- [ ] Mobile panel switching works correctly

### 7.2 Visual Acceptance

**Reference Screenshots**:
- `screenshots/graph-light-1672-4groups.png`
- `screenshots/graph-light-1672-5groups.png`
- `screenshots/graph-light-1672-6groups.png`
- `screenshots/graph-light-390.png` (with toolbar fix)

**Comparison Points**:
- Card dimensions and spacing
- Group colors and labels
- Relationship curve rendering
- Camera control positions
- Knowledge panel layout
- Timeline event styling

**Tolerance**: ±4px for main boundaries

### 7.3 Performance Testing

- [ ] Large graph (100+ nodes) loads within 3s
- [ ] Camera zoom/pan is smooth (60fps)
- [ ] Node selection has <100ms response
- [ ] Perspective switch <1s
- [ ] Memory cleanup on unmount verified
- [ ] No memory leaks after 10+ navigations

---

## 8. Known Risks & Mitigation

### Risk 1: Cytoscape HTML Performance
**Impact**: High  
**Probability**: Medium  
**Mitigation**: 
- Use virtual scrolling for large graphs
- Render HTML only for visible nodes
- Implement progressive loading

### Risk 2: Four Perspectives Data Complexity
**Impact**: High  
**Probability**: Medium  
**Mitigation**:
- Implement perspectives incrementally
- Start with matter graph (existing API)
- Add others with clear fallbacks

### Risk 3: Mobile Graph Usability
**Impact**: Medium  
**Probability**: High  
**Mitigation**:
- Prioritize panel switching over cramming
- Test touch gestures thoroughly
- Provide overflow list as keyboard alternative

### Risk 4: State Restoration Complexity
**Impact**: Medium  
**Probability**: Low  
**Mitigation**:
- Use well-defined state interface
- Test with multiple navigation patterns
- Implement defensive deserialization

---

## 9. Dependencies

### 9.1 Backend APIs

**Required**:
- `GET /api/canonical-host/matters/:matterId/graph` - Matter relationship graph
- `GET /api/canonical-host/matters/:matterId/timeline` - Timeline events
- `GET /api/canonical-host/documents/:docId/relationships` - Document perspective

**Optional** (can fallback):
- Panoramic directory aggregation API
- Domain entity formal relationships

### 9.2 Frontend Libraries

**Already Available**:
- `cytoscape@3.33.1` (package.json)
- `cytoscape-popper@2.0.0` (for HTML cards)
- `@popperjs/core@2.11.8` (dependency)

**May Need**:
- `cytoscape-cola@2.5.1` (for layout if not using preset positions)

---

## 10. Next Steps

### Immediate Actions (Today)

1. **Read Reference Materials**:
   - `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/src/pages/Graph.jsx`
   - `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/src/components/GraphCanvas.jsx`
   - `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/src/graph/`
   - Review 4/5/6 group screenshots

2. **Technical Preparation**:
   - Set up Cytoscape playground
   - Test popper.js HTML rendering
   - Verify responsive layout approach

3. **Backend Coordination**:
   - Confirm graph API data structure
   - Confirm timeline event data structure
   - Discuss panoramic pagination strategy

### This Week Goals

- 🎯 S4 technical research complete
- 🎯 Foundation and layout (Phase 1) complete
- 🎯 HTML card rendering (Phase 2) started

### Next Week Goals

- 🎯 Four perspectives complete
- 🎯 Timeline integration complete
- 🎯 Knowledge panel integration complete
- 🎯 Ready for visual acceptance

---

**Last Updated**: 2026-09-18  
**Owner**: Luna (frontend implementation)  
**Reviewer**: Astra  
**Coordinator**: M
