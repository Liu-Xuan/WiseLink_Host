import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import ReaderHeader from './ReaderHeader';
import ReaderControls from './ReaderControls';
import ReaderLayout from './ReaderLayout';
import './reader.css';

export type ReaderViewMode =
  | 'original-pdf'   // 原文＋原件（默认）
  | 'bilingual'      // 中英对照
  | 'chinese'        // 中文阅读
  | 'original'       // 仅原文
  | 'pdf';           // 仅原件

export type OutlineType = 'author' | 'business';

export interface ReaderBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'table' | 'list';
  role: 'background' | 'scope' | 'limitations' | 'comparison' | 'revision' | 'references' | 'general';
  page: number;
  title: string;
  zhTitle: string;
  en: string;
  zh: string;
  sourceRefIds?: string[];
  // 表格特有
  headers?: string[];
  zhHeaders?: string[];
  rows?: string[][];
  zhRows?: string[][];
}

export interface ReaderDocument {
  id: string;
  familyId: string;
  version: string;
  title: string;
  type: string;
  current: boolean;
  chinesePartial: boolean;
  binding: {
    parseRunId: string;
    parseRevision: string;
    documentVersionId: string;
    selector: string;
  };
  blocks: ReaderBlock[];
  pdf: {
    file: string;
    pageCount: number;
    pages?: string[];
  } | null;
  pdfState: 'available' | 'native' | 'unavailable';
  locations?: Record<string, {
    precision: 'PAGE' | 'REGION';
    pageIndex: number;
    pageWidth: number;
    pageHeight: number;
    rect: [number, number, number, number];
  }>;
}

interface ReaderPageState {
  mode: ReaderViewMode;
  outline: boolean;
  outlineType: OutlineType;
  split: number;
  selectedBlockId: string;
  pdfPage: number;
  pdfZoom: number;
  sync: boolean;
  mobileSide: 'left' | 'right';
}

function getStorageKey(documentId: string, parseRunId: string): string {
  return `reader-${documentId}-${parseRunId}`;
}

function loadState(key: string, sourceRef: string, defaultBlockId: string): ReaderPageState {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 如果路由带了 sourceRef 且与保存的匹配，使用保存的状态
      if (sourceRef && parsed.routeSource === sourceRef) {
        return parsed;
      }
      // 否则使用默认状态，但保留部分偏好设置
      return {
        mode: parsed.mode || 'original-pdf',
        outline: parsed.outline !== false,
        outlineType: parsed.outlineType || 'author',
        split: parsed.split || 50,
        selectedBlockId: sourceRef || defaultBlockId,
        pdfPage: 0,
        pdfZoom: parsed.pdfZoom || 100,
        sync: parsed.sync !== false,
        mobileSide: 'left',
      };
    }
  } catch (e) {
    // Failed to load reader state
  }

  return {
    mode: 'original-pdf',
    outline: true,
    outlineType: 'author',
    split: 50,
    selectedBlockId: sourceRef || defaultBlockId,
    pdfPage: 0,
    pdfZoom: 100,
    sync: true,
    mobileSide: 'left',
  };
}

function saveState(key: string, state: ReaderPageState, routeSource: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...state, routeSource }));
  } catch (e) {
    // Failed to save reader state
  }
}

