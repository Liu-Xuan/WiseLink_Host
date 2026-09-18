# Suite 1.1 S6: Visual Acceptance and Final Delivery Plan

**Created**: 2026-09-18  
**Status**: Planning  
**Dependencies**: S0-S5 completed

---

## 1. Overview

S6 is the final phase focused on comprehensive visual acceptance, performance verification, cross-page integration testing, and phased deployment. This phase ensures every page matches the design specifications and functions correctly in production.

**Timeline**: 3-4 days  
**Priority**: Critical - Final delivery gate

---

## 2. Visual Acceptance Requirements

### 2.1 Screenshot Comparison Matrix

**Reference Screenshots**: `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/screenshots/`

| Page | 1672px Desktop | 1440px Desktop | 1024px Tablet | 390px Mobile | Themes |
|------|----------------|----------------|---------------|--------------|--------|
| Library | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Matters | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Knowledge | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Wiki | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Reader | ✓ Full + ✓ Mobile | ✓ | ✓ | ✓ Single pane | Silver, Carbon |
| Revision | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Graph | ✓ 4/5/6 groups | ✓ | ✓ | ✓ (toolbar fix) | Silver, Carbon |
| Timeline | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Process | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Review | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Tasks | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |
| Demo | ✓ | ✓ | ✓ | ✓ | Silver, Carbon |

**Total Screenshots Required**: 96 (12 pages × 4 viewports × 2 themes)

### 2.2 Comparison Methodology

**Tools**:
- Same browser: Chrome (latest stable)
- Same DPR: 2x (Retina)
- Same font: System default (SF Pro on macOS)
- Same data: Fixed test matter and documents

**Process**:
1. Set viewport to exact dimensions (1672×1000, 1440×1000, 1024×768, 390×844)
2. Load reference screenshot in one window
3. Load implementation in another window
4. Overlay comparison with 50% opacity
5. Measure key boundaries with pixel ruler
6. Document differences in spreadsheet

**Tolerance**: ±4px for main boundaries

**Three-Round Refinement**:
1. **Round 1: Geometry** - Fix layout, spacing, dimensions
2. **Round 2: Reading** - Fix typography, line height, content flow
3. **Round 3: Material** - Fix colors, shadows, borders, transparency

---

### 2.3 Visual Checklist (Per Page)

#### Layout & Spacing
- [ ] Page dimensions match viewport exactly
- [ ] Column widths match reference (±4px)
- [ ] Padding/margin match reference (±2px)
- [ ] Grid gaps match reference
- [ ] Scrollable areas have correct height

#### Typography
- [ ] Font family correct (Inter/system-ui)
- [ ] Font sizes match reference
- [ ] Font weights match reference
- [ ] Line heights match reference
- [ ] Letter spacing match reference
- [ ] Chinese text wraps correctly
- [ ] Long text doesn't overflow

#### Colors & Themes
- [ ] Silver theme colors match
- [ ] Carbon theme colors match
- [ ] Text colors (primary/secondary/tertiary) correct
- [ ] Background colors correct
- [ ] Border colors correct
- [ ] Hover states correct
- [ ] Active states correct
- [ ] Disabled states correct

#### Materials & Effects
- [ ] Border radius match (8px cards, 4px controls)
- [ ] Box shadows match
- [ ] Border thickness match (1px hairline)
- [ ] Transparency/opacity match
- [ ] Blur effects match (glassmorphism)
- [ ] Gradients match (if any)

#### Icons & Images
- [ ] Icon sizes correct
- [ ] Icon colors correct
- [ ] Icon alignment correct
- [ ] Placeholder images correct
- [ ] Image aspect ratios maintained

#### Interactive States
- [ ] Hover effects work
- [ ] Focus indicators visible
- [ ] Active states correct
- [ ] Disabled states correct
- [ ] Loading states correct
- [ ] Error states correct
- [ ] Empty states correct

---

## 3. Animation & Motion Acceptance

### 3.1 Animation Settings

**Three Effect Levels**:
1. **Default**: Standard animations
2. **High**: Enhanced effects, full motion
3. **Reduced**: Minimal motion, respects `prefers-reduced-motion`

**Animation Inventory**:
- Page transitions (fade in/out, slide)
- Modal open/close
- Dropdown expand/collapse
- Hover lift (cards)
- Loading spinners
- Progress indicators
- Skeleton loading
- Toast notifications
- Pulsing live dots
- Smooth scroll
- Splitter drag feedback

### 3.2 Testing Matrix

| Animation | Default | High | Reduced | prefers-reduced-motion |
|-----------|---------|------|---------|------------------------|
| Page transition | ✓ 200ms | ✓ 300ms | Instant | Instant |
| Modal | ✓ 150ms | ✓ 250ms | Instant | Instant |
| Hover lift | ✓ 2px | ✓ 4px | None | None |
| Loading | ✓ Spin | ✓ Spin+pulse | ✓ Static | ✓ Static |
| Smooth scroll | ✓ Enabled | ✓ Enabled | Instant | Instant |

