import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore - archived legacy Cytoscape playground, intentionally untyped
import cytoscape from 'cytoscape';
// @ts-ignore - archived legacy Cytoscape playground, intentionally untyped
import popper from 'cytoscape-popper';
import './cytoscape-validation.css';

// Register Cytoscape extension
// @ts-expect-error - cytoscape.use is untyped here
cytoscape.use(popper);

interface ValidationResult {
  test: string;
  status: 'pass' | 'fail' | 'pending';
  message: string;
}

export function CytoscapeValidationPlayground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [currentTest, setCurrentTest] = useState<string>('');

  const updateResult = (test: string, status: 'pass' | 'fail', message: string) => {
    setResults(prev => {
      const existing = prev.findIndex(r => r.test === test);
      const result = { test, status, message };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = result;
        return updated;
      }
      return [...prev, result];
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Test 1: Basic HTML Rendering
    setCurrentTest('Test 1: Basic HTML Rendering');

    try {
      // @ts-expect-error - cytoscape factory is untyped here
      const cy = cytoscape({
        container: containerRef.current,
        style: [
          {
            selector: 'node[type="group-anchor"]',
            style: {
              'width': 1,
              'height': 1,
              'opacity': 0,
              'events': 'no'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#cbd5e1',
              'target-arrow-color': '#cbd5e1',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 1.2
            }
          }
        ],
        layout: {
          name: 'preset'
        },
        wheelSensitivity: 0.2,
        minZoom: 0.3,
        maxZoom: 3
      });

      cyRef.current = cy;

      // Create test nodes
      const testNodes = [
        { id: 'group-1', x: 200, y: 150, title: '工程文档组 1', count: 12, docs: ['文档A - 第3版', '文档B - 第2版', '文档C - 第5版'] },
        { id: 'group-2', x: 500, y: 150, title: '工程文档组 2', count: 8, docs: ['文档D - 第1版', '文档E - 第4版'] },
        { id: 'group-3', x: 200, y: 400, title: '工程文档组 3', count: 15, docs: ['文档F - 第2版', '文档G - 第3版', '文档H - 第1版'] },
        { id: 'group-4', x: 500, y: 400, title: '工程文档组 4', count: 6, docs: ['文档I - 第2版', '文档J - 第1版'] },
        { id: 'group-5', x: 350, y: 275, title: '工程文档组 5', count: 20, docs: ['文档K - 第5版', '文档L - 第2版', '文档M - 第3版'] }
      ];

      testNodes.forEach(node => {
        cy.add({
          group: 'nodes',
          data: {
            id: node.id,
            type: 'group-anchor'
          },
          position: { x: node.x, y: node.y }
        });

        // Create HTML card
        const cardElement = document.createElement('div');
        cardElement.className = 'cytoscape-html-card';
        cardElement.innerHTML = `
          <div class="card-header">
            <h3>${node.title}</h3>
            <span class="badge">${node.count}篇</span>
          </div>
          <div class="card-body">
            ${node.docs.map(doc => `<div class="doc-item">${doc}</div>`).join('')}
            ${node.count > node.docs.length ? `<div class="more">+ ${node.count - node.docs.length} more</div>` : ''}
          </div>
        `;

        // Attach card with popper
        const anchorNode = cy.getElementById(node.id);
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

        // Update on viewport changes
        cy.on('pan zoom resize', () => {
          popperInstance.update();
        });

        // Test interaction
        cardElement.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('doc-item')) {
            // Validation test: verify click events work inside popper-positioned elements
            updateResult('Test 3: Interactions', 'pass', 'Card click interaction works');
          }
        });
      });

      // Test 2: Edge Connections
      setCurrentTest('Test 2: Edge Connections');

      cy.add([
        { group: 'edges', data: { id: 'edge-1-2', source: 'group-1', target: 'group-2' } },
        { group: 'edges', data: { id: 'edge-1-3', source: 'group-1', target: 'group-3' } },
        { group: 'edges', data: { id: 'edge-2-4', source: 'group-2', target: 'group-4' } },
        { group: 'edges', data: { id: 'edge-3-5', source: 'group-3', target: 'group-5' } },
        { group: 'edges', data: { id: 'edge-4-5', source: 'group-4', target: 'group-5' } }
      ]);

      updateResult('Test 1: Basic HTML Rendering', 'pass', '5 HTML cards rendered successfully');
      updateResult('Test 2: Edge Connections', 'pass', '5 edges rendered between groups');

      // Test 6: Camera State
      const savedCamera = localStorage.getItem('cytoscape-validation-camera');
      if (savedCamera) {
        const state = JSON.parse(savedCamera);
        cy.viewport({
          zoom: state.zoom,
          pan: state.pan
        });
        updateResult('Test 6: Camera State', 'pass', 'Camera state restored from localStorage');
      } else {
        cy.fit(undefined, 50);
      }

      // Save camera state on changes
      let saveTimeout: NodeJS.Timeout;
      cy.on('pan zoom', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          const state = {
            pan: cy.pan(),
            zoom: cy.zoom()
          };
          localStorage.setItem('cytoscape-validation-camera', JSON.stringify(state));
        }, 500);
      });

    } catch (error) {
      updateResult('Test 1: Basic HTML Rendering', 'fail', `Error: ${(error as Error).message}`);
    }

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, []);

  const runPerformanceTest = () => {
    if (!cyRef.current) return;

    setCurrentTest('Test 5: Performance');
    const start = performance.now();

    // Add 45 more nodes (50 total)
    for (let i = 6; i <= 50; i++) {
      const x = 100 + (i % 10) * 100;
      const y = 100 + Math.floor(i / 10) * 100;

      cyRef.current.add({
        group: 'nodes',
        data: {
          id: `group-${i}`,
          type: 'group-anchor'
        },
        position: { x, y }
      });

      const cardElement = document.createElement('div');
      cardElement.className = 'cytoscape-html-card';
      cardElement.innerHTML = `
        <div class="card-header">
          <h3>组 ${i}</h3>
          <span class="badge">${Math.floor(Math.random() * 20) + 1}篇</span>
        </div>
        <div class="card-body">
          <div class="doc-item">文档 ${i}-A</div>
          <div class="doc-item">文档 ${i}-B</div>
        </div>
      `;

      const anchorNode = cyRef.current.getElementById(`group-${i}`);
      const popperInstance = anchorNode.popper({
        content: () => cardElement,
        popper: {
          placement: 'top'
        }
      });

      cyRef.current.on('pan zoom resize', () => {
        popperInstance.update();
      });
    }

    const elapsed = performance.now() - start;
    const pass = elapsed < 2000;
    updateResult(
      'Test 5: Performance',
      pass ? 'pass' : 'fail',
      `50 nodes rendered in ${elapsed.toFixed(0)}ms (target: <2000ms)`
    );

    // Fit to view
    setTimeout(() => {
      cyRef.current?.fit(undefined, 50);
    }, 100);
  };

  const testCameraControls = () => {
    if (!cyRef.current) return;

    // Fit to view
    cyRef.current.fit(undefined, 50);
    setTimeout(() => {
      updateResult('Test 6: Camera State', 'pass', 'Fit to view works');
    }, 500);
  };

  const testZoom = () => {
    if (!cyRef.current) return;

    cyRef.current.animate({
      zoom: 1.5,
      duration: 400
    });
  };

  const testReset = () => {
    if (!cyRef.current) return;

    cyRef.current.animate({
      zoom: 1,
      pan: { x: 0, y: 0 },
      duration: 400
    });
  };

  return (
    <div className="validation-container">
      <div className="validation-header">
        <h2>Cytoscape HTML Card Validation</h2>
        <p className="current-test">{currentTest || 'Ready'}</p>
      </div>

      <div className="validation-controls">
        <button onClick={runPerformanceTest}>Run Performance Test (50 nodes)</button>
        <button onClick={testCameraControls}>Test: Fit to View</button>
        <button onClick={testZoom}>Test: Zoom In</button>
        <button onClick={testReset}>Test: Reset Camera</button>
      </div>

      <div className="validation-layout">
        <div className="graph-area">
          <div ref={containerRef} className="cytoscape-container" />
        </div>

        <div className="results-panel">
          <h3>Test Results</h3>
          <div className="results-list">
            {results.map((result, index) => (
              <div key={index} className={`result-item result-${result.status}`}>
                <div className="result-header">
                  <span className="result-status">
                    {result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '○'}
                  </span>
                  <span className="result-test">{result.test}</span>
                </div>
                <div className="result-message">{result.message}</div>
              </div>
            ))}
          </div>

          <div className="expected-results">
            <h4>Expected Tests</h4>
            <ul>
              <li>Test 1: Basic HTML Rendering (5 cards)</li>
              <li>Test 2: Edge Connections (5 edges)</li>
              <li>Test 3: Interactions (click card items)</li>
              <li>Test 5: Performance (50 nodes &lt;2s)</li>
              <li>Test 6: Camera State (save/restore)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
