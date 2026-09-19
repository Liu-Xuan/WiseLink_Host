// Graph Search Bar - Phase 3.3: Real-time node search
import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { GraphNode } from '../types';

interface SearchResult {
  node: GraphNode;
  matchType: 'title' | 'id' | 'metadata';
  matchText: string;
}

interface GraphSearchBarProps {
  nodes: GraphNode[];
  onResultClick: (nodeId: string) => void;
  placeholder?: string;
}

/**
 * Real-time search bar for graph nodes
 *
 * Features:
 * - Fuzzy search across node titles, IDs, and metadata
 * - Dropdown results with keyboard navigation
 * - Click to focus node
 * - Keyboard shortcuts (Cmd+K to focus)
 */
export function GraphSearchBar({
  nodes,
  onResultClick,
  placeholder = '搜索节点... (⌘K)'
}: GraphSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract searchable text from node
  const getNodeSearchText = useCallback((node: GraphNode): string[] => {
    const texts: string[] = [];

    // Add node ID
    texts.push(node.id.toLowerCase());

    // Add title based on node type
    if ('title' in node.data) {
      texts.push(node.data.title.toLowerCase());
    }
    if ('heading' in node.data) {
      texts.push(node.data.heading.toLowerCase());
    }

    // Add metadata if present
    const nodeData = node.data as { metadata?: Record<string, unknown> };
    if (nodeData.metadata) {
      Object.values(nodeData.metadata).forEach(val => {
        if (typeof val === 'string') {
          texts.push(val.toLowerCase());
        }
      });
    }

    return texts;
  }, []);

  // Search nodes
  const searchNodes = useCallback((searchQuery: string): SearchResult[] => {
    if (!searchQuery.trim()) return [];

    const lowerQuery = searchQuery.toLowerCase();
    const matches: SearchResult[] = [];

    nodes.forEach(node => {
      const searchTexts = getNodeSearchText(node);

      // Check ID match
      if (node.id.toLowerCase().includes(lowerQuery)) {
        matches.push({
          node,
          matchType: 'id',
          matchText: node.id
        });
        return;
      }

      // Check title/heading match
      for (const text of searchTexts) {
        if (text.includes(lowerQuery)) {
          matches.push({
            node,
            matchType: 'title',
            matchText: text
          });
          return;
        }
      }
    });

    return matches.slice(0, 10); // Limit to 10 results
  }, [nodes, getNodeSearchText]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);

    if (newQuery.trim()) {
      const newResults = searchNodes(newQuery);
      setResults(newResults);
      setSelectedIndex(0);
      setIsOpen(true);
    } else {
      setResults([]);
      setIsOpen(false);
    }
  }, [searchNodes]);

  // Handle result click
  const handleResultClick = useCallback((nodeId: string) => {
    onResultClick(nodeId);
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  }, [onResultClick]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleResultClick(results[selectedIndex].node.id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, results, selectedIndex, handleResultClick]);

  // Keyboard shortcut (Cmd+K)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get display title for node
  const getNodeTitle = (node: GraphNode): string => {
    if ('title' in node.data) return node.data.title;
    if ('heading' in node.data) return node.data.heading;
    return node.id;
  };

  return (
    <div className="graph-search-bar">
      <div className="search-input-wrapper">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="search-input"
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            title="清除"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div ref={dropdownRef} className="search-results">
          {results.map((result, index) => (
            <button
              key={result.node.id}
              className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleResultClick(result.node.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="result-icon">
                {result.node.type === 'matterHub' && '📋'}
                {result.node.type === 'cluster' && '🔵'}
                {result.node.type === 'documentGroup' && '📁'}
                {result.node.type === 'compact' && '📄'}
                {result.node.type === 'more' && '⋯'}
              </div>
              <div className="result-content">
                <div className="result-title">{getNodeTitle(result.node)}</div>
                <div className="result-meta">
                  <span className="result-type">{result.node.type}</span>
                  <span className="result-id">{result.node.id}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query && results.length === 0 && (
        <div ref={dropdownRef} className="search-results">
          <div className="search-no-results">
            未找到匹配的节点
          </div>
        </div>
      )}
    </div>
  );
}
