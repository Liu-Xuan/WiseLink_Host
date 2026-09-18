# Suite 1.1 S5: Analysis, Review, Progress and Guide Implementation Plan

**Created**: 2026-09-18  
**Status**: Planning  
**Dependencies**: S0-S4 completed

---

## 1. Overview

S5 covers four distinct pages that support the engineering workflow: problem analysis, review communication, work progress tracking, and user guidance. These pages are less visually complex than the graph but require careful attention to workflow states and data isolation.

**Timeline**: 4-5 days  
**Priority**: Medium - Supporting features for complete workflow

---

## 2. Pages Overview

### 2.1 Problem Analysis (Process Page)

**Purpose**: Display saved problem analysis with evidence and methods

**Key Features**:
- Complete problem statement (main reading area)
- Evidence and method records
- Layered with summary (avoid showing full analysis on homepage)
- Navigation back to original work

**Layout**:
```
┌────────────────────────────────────────┐
│  Problem Title                  [Back] │
├────────────────────────────────────────┤
│                                        │
│  Problem Statement (continuous text)   │
│  - Context                             │
│  - Key questions                       │
│  - Conditions                          │
│  - Uncertainties                       │
│                                        │
├────────────────────────────────────────┤
│  Evidence & Methods                    │
│  - Source materials                    │
│  - Analysis approach                   │
│  - Key findings                        │
└────────────────────────────────────────┘
```

---

### 2.2 Review Communication (Review Page)

**Purpose**: Handle review dialogue, drafts, and submission

**Key Features**:
- Conversation display (reading pane + sidebar)
- Input area with draft isolation
- Per-matter draft separation
- Submission receipt tracking
- Status: pending/running/saved/failed
- Error recovery

**Layout**:
```
┌─────────────────────┬──────────────────┐
│  Conversation       │  Sidebar         │
│                     │                  │
│  [Review messages]  │  - Scope         │
│                     │  - Status        │
│                     │  - History       │
│                     │                  │
├─────────────────────┴──────────────────┤
│  Input Area                            │
│  [Draft text for current matter]       │
│  [Submit] [Save Draft]                 │
└────────────────────────────────────────┘
```

**Critical Requirements**:
- Draft isolation: by user + tenant + matter (or exact source text)
- Submission only after actual acceptance
- Clear draft on success, preserve on failure
- Intercept late responses when matter switched
- No production writes in demo mode

---

### 2.3 Work Progress (Tasks Page)

**Purpose**: Track work progress and task status

**Key Features**:
- Progress table (status + business content separated)
- Waiting/running/failed/completed states
- Precise entry to saved content or continuation
- No capacity/completion metrics fabrication

**Layout**:
```
┌────────────────────────────────────────────────┐
│  Work Progress                                 │
├─────────┬──────────┬──────────┬───────────────┤
│ Task    │ Status   │ Progress │ Actions       │
├─────────┼──────────┼──────────┼───────────────┤
│ Task 1  │ Running  │ 60%      │ [View]        │
│ Task 2  │ Failed   │ 30%      │ [Retry][View] │
│ Task 3  │ Complete │ 100%     │ [View Result] │
│ Task 4  │ Waiting  │ 0%       │ [Cancel]      │
└─────────┴──────────┴──────────┴───────────────┘

Notes:
- Failed tasks show saved content + retry option
- Completed tasks link to actual saved work
- No fake "90% complete" for incomplete work
```

**Critical Requirements**:
- Separate saved content from incomplete follow-up work
- Do NOT create capacity or completion indicators
- Failed tasks preserve partial results
- Clear error messages with recovery options

---

### 2.4 Usage Guide (Demo Page)

**Purpose**: Interactive tutorial with seven-act walkthrough

**Key Features**:
- Help documentation
- Seven-act component tour
- Pause/step/takeover/exit controls
- Restore original route/selection/draft/scroll on exit
- No production writes

**Layout**:
```
┌────────────────────────────────────────┐
│  WiseLink Suite Guide                  │
├────────────────────────────────────────┤
│  [Quick Start] [Features] [Tutorial]   │
│                                        │
│  === Interactive Demo ===             │
│  Act 1: Library Overview               │
│  [◀ Previous] [Pause] [Next ▶]        │
│  [Exit Tour]                           │
│                                        │
│  === Help Topics ===                  │
│  - Getting Started                     │
│  - Reading Documents                   │
│  - Understanding Relationships         │
│  - Tracking Progress                   │
└────────────────────────────────────────┘
```

