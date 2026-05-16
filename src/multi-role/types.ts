/** Role types for the multi-role agent system */
export const ROLE_TYPES = {
  CEO: 'ceo',
  CTO: 'cto',
  OPERATIONS_DIRECTOR: 'operations_director',
  PRODUCT_MANAGER: 'product_manager',
  BRAND_DESIGNER: 'brand_designer',
  FRONTEND_ENGINEER: 'frontend_engineer',
  BACKEND_ENGINEER: 'backend_engineer',
  SALES_SPECIALIST: 'sales_specialist',
} as const

export type RoleType = (typeof ROLE_TYPES)[keyof typeof ROLE_TYPES]

/** Knowledge base priority levels */
export type KnowledgePriority = 'must' | 'suggested' | 'none'

/** Role metadata for display and configuration */
export interface RoleMeta {
  roleId: string
  roleName: string
  description: string
  category: 'decision' | 'product' | 'execution'
  knowledgePriority: KnowledgePriority
  defaultAutoInject: boolean
}

/** Task definition for multi-role task system */
export interface AgentTask {
  taskId: string
  title: string
  description: string
  assignedRole: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  result?: string
  dependsOn?: string[]
}

/** Role state for persistence */
export interface RoleState {
  currentRoleId: string
  taskList: AgentTask[]
  lastUpdated: string
}

/** Pre-defined role metadata catalog */
export const ROLE_CATALOG: Record<string, RoleMeta> = {
  ceo: {
    roleId: 'ceo',
    roleName: '总控CEO',
    description: '负责整体任务拆分、资源调度、跨角色协调、最终决策',
    category: 'decision',
    knowledgePriority: 'none',
    defaultAutoInject: false,
  },
  'product-manager': {
    roleId: 'product-manager',
    roleName: '产品经理',
    description: '负责需求分析、产品设计、PRD撰写、原型规划',
    category: 'product',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'brand-designer': {
    roleId: 'brand-designer',
    roleName: '品牌设计师',
    description: '负责视觉设计、品牌规范、UI风格定义',
    category: 'product',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'frontend-engineer': {
    roleId: 'frontend-engineer',
    roleName: '前端工程师',
    description: '负责前端代码开发、UI实现、页面构建',
    category: 'execution',
    knowledgePriority: 'suggested',
    defaultAutoInject: false,
  },
  'backend-engineer': {
    roleId: 'backend-engineer',
    roleName: '后端工程师',
    description: '负责后端代码开发、API设计、数据库管理',
    category: 'execution',
    knowledgePriority: 'suggested',
    defaultAutoInject: false,
  },
  'sales-specialist': {
    roleId: 'sales-specialist',
    roleName: '销售专员',
    description: '负责文案撰写、邮件处理、客户沟通、社交内容创作',
    category: 'execution',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'operations-specialist': {
    roleId: 'operations-specialist',
    roleName: '运营专员',
    description: '负责内容运营、用户运营、数据分析、活动策划',
    category: 'execution',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'qa-engineer': {
    roleId: 'qa-engineer',
    roleName: 'QA测试工程师',
    description: '负责功能测试、回归测试、Bug管理、验收测试',
    category: 'execution',
    knowledgePriority: 'suggested',
    defaultAutoInject: false,
  },
  'customer-service': {
    roleId: 'customer-service',
    roleName: '客服专员',
    description: '负责客户咨询、售后支持、问题反馈、工单管理',
    category: 'execution',
    knowledgePriority: 'suggested',
    defaultAutoInject: true,
  },
  'finance-assistant': {
    roleId: 'finance-assistant',
    roleName: '财务助理',
    description: '负责发票管理、收支记录、账单生成、财务报表',
    category: 'execution',
    knowledgePriority: 'none',
    defaultAutoInject: false,
  },
  'personal-strategist': {
    roleId: 'personal-strategist',
    roleName: '个人战略顾问',
    description: '负责人生规划、职业发展、时间管理、日常任务安排',
    category: 'decision',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'financial-planner': {
    roleId: 'financial-planner',
    roleName: '财务规划师',
    description: '负责个人财务管理、投资规划、预算优化、税务筹划',
    category: 'decision',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'freelance-consultant': {
    roleId: 'freelance-consultant',
    roleName: '接单顾问',
    description: '负责IT/IP接单、项目评估、报价谈判、合同审核、客户沟通',
    category: 'execution',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'architect': {
    roleId: 'architect',
    roleName: '系统架构师',
    description: '负责系统设计、API合约定义、技术选型、架构评审。确保系统可扩展、可维护。',
    category: 'decision',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'project-manager': {
    roleId: 'project-manager',
    roleName: '专案经理',
    description: '负责任务拆解、依赖排序、Sprint规划、Git分支管理、进度追踪。确保按时交付。',
    category: 'decision',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'devops-engineer': {
    roleId: 'devops-engineer',
    roleName: 'DevOps/SRE 工程师',
    description: '负责Docker/CI/CD部署、生产环境监控、日志告警、灾备恢复。确保线上稳定运行。',
    category: 'execution',
    knowledgePriority: 'suggested',
    defaultAutoInject: false,
  },
  'story-master': {
    roleId: 'story-master',
    roleName: 'Story Master（关主）',
    description: '负责MVP需求定义、任务派发、结果验收、错误定位。他说「做什麼」、检查「哪裡錯」，不寫代碼。適合快速迭代的雙人開發模式。',
    category: 'decision',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
  'builder': {
    roleId: 'builder',
    roleName: 'Builder（全端执行者）',
    description: '负责代码编写、重构、安全审计、Docker/CI部署、日志监控、日常维护。全能執行者——只管做，做完回報關主驗收。',
    category: 'execution',
    knowledgePriority: 'must',
    defaultAutoInject: true,
  },
}
