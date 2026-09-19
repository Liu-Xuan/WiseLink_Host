// Mock graph data for development
import type { GraphData, PerspectiveType } from '../types';

// Document perspective: Mixed node types showing all capabilities
const DOCUMENT_PERSPECTIVE: GraphData = {
  nodes: [
    // Matter Hub - central node
    {
      id: 'matter-hub',
      type: 'matterHub',
      position: { x: 400, y: 250 },
      data: {
        title: 'FMC 软件条件调查',
        subtitle: '当前工作',
        type: 'matter',
        tone: 'blue'
      }
    },
    // Document Group
    {
      id: 'group-1',
      type: 'documentGroup',
      position: { x: 150, y: 150 },
      data: {
        title: '需求文档组',
        count: 12,
        docs: ['产品需求文档 v3.1', '用户故事集 v2.0', 'UI/UX 设计规范'],
        type: 'documentGroup'
      }
    },
    // Compact nodes
    {
      id: 'compact-1',
      type: 'compact',
      position: { x: 600, y: 150 },
      data: {
        title: 'SB-DEMO-033',
        brief: 'R03 · 起落架服务通告',
        type: 'document',
        tone: 'green'
      }
    },
    {
      id: 'compact-2',
      type: 'compact',
      position: { x: 600, y: 350 },
      data: {
        title: 'API 接口规范',
        brief: 'V2.1 · RESTful API 设计文档',
        type: 'document',
        tone: 'blue'
      }
    },
    // Cluster node
    {
      id: 'cluster-1',
      type: 'cluster',
      position: { x: 150, y: 400 },
      data: {
        heading: 'Gear Documentation',
        count: 8,
        type: 'cluster',
        tone: 'amber'
      }
    },
    // More node
    {
      id: 'more-1',
      type: 'more',
      position: { x: 350, y: 450 },
      data: {
        count: 15,
        parentId: 'cluster-1',
        type: 'more'
      }
    }
  ],
  edges: [
    { id: 'edge-hub-1', source: 'matter-hub', target: 'group-1', label: '引用', type: 'reference' },
    { id: 'edge-hub-c1', source: 'matter-hub', target: 'compact-1', type: 'reference' },
    { id: 'edge-hub-c2', source: 'matter-hub', target: 'compact-2', type: 'dependency' },
    { id: 'edge-hub-cluster', source: 'matter-hub', target: 'cluster-1', type: 'relation' },
    { id: 'edge-cluster-more', source: 'cluster-1', target: 'more-1', animated: true }
  ]
};

// Knowledge perspective: knowledge nodes with compact and hub nodes
const KNOWLEDGE_PERSPECTIVE: GraphData = {
  nodes: [
    {
      id: 'k-hub',
      type: 'matterHub',
      position: { x: 350, y: 250 },
      data: {
        title: '图谱可视化',
        subtitle: '核心技术',
        type: 'matter',
        tone: 'green'
      }
    },
    {
      id: 'k-1',
      type: 'compact',
      position: { x: 200, y: 150 },
      data: {
        title: 'React Flow',
        brief: '图谱渲染引擎',
        type: 'document',
        tone: 'blue'
      }
    },
    {
      id: 'k-2',
      type: 'compact',
      position: { x: 500, y: 150 },
      data: {
        title: 'd3-force',
        brief: '力导向布局算法',
        type: 'document',
        tone: 'blue'
      }
    },
    {
      id: 'k-3',
      type: 'compact',
      position: { x: 200, y: 350 },
      data: {
        title: 'TypeScript',
        brief: '类型系统支持',
        type: 'document',
        tone: 'amber'
      }
    },
    {
      id: 'k-4',
      type: 'compact',
      position: { x: 500, y: 350 },
      data: {
        title: '性能优化',
        brief: '虚拟化渲染',
        type: 'document',
        tone: 'green'
      }
    }
  ],
  edges: [
    { id: 'k-edge-hub-1', source: 'k-hub', target: 'k-1', type: 'reference' },
    { id: 'k-edge-hub-2', source: 'k-hub', target: 'k-2', type: 'reference' },
    { id: 'k-edge-hub-3', source: 'k-hub', target: 'k-3', type: 'dependency' },
    { id: 'k-edge-hub-4', source: 'k-hub', target: 'k-4', type: 'relation' }
  ]
};