**Seven-Act Tour**:
1. **Library**: Browse documents and matters
2. **Quick Look**: Preview and open
3. **Knowledge**: Search and explore
4. **Reader**: Five reading modes
5. **Graph**: Relationships and timeline
6. **Review**: Submit feedback
7. **Progress**: Track work status

**Critical Requirements**:
- Isolated demo data (no production mixing)
- State restoration on exit:
  - Original route
  - Selection state
  - Draft content (if any)
  - Scroll positions
  - Settings
- Tour state: current act, progress, user-paused
- No production writes during tour

---

## 3. Component Structure

### 3.1 Problem Analysis Page

```
ProcessPage/
├── index.tsx                 # Main layout
├── ProcessHeader.tsx         # Title, matter info, back navigation
├── ProblemStatement.tsx      # Main analysis text
├── EvidenceSection.tsx       # Source materials
├── MethodSection.tsx         # Analysis approach
└── process.css               # Styles (~400 lines)
```

### 3.2 Review Page

```
ReviewPage/
├── index.tsx                 # Main layout + draft management
├── ReviewHeader.tsx          # Title, matter, status
├── ConversationPane.tsx      # Message list
├── ReviewSidebar.tsx         # Scope, history, status
├── InputArea.tsx             # Draft input + submit
├── DraftManager.tsx          # Isolation logic (user+tenant+matter)
└── review.css                # Styles (~500 lines)
```

### 3.3 Tasks Page

```
TasksPage/
├── index.tsx                 # Main layout
├── TasksHeader.tsx           # Title, filters
├── TasksTable.tsx            # Status table
├── TaskRow.tsx               # Single task with actions
├── TaskDetail.tsx            # Expanded task view
└── tasks.css                 # Styles (~350 lines)
```

### 3.4 Demo/Guide Page

```
DemoPage/
├── index.tsx                 # Help + tour orchestrator
├── HelpContent.tsx           # Static help documentation
├── TourOverlay.tsx           # Seven-act tour UI
├── TourStep.tsx              # Individual tour step
├── TourControls.tsx          # Pause/prev/next/exit
├── StateCapture.tsx          # Save/restore mechanism
└── demo.css                  # Styles (~450 lines)
```

---

## 4. Data Integration

### 4.1 Problem Analysis API

```typescript
GET /api/canonical-host/matters/:matterId/problems/:problemId

Response: {
  id: string;
  title: string;
  statement: string; // Full problem text
  context: string;
  questions: string[];
  conditions: string[];
  uncertainties: string[];
  evidence: {
    sources: SourceRef[];
    findings: string[];
  };
  method: {
    approach: string;
    steps: string[];
  };
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 Review API

```typescript
// Read conversation
GET /api/canonical-host/matters/:matterId/reviews

// Submit review
POST /api/canonical-host/matters/:matterId/reviews
Body: {
  content: string;
  scope: string;
  references: SourceRef[];
}

Response: {
  id: string;
  status: 'pending' | 'accepted' | 'running' | 'saved' | 'failed';
  receipt: string; // Tracking ID
}

// Read draft (client-side localStorage)
// Key: `review-draft-${userId}-${tenantId}-${matterId}`
```

### 4.3 Tasks API

```typescript
GET /api/canonical-host/matters/:matterId/tasks

Response: {
  tasks: [
    {
      id: string;
      title: string;
      status: 'waiting' | 'running' | 'completed' | 'failed';
      progress: number; // 0-100, actual progress only
      startedAt: string;
      completedAt?: string;
      failedAt?: string;
      error?: string;
      savedWorkId?: string; // Link to actual saved content
      canRetry: boolean;
      canCancel: boolean;
    }
  ]
}
```

### 4.4 Demo/Guide (Static)

```typescript
// Tour state (localStorage)
interface TourState {
  active: boolean;
  currentAct: number; // 1-7
  paused: boolean;
  capturedState: {
    route: string;
    selection: any;
    drafts: Record<string, string>;
    scrollPositions: Record<string, number>;
    settings: any;
  };
}

// Key: `suite-tour-state`
```

---

## 5. Draft Isolation Strategy (Review Page)

**Critical**: Drafts must be isolated to prevent cross-contamination

### 5.1 Isolation Key

```typescript
function getDraftKey(userId: string, tenantId: string, matterId: string): string {
  return `review-draft-${userId}-${tenantId}-${matterId}`;
}