**Verification**:
- [ ] Each animation tested in all three modes
- [ ] `prefers-reduced-motion: reduce` disables all motion
- [ ] Continuous animations (pulsing dots) stop in reduced mode
- [ ] No layout shift when animations disabled
- [ ] Performance: 60fps maintained

---

## 4. Performance Acceptance

### 4.1 Core Web Vitals Targets

**Thresholds** (75th percentile):
- **FCP** (First Contentful Paint): < 1.5s
- **LCP** (Largest Contentful Paint): < 2.5s
- **TTI** (Time to Interactive): < 3.5s
- **CLS** (Cumulative Layout Shift): < 0.1
- **FID** (First Input Delay): < 100ms

### 4.2 Page Load Testing

**Test Scenarios**:
1. **Cold Open**: Clear cache, first visit
2. **Warm Return**: Browser cache active
3. **Navigation**: From another page (SPA transition)

**Test Pages** (Priority order):
1. Reader Page (most complex)
2. Library Page (high frequency)
3. Knowledge Page (high frequency)
4. Graph Page (most data-intensive)
5. All other pages

**Measurement Tools**:
- Chrome DevTools Performance tab
- Lighthouse CI
- Real User Monitoring (if available)

**Data Collection Template**:
```
Page: Reader
Scenario: Cold Open
Date: 2026-09-18
Browser: Chrome 120
Connection: Fast 3G throttling

FCP: 1.2s ✓
LCP: 2.1s ✓
TTI: 3.0s ✓
CLS: 0.05 ✓
FID: 45ms ✓

Network Requests: 8
Total Transfer: 450KB
Cache Hits: 0
```

### 4.3 Specific Performance Checks

#### Reader Page
- [ ] First text paragraph visible < 2s
- [ ] PDF canvas rendered < 3s
- [ ] Outline expanded < 100ms
- [ ] Mode switch < 500ms
- [ ] Scroll sync < 100ms lag

#### Library Page
- [ ] First 24 rows visible < 1.5s
- [ ] Quick Look opens < 200ms
- [ ] Filter updates < 300ms
- [ ] Scroll performance 60fps

#### Knowledge Page
- [ ] List visible < 1.5s
- [ ] Detail loads < 500ms
- [ ] Search results < 800ms

#### Graph Page
- [ ] Canvas renders < 2s
- [ ] Zoom/pan 60fps maintained
- [ ] Node selection < 100ms
- [ ] Perspective switch < 1s
- [ ] Large graph (100+ nodes) < 3s

---

## 5. Functional Acceptance

### 5.1 Cross-Page Navigation Flows

**Flow 1: Document Reading Journey**
```
Library → Select document → Quick Look → Open Reader → 
Navigate to source paragraph → Return to Library →
Selection + scroll position restored
```

**Flow 2: Knowledge Exploration**
```
Knowledge → Search term → Select result → Read full explanation →
View source → Open Reader → Return to Knowledge →
Search term + selection restored
```

**Flow 3: Graph to Timeline**
```
Graph → Select event → Highlight nodes → Navigate to Timeline →
Event pre-selected → Return to Graph →
Camera position + selection + filters restored
```

**Flow 4: Review Draft Preservation**
```
Review → Type draft → Switch to Library → Browse documents →
Return to Review → Draft still present →
Submit → Success → Draft cleared
```

**Flow 5: Failed Task Recovery**
```
Tasks → View failed task → See error message →
Navigate to related work → View partial results →
Return to Tasks → Retry → Success
```

### 5.2 State Restoration Testing

**Test Matrix**:

| Action | Library | Knowledge | Reader | Graph | Review |
|--------|---------|-----------|--------|-------|--------|
| Page reload | ✓ | ✓ | ✓ | ✓ | ✓ |
| Browser back | ✓ | ✓ | ✓ | ✓ | ✓ |
| Matter switch | Clear | Clear | Clear | Clear | Cancel + save draft |
| Session end | Persist | Persist | Persist | Persist | Persist draft |

**State Components**:
- Selection (row, document, node)
- Filters (active, values)
- Scroll position
- Expanded sections
- Sort order
- Column visibility
- Theme preference
- Effects setting
- Drafts (review only)

### 5.3 Error Handling

**Scenarios to Test**:
- [ ] Network offline
- [ ] API timeout
- [ ] 401 Unauthorized (auth expired)
- [ ] 403 Forbidden (permission revoked)
- [ ] 404 Not Found (deleted resource)
- [ ] 500 Server Error
- [ ] Malformed response
- [ ] Large payload (timeout)
- [ ] Concurrent requests (race condition)