// Timeline perspective: chronological organization
const TIMELINE_PERSPECTIVE: GraphData = {
  nodes: [
    {
      id: 't-1',
      type: 'documentGroup',
      position: { x: 150, y: 150 },
      data: {
        title: '2026-09 Week 1',
        count: 6,
        docs: ['技术研究', '框架选型', '验证场地'],
        type: 'documentGroup'
      }
    },
    {
      id: 't-2',
      type: 'documentGroup',
      position: { x: 350, y: 150 },
      data: {
        title: '2026-09 Week 2',
        count: 8,
        docs: ['页面实现', '布局设计', '组件开发'],
        type: 'documentGroup'
      }
    },
    {
      id: 't-3',
      type: 'documentGroup',
      position: { x: 550, y: 150 },
      data: {
        title: '2026-09 Week 3',
        count: 10,
        docs: ['数据集成', 'API 对接', '测试优化'],
        type: 'documentGroup'
      }
    }
  ],
  edges: [
    { id: 't-edge-1-2', source: 't-1', target: 't-2', animated: true },
    { id: 't-edge-2-3', source: 't-2', target: 't-3', animated: true }
  ]
};

// People perspective: collaboration relationships
const PEOPLE_PERSPECTIVE: GraphData = {
  nodes: [
    {
      id: 'p-1',
      type: 'documentGroup',
      position: { x: 300, y: 200 },
      data: {
        title: '产品团队',
        count: 4,
        docs: ['产品经理', 'UI 设计师', 'UX 研究员'],
        type: 'documentGroup'
      }
    },
    {
      id: 'p-2',
      type: 'documentGroup',
      position: { x: 500, y: 200 },
      data: {
        title: '开发团队',
        count: 6,
        docs: ['前端工程师', '后端工程师', '全栈工程师'],
        type: 'documentGroup'
      }
    },
    {
      id: 'p-3',
      type: 'documentGroup',
      position: { x: 700, y: 200 },
      data: {
        title: '测试团队',
        count: 3,
        docs: ['测试工程师', '自动化测试', '质量保证'],
        type: 'documentGroup'
      }
    }
  ],
  edges: [
    { id: 'p-edge-1-2', source: 'p-1', target: 'p-2', label: '协作' },
    { id: 'p-edge-2-3', source: 'p-2', target: 'p-3', label: '交付' },
    { id: 'p-edge-1-3', source: 'p-1', target: 'p-3', label: '验收' }
  ]
};

export const MOCK_GRAPH_DATA: Record<PerspectiveType, GraphData> = {
  document: DOCUMENT_PERSPECTIVE,
  knowledge: KNOWLEDGE_PERSPECTIVE,
  timeline: TIMELINE_PERSPECTIVE,
  people: PEOPLE_PERSPECTIVE
};

// Mock timeline events
export const MOCK_TIMELINE_EVENTS = [
  {
    id: 'event-1',
    timestamp: new Date('2026-09-18T10:00:00'),
    type: 'create' as const,
    title: '创建需求文档',
    documentId: 'group-1',
    description: '产品需求文档 v3.1 创建'
  },
  {
    id: 'event-2',
    timestamp: new Date('2026-09-18T11:30:00'),
    type: 'update' as const,
    title: '更新技术设计',
    documentId: 'group-2',
    description: '系统架构设计更新'
  },
  {
    id: 'event-3',
    timestamp: new Date('2026-09-18T14:00:00'),
    type: 'review' as const,
    title: '代码审查',
    documentId: 'group-3',
    description: '前端代码审查完成'
  },
  {
    id: 'event-4',
    timestamp: new Date('2026-09-18T16:00:00'),
    type: 'comment' as const,
    title: '测试反馈',
    documentId: 'group-4',
    description: '发现 3 个关键 Bug'
  }
];