// Alternative: isolation by exact source text
function getDraftKeyBySource(userId: string, sourceHash: string): string {
  return `review-draft-${userId}-${sourceHash}`;
}
```

### 5.2 Draft Lifecycle

```typescript
// Save draft
const saveDraft = (content: string) => {
  const key = getDraftKey(user.id, tenant.id, matter.id);
  localStorage.setItem(key, JSON.stringify({
    content,
    matterId: matter.id,
    savedAt: new Date().toISOString()
  }));
};

// Load draft
const loadDraft = (): string | null => {
  const key = getDraftKey(user.id, tenant.id, matter.id);
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  
  const draft = JSON.parse(stored);
  // Verify matter ID matches
  if (draft.matterId !== matter.id) return null;
  
  return draft.content;
};

// Clear draft (only on successful submission)
const clearDraft = () => {
  const key = getDraftKey(user.id, tenant.id, matter.id);
  localStorage.removeItem(key);
};

// On matter switch: cancel pending requests
useEffect(() => {
  return () => {
    // Cancel any pending submission
    abortControllerRef.current?.abort();
  };
}, [matter.id]);
```

### 5.3 Submission Flow

```typescript
const submitReview = async (content: string) => {
  setStatus('pending');
  
  const abortController = new AbortController();
  abortControllerRef.current = abortController;
  
  try {
    const response = await fetch(
      `/api/canonical-host/matters/${matter.id}/reviews`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
        signal: abortController.signal
      }
    );
    
    if (!response.ok) throw new Error('Submission failed');
    
    const result = await response.json();
    
    // Only clear draft on success
    if (result.status === 'accepted' || result.status === 'saved') {
      clearDraft();
      setStatus('success');
    } else {
      setStatus('failed');
      setError(result.error);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Request was cancelled (matter switched)
      return;
    }
    
    // Preserve draft on error
    setStatus('failed');
    setError(err.message);
  }
};
```

---

## 6. Tour State Management (Demo Page)

### 6.1 State Capture

```typescript
interface CapturedState {
  route: string;
  selection: {
    matterId?: string;
    documentId?: string;
    knowledgeId?: string;
  };
  drafts: Record<string, string>;
  scrollPositions: Record<string, number>;
  settings: {
    theme: 'silver' | 'carbon';
    effects: 'default' | 'high' | 'reduced';
    reducedMotion: boolean;
  };
}

const captureState = (): CapturedState => {
  return {
    route: location.pathname + location.search,
    selection: {
      matterId: currentMatter?.id,
      documentId: currentDocument?.id,
      knowledgeId: currentKnowledge?.id,
    },
    drafts: getAllDrafts(), // Scan localStorage for all drafts
    scrollPositions: getScrollPositions(), // All scrollable containers
    settings: {
      theme: currentTheme,
      effects: effectsLevel,
      reducedMotion: prefersReducedMotion,
    },
  };
};
```

### 6.2 State Restoration

```typescript
const restoreState = (captured: CapturedState) => {
  // Restore route
  navigate(captured.route);
  
  // Restore selection (after navigation)
  setTimeout(() => {
    if (captured.selection.matterId) {
      selectMatter(captured.selection.matterId);
    }
    if (captured.selection.documentId) {
      selectDocument(captured.selection.documentId);
    }
    if (captured.selection.knowledgeId) {
      selectKnowledge(captured.selection.knowledgeId);
    }
    
    // Restore scroll positions
    Object.entries(captured.scrollPositions).forEach(([id, position]) => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollTop = position;
      }
    });
  }, 100);
  
  // Restore settings
  setTheme(captured.settings.theme);
  setEffects(captured.settings.effects);
  setReducedMotion(captured.settings.reducedMotion);
};
```

### 6.3 Tour Flow

```typescript
const TourOverlay = () => {
  const [currentAct, setCurrentAct] = useState(1);
  const [paused, setPaused] = useState(false);
  const [capturedState, setCapturedState] = useState<CapturedState | null>(null);
  
  const startTour = () => {
    const state = captureState();
    setCapturedState(state);
    saveTourState({ active: true, currentAct: 1, paused: false, capturedState: state });
    setCurrentAct(1);
  };
  
  const exitTour = () => {
    if (capturedState) {
      restoreState(capturedState);
    }
    clearTourState();
  };
  
  const nextAct = () => {
    if (currentAct < 7) {
      setCurrentAct(currentAct + 1);
      saveTourState({ active: true, currentAct: currentAct + 1, paused, capturedState });
    } else {
      exitTour();
    }
  };
  
  const prevAct = () => {
    if (currentAct > 1) {
      setCurrentAct(currentAct - 1);
      saveTourState({ active: true, currentAct: currentAct - 1, paused, capturedState });
    }
  };
  
  return (
    <div className="tour-overlay">
      <TourStep act={currentAct} />
      <TourControls
        currentAct={currentAct}
        totalActs={7}
        paused={paused}
        onPause={() => setPaused(!paused)}
        onPrev={prevAct}
        onNext={nextAct}
        onExit={exitTour}
      />
    </div>
  );
};
```

---

## 7. Implementation Phases

### Phase 1: Process Page (Day 1)
- [ ] ProcessPage component structure
- [ ] Problem statement display
- [ ] Evidence and method sections
- [ ] Navigation back to work
- [ ] Styles and responsive layout

### Phase 2: Review Page (Days 2-3)
- [ ] ReviewPage component structure
- [ ] Conversation pane
- [ ] Draft isolation implementation
- [ ] Input area with save/submit
- [ ] Status tracking and error handling
- [ ] Late response interception

### Phase 3: Tasks Page (Day 4)
- [ ] TasksPage component structure
- [ ] Tasks table with status
- [ ] Action buttons (retry/cancel/view)
- [ ] Task detail expansion
- [ ] Styles and responsive layout

### Phase 4: Demo Page (Day 5)
- [ ] DemoPage component structure
- [ ] Static help content
- [ ] Seven-act tour implementation
- [ ] State capture/restore logic
- [ ] Tour controls (pause/prev/next/exit)
- [ ] Demo data isolation

---

## 8. Route Integration

```typescript
// client/src/app.tsx