**Expected Behavior**:
- Clear error message
- Retry option (where applicable)
- Graceful degradation
- No white screen of death
- No console error spam
- Protected content cleared on 401/403

---

## 6. Browser Compatibility

### 6.1 Target Browsers

**Primary** (Full support):
- Chrome 120+ (latest stable)
- Safari 17+ (latest stable)
- Firefox 120+ (latest stable)

**Secondary** (Best effort):
- Edge 120+ (Chromium-based)

**Not Supported**:
- Internet Explorer (any version)
- Safari < 16
- Chrome < 100

### 6.2 Compatibility Checklist

**Per Browser**:
- [ ] Layout renders correctly
- [ ] Typography displays correctly
- [ ] Colors match (note color space differences)
- [ ] Interactions work (hover, click, drag)
- [ ] Animations smooth
- [ ] No console errors
- [ ] PDF rendering works (Reader)
- [ ] Cytoscape rendering works (Graph)

**Known Issues**:
- Safari: Different color rendering (document)
- Firefox: Scroll snap behavior (note differences)
- Edge: Same as Chrome (Chromium-based)

---

## 7. Accessibility Baseline

**Scope**: Basic keyboard and screen reader support

### 7.1 Keyboard Navigation

- [ ] Tab order logical
- [ ] Focus indicators visible (2px outline)
- [ ] All interactive elements reachable
- [ ] Escape closes modals
- [ ] Enter/Space activates buttons
- [ ] Arrow keys navigate lists
- [ ] Page Up/Down scrolls
- [ ] Home/End jumps to start/end

### 7.2 Screen Reader Landmarks

- [ ] Page has `<main>` landmark
- [ ] Navigation in `<nav>`
- [ ] Buttons have `aria-label` when icon-only
- [ ] Images have `alt` text
- [ ] Form inputs have labels
- [ ] Error messages announced
- [ ] Loading states announced

**Note**: Full WCAG 2.1 AA compliance requires manual testing with assistive technologies and expert review, which is beyond S6 scope.

---

## 8. Deployment Acceptance

### 8.1 Pre-Deployment Checklist

**Code Quality**:
- [ ] All TypeScript errors resolved
- [ ] All ESLint warnings addressed
- [ ] No console.log statements (except intentional)
- [ ] No commented-out code blocks
- [ ] No TODO comments in critical paths

**Build**:
- [ ] Production build succeeds
- [ ] No build warnings
- [ ] Bundle size reasonable (<2MB initial)
- [ ] Code splitting working
- [ ] Source maps generated

**Environment**:
- [ ] Environment variables set correctly
- [ ] API endpoints configured
- [ ] Feature flags set appropriately
- [ ] Error tracking configured (Sentry, etc.)

### 8.2 Deployment Verification

**Immediate Checks** (within 5 minutes):
- [ ] All pages load without errors
- [ ] Authentication works
- [ ] API calls succeed
- [ ] Static assets load (CSS, JS, images)
- [ ] No 404s in network tab

**Smoke Tests** (within 30 minutes):
- [ ] Complete Flow 1 (Document Reading Journey)
- [ ] Complete Flow 2 (Knowledge Exploration)
- [ ] Complete Flow 3 (Graph to Timeline)
- [ ] Complete Flow 4 (Review Draft Preservation)
- [ ] Complete Flow 5 (Failed Task Recovery)

**Regression Tests** (within 2 hours):
- [ ] Existing features still work
- [ ] Previous bug fixes still valid
- [ ] Performance hasn't degraded
- [ ] No new console errors

### 8.3 Rollback Criteria

**Immediate Rollback** (P0):
- Authentication completely broken
- All pages show white screen
- Critical data loss or corruption
- Security vulnerability exposed

**Planned Rollback** (P1):
- >50% of users experiencing errors
- Core workflow broken (reading, navigation)
- Performance degraded >2x
- Critical accessibility regression

---

## 9. Phased Deployment Strategy

### 9.1 Phase-by-Phase Rollout

**Phase 1: S1 Shell + Library** (Week 1)
- Deploy: GlobalNav, Topbar, Breadcrumb, LibraryPage
- Test: Navigation, library browsing, quick look
- Monitor: Error rate, page load time
- Rollback plan: Revert to old shell

**Phase 2: S2 Knowledge + Wiki** (Week 2)
- Deploy: KnowledgePage, WikiPage
- Test: Knowledge search, Wiki reading, source links
- Monitor: Search performance, content accuracy
- Rollback plan: Revert to old knowledge page

**Phase 3: S3 Reader + Comparison** (Week 3)
- Deploy: ReaderPage, VersionComparisonPage
- Test: Five reading modes, PDF rendering, comparison
- Monitor: Reader performance, PDF load time
- Rollback plan: Revert to old reader