export default function ReaderPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sourceRef = searchParams.get('source') || '';
  const parseRunId = searchParams.get('parse') || '';

  const [document, setDocument] = useState<ReaderDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const storageKey = document ? getStorageKey(document.id, document.binding.parseRunId) : '';
  const defaultBlockId = document?.blocks[0]?.id || '';

  const [state, setState] = useState<ReaderPageState>(() =>
    loadState('', sourceRef, defaultBlockId)
  );

  // 加载文档数据
  useEffect(() => {
    if (!documentId) return;

    setLoading(true);
    setError(null);

    // TODO: 替换为真实的 API 调用
    // 这里使用 mock 数据演示
    setTimeout(() => {
      const mockDocument: ReaderDocument = {
        id: documentId,
        familyId: 'AMM-25-11-00',
        version: 'Rev 45',
        title: 'Flight Control System',
        type: 'AMM',
        current: true,
        chinesePartial: true,
        binding: {
          parseRunId: parseRunId || 'parse-123',
          parseRevision: 'r5',
          documentVersionId: 'v-123',
          selector: 'block-1',
        },
        blocks: [
          {
            id: 'block-1',
            kind: 'heading',
            role: 'background',
            page: 0,
            title: 'General',
            zhTitle: '概述',
            en: 'This section describes the flight control system architecture and components.',
            zh: '本节描述飞行控制系统的架构和组件。',
          },
          {
            id: 'block-2',
            kind: 'paragraph',
            role: 'scope',
            page: 0,
            title: 'Scope',
            zhTitle: '适用范围',
            en: 'The flight control system applies to all aircraft series.',
            zh: '飞行控制系统适用于所有飞机系列。',
          },
          {
            id: 'block-3',
            kind: 'table',
            role: 'general',
            page: 1,
            title: 'Component List',
            zhTitle: '组件清单',
            en: 'Component specifications',
            zh: '组件规格',
            headers: ['Component', 'Part Number', 'Quantity'],
            zhHeaders: ['组件', '件号', '数量'],
            rows: [
              ['Flight Control Computer', 'FCC-001', '2'],
              ['Actuator', 'ACT-100', '4'],
            ],
            zhRows: [
              ['飞行控制计算机', 'FCC-001', '2'],
              ['作动器', 'ACT-100', '4'],
            ],
          },
        ],
        pdf: {
          file: '/assets/sample.pdf',
          pageCount: 10,
        },
        pdfState: 'available',
      };

      setDocument(mockDocument);
      setLoading(false);

      // 加载保存的状态
      const loadedState = loadState(
        getStorageKey(mockDocument.id, mockDocument.binding.parseRunId),
        sourceRef,
        mockDocument.blocks[0]?.id || ''
      );
      setState(loadedState);
    }, 300);
  }, [documentId, parseRunId, sourceRef]);

  // 保存状态
  useEffect(() => {
    if (document && storageKey) {
      saveState(storageKey, state, sourceRef);
    }
  }, [state, storageKey, sourceRef, document]);

  // 状态更新回调
  const updateState = useCallback(<K extends keyof ReaderPageState>(
    key: K,
    value: ReaderPageState[K]
  ) => {
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleBlockSelect = useCallback((blockId: string) => {
    const block = document?.blocks.find(b => b.id === blockId);
    if (block) {
      setState(prev => ({
        ...prev,
        selectedBlockId: blockId,
        pdfPage: block.page,
      }));
    }
  }, [document]);

  const handlePdfPageChange = useCallback((page: number) => {
    setState(prev => ({ ...prev, pdfPage: page }));
  }, []);

  const handlePdfZoomChange = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, pdfZoom: zoom }));
  }, []);

  if (loading) {
    return (
      <div className="reader-page loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="reader-page error">
        <div className="error-message">
          <h2>加载失败</h2>
          <p>{error || '文档不存在'}</p>
          <button onClick={() => navigate(-1)}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-page">
      <ReaderHeader
        document={document}
        onBack={() => navigate(-1)}
        onOpenRevision={() => navigate(`/dev-preview/version-comparison/${encodeURIComponent(document.id)}`)}
      />

      <ReaderControls
        mode={state.mode}
        outline={state.outline}
        sync={state.sync}
        mobileSide={state.mobileSide}
        onModeChange={(mode) => updateState('mode', mode)}
        onOutlineToggle={() => updateState('outline', !state.outline)}
        onSyncToggle={() => updateState('sync', !state.sync)}
        onMobileSideChange={(side) => updateState('mobileSide', side)}
      />

      <ReaderLayout
        document={document}
        mode={state.mode}
        outline={state.outline}
        outlineType={state.outlineType}
        split={state.split}
        selectedBlockId={state.selectedBlockId}
        pdfPage={state.pdfPage}
        pdfZoom={state.pdfZoom}
        sync={state.sync}
        mobileSide={state.mobileSide}
        onOutlineTypeChange={(type) => updateState('outlineType', type)}
        onSplitChange={(split) => updateState('split', split)}
        onBlockSelect={handleBlockSelect}
        onPdfPageChange={handlePdfPageChange}
        onPdfZoomChange={handlePdfZoomChange}
      />
    </div>
  );
}