// Problem Analysis
<Route 
  path="/matters/:matterId/problems/:problemId" 
  element={<ProcessPage />} 
/>

// Review
<Route 
  path="/matters/:matterId/review" 
  element={<ReviewPage />} 
/>

// Tasks
<Route 
  path="/matters/:matterId/tasks" 
  element={<TasksPage />} 
/>

// Demo/Guide
<Route 
  path="/demo" 
  element={<DemoPage />} 
/>
```

---

## 9. Testing & Acceptance

### 9.1 Process Page Testing

- [ ] Problem statement displays completely
- [ ] Evidence sources link correctly
- [ ] Method details are readable
- [ ] Back navigation works
- [ ] Responsive layout correct

### 9.2 Review Page Testing

- [ ] Draft saves to correct isolated key
- [ ] Draft loads on page return
- [ ] Draft clears only on successful submission
- [ ] Draft preserved on failure
- [ ] Matter switch cancels pending request
- [ ] Late response intercepted correctly
- [ ] Multiple matters have separate drafts
- [ ] No production writes in demo mode

### 9.3 Tasks Page Testing

- [ ] All task statuses display correctly
- [ ] Failed tasks show error + retry option
- [ ] Completed tasks link to saved work
- [ ] Running tasks show actual progress
- [ ] Waiting tasks can be cancelled
- [ ] No fabricated completion metrics

### 9.4 Demo Page Testing

- [ ] Help content displays correctly
- [ ] Tour starts and captures state
- [ ] All seven acts navigate correctly
- [ ] Pause/resume works
- [ ] Exit restores original state:
  - [ ] Route restored
  - [ ] Selection restored
  - [ ] Drafts preserved
  - [ ] Scroll positions restored
  - [ ] Settings unchanged
- [ ] No production writes during tour

---

## 10. Known Risks & Mitigation

### Risk 1: Draft Isolation Complexity
**Impact**: High  
**Probability**: Medium  
**Mitigation**:
- Use clear key naming convention
- Test with multiple users/tenants/matters
- Add defensive checks for matter ID mismatch

### Risk 2: Tour State Restoration Failures
**Impact**: Medium  
**Probability**: Medium  
**Mitigation**:
- Capture state comprehensively
- Test restoration in various scenarios
- Add fallback to home page if restoration fails

### Risk 3: Late Response Interception
**Impact**: Medium  
**Probability**: Low  
**Mitigation**:
- Use AbortController for all requests
- Clear controllers on unmount
- Add matter ID validation on response

---

## 11. Next Steps

### After S4 Completion

1. **Process Page** (1 day)
   - Implement basic layout
   - Integrate problem display
   - Add navigation

2. **Review Page** (2 days)
   - Implement draft isolation
   - Add submission flow
   - Test error scenarios

3. **Tasks Page** (1 day)
   - Implement status table
   - Add action buttons
   - Test all states

4. **Demo Page** (1 day)
   - Create help content
   - Implement seven-act tour
   - Test state restoration

---

**Last Updated**: 2026-09-18  
**Owner**: Luna (frontend implementation)  
**Reviewer**: Astra  
**Coordinator**: M