**Phase 4: S4 Graph + Timeline** (Week 4)
- Deploy: RelationGraphPage, TimelinePage
- Test: Graph rendering, perspectives, timeline sync
- Monitor: Graph performance, Cytoscape errors
- Rollback plan: Revert to old graph

**Phase 5: S5 Process + Review + Tasks + Demo** (Week 5)
- Deploy: ProcessPage, ReviewPage, TasksPage, DemoPage
- Test: Full workflows, draft isolation, tour
- Monitor: Review submissions, task tracking
- Rollback plan: Feature flag off

**Phase 6: Full Suite + Polish** (Week 6)
- Enable all features for all users
- Final visual adjustments
- Performance tuning
- Documentation updates

### 9.2 Monitoring Metrics

**Per Phase**:
- Error rate (target: <1%)
- Page load time (target: <2.5s LCP)
- API success rate (target: >99%)
- User engagement (time on page, interactions)
- Support tickets (target: <5 per day)

---

## 10. Documentation Deliverables

### 10.1 Technical Documentation

- [ ] **Component API Reference**: Props, state, hooks for each major component
- [ ] **Integration Guide**: How to integrate Suite pages into existing app
- [ ] **State Management**: localStorage keys, data structures, persistence strategy
- [ ] **API Contracts**: All backend endpoints used, request/response formats
- [ ] **Performance Guide**: Optimization techniques, bottlenecks to avoid
- [ ] **Troubleshooting**: Common issues and solutions

### 10.2 Visual Documentation

- [ ] **Design System**: Colors, typography, spacing, components
- [ ] **Screenshot Gallery**: All pages, all viewports, both themes
- [ ] **Before/After Comparison**: Old vs new pages
- [ ] **Animation Reference**: Videos of all animations in three effect levels

### 10.3 User Documentation

- [ ] **User Guide**: How to use each page
- [ ] **Keyboard Shortcuts**: Comprehensive list
- [ ] **FAQ**: Common questions and answers
- [ ] **Tutorial Videos**: Screen recordings of key workflows

---

## 11. Acceptance Criteria Summary

### 11.1 Visual Acceptance
- [ ] All 96 screenshots match reference (±4px)
- [ ] Both themes (Silver/Carbon) correct
- [ ] All viewports (1672/1440/1024/390) correct
- [ ] Typography matches reference
- [ ] Materials (shadows, borders, transparency) match

### 11.2 Animation Acceptance
- [ ] All three effect levels work
- [ ] `prefers-reduced-motion` respected
- [ ] 60fps maintained
- [ ] No layout shifts

### 11.3 Performance Acceptance
- [ ] FCP < 1.5s for all pages
- [ ] LCP < 2.5s for all pages
- [ ] TTI < 3.5s for all pages
- [ ] CLS < 0.1 for all pages

### 11.4 Functional Acceptance
- [ ] All five cross-page flows work
- [ ] State restoration correct
- [ ] Error handling graceful
- [ ] Draft isolation working
- [ ] No data loss on failures

### 11.5 Compatibility Acceptance
- [ ] Works in Chrome 120+
- [ ] Works in Safari 17+
- [ ] Works in Firefox 120+
- [ ] Keyboard navigation functional
- [ ] Screen reader landmarks present

### 11.6 Deployment Acceptance
- [ ] All pages load in production
- [ ] No console errors
- [ ] Smoke tests pass
- [ ] Monitoring metrics green
- [ ] Rollback plan tested

---

## 12. Final Sign-Off Checklist

**Technical Lead**:
- [ ] Code review completed
- [ ] All tests passing
- [ ] Performance targets met
- [ ] No critical bugs

**Design Lead**:
- [ ] Visual acceptance completed
- [ ] All screenshots approved
- [ ] Animation polish complete
- [ ] Theme consistency verified

**Product Lead**:
- [ ] All user flows tested
- [ ] Documentation complete
- [ ] Training materials ready
- [ ] Launch plan approved

**QA Lead**:
- [ ] Functional testing complete
- [ ] Regression testing complete
- [ ] Browser testing complete
- [ ] Accessibility baseline verified

---

## 13. Post-Launch Tasks

### Week 1
- [ ] Monitor error rates daily
- [ ] Collect user feedback
- [ ] Fix critical bugs (P0)
- [ ] Document known issues

### Week 2
- [ ] Fix high-priority bugs (P1)
- [ ] Performance tuning based on real data
- [ ] Update documentation with learnings
- [ ] Plan next iteration

### Week 3-4
- [ ] Address all P2 bugs
- [ ] Implement quick wins from feedback
- [ ] Finalize comprehensive documentation
- [ ] Conduct retrospective

---

**Last Updated**: 2026-09-18  
**Owner**: M (coordination), Luna (implementation), Astra (review)  
**Stakeholders**: Design, Product, QA, Engineering
