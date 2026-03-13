#!/usr/bin/env node
/**
 * Demo Simulator — Runs in the background and generates realistic
 * agent activity for the Styrmann live demo.
 * 
 * Usage: node scripts/demo-simulator.js [--db path/to/db] [--interval 15000]
 * 
 * Every interval (default 15s), it picks a random action:
 * - Move a task to the next status
 * - Add an activity comment
 * - Change an agent's status
 * - Create a new event in the live feed
 * - Occasionally create a new task or complete one
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : path.join(process.cwd(), 'mission-control.db');

const interval = process.argv.includes('--interval')
  ? parseInt(process.argv[process.argv.indexOf('--interval') + 1])
  : 15000;

console.log(`[Simulator] Database: ${dbPath}`);
console.log(`[Simulator] Interval: ${interval}ms`);
console.log(`[Simulator] Starting simulation loop...\n`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Status flow
const STATUS_FLOW = ['planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'];

// Realistic comments agents might make
const COMMENTS = {
  builder: [
    'Initial implementation complete. Running local tests.',
    'Found a better approach using the strategy pattern. Refactoring.',
    'Added error boundaries and fallback UI. Build passing.',
    'Edge case handling added for empty arrays and null values.',
    'Performance optimization: cached database queries. 40% faster.',
    'TypeScript strict mode — fixed 12 type errors.',
    'Added input sanitization to prevent XSS.',
    'Implemented lazy loading for the dashboard components.',
    'Created reusable hook for WebSocket reconnection.',
    'Database migration written and tested. Schema looks good.',
  ],
  tester: [
    'Running integration test suite... 47/47 passing.',
    'Found a race condition in concurrent updates. Filing bug.',
    'Load testing complete: handles 1000 req/s on single core.',
    'Edge case: empty workspace causes 500 error. Needs fix.',
    'All API endpoints return proper error codes. Verified.',
    'Cross-browser testing: Chrome ✅ Firefox ✅ Safari ✅',
    'Accessibility audit: all WCAG 2.1 AA criteria met.',
    'Security scan: no vulnerabilities found in dependencies.',
  ],
  reviewer: [
    'Code review: clean implementation, good test coverage.',
    'Suggesting extraction of shared logic into utility module.',
    'LGTM — approved with minor nits.',
    'Architecture looks solid. Nice separation of concerns.',
    'Good use of TypeScript generics here. Approved.',
    'One concern about error handling in the webhook route. Otherwise good.',
  ],
  orchestrator: [
    'Triaging new tasks from the backlog.',
    'Assigning priority based on dependency analysis.',
    'Coordinating between Builder and Tester on handoff.',
    'Sprint review: 8 tasks completed this cycle.',
    'Updating project roadmap with new timeline estimates.',
    'Dispatching urgent security fix to Builder.',
  ],
  researcher: [
    'Analyzing competing solutions for the notification system.',
    'Benchmarking WebSocket vs SSE for real-time updates.',
    'Published findings: best practices for SQLite in production.',
    'Researching RBAC patterns for the permissions system.',
    'Completed analysis of rate limiting algorithms.',
  ],
};

// New task ideas for the simulator to create
const TASK_IDEAS = [
  { title: 'Add workspace search and filtering', priority: 'normal', desc: 'Search tasks by title, filter by status, priority, and assigned agent' },
  { title: 'Implement audit logging', priority: 'high', desc: 'Track all state changes with timestamps, user/agent attribution, and diff snapshots' },
  { title: 'Add batch task operations', priority: 'normal', desc: 'Select multiple tasks and perform bulk status changes, assignment, or deletion' },
  { title: 'Build analytics dashboard', priority: 'normal', desc: 'Charts showing task throughput, agent utilization, average completion time' },
  { title: 'Implement task templates', priority: 'low', desc: 'Save task configurations as templates for common workflows' },
  { title: 'Add keyboard shortcuts', priority: 'low', desc: 'Vim-style navigation, quick task creation with Cmd+N, status changes with number keys' },
  { title: 'Create mobile-responsive layout', priority: 'normal', desc: 'Stack kanban columns vertically on mobile, swipe to change status' },
  { title: 'Add SSE reconnection with backoff', priority: 'high', desc: 'Exponential backoff on SSE disconnect, visual indicator in header' },
  { title: 'Implement task time tracking', priority: 'normal', desc: 'Track time spent in each status, show burndown chart' },
  { title: 'Add webhook delivery dashboard', priority: 'normal', desc: 'Show webhook delivery attempts, success/failure rates, retry status' },
];

let taskIdeaIndex = 0;

// --- Simulation Actions ---

function advanceTask() {
  // Find a task that can be advanced (not done, not planning)
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.assigned_agent_id, a.name as agent_name, a.role as agent_role
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent_id = a.id
    WHERE t.status != 'done' AND t.status != 'planning'
    ORDER BY RANDOM() LIMIT 1
  `).get();

  if (!tasks) return null;

  const currentIdx = STATUS_FLOW.indexOf(tasks.status);
  if (currentIdx < 0 || currentIdx >= STATUS_FLOW.length - 1) return null;

  const nextStatus = STATUS_FLOW[currentIdx + 1];

  // If moving to assigned/in_progress, ensure there's an agent
  let agentId = tasks.assigned_agent_id;
  if (!agentId && ['assigned', 'in_progress'].includes(nextStatus)) {
    const agent = db.prepare(`SELECT id FROM agents WHERE role = 'builder' AND workspace_id = (SELECT workspace_id FROM tasks WHERE id = ?) LIMIT 1`).get(tasks.id);
    if (agent) {
      agentId = agent.id;
      db.prepare(`UPDATE tasks SET assigned_agent_id = ? WHERE id = ?`).run(agentId, tasks.id);
    }
  }

  // If moving to testing, assign to tester
  if (nextStatus === 'testing') {
    const tester = db.prepare(`SELECT id FROM agents WHERE role = 'tester' LIMIT 1`).get();
    if (tester) {
      agentId = tester.id;
      db.prepare(`UPDATE tasks SET assigned_agent_id = ? WHERE id = ?`).run(agentId, tasks.id);
    }
  }

  // If moving to review, assign to reviewer
  if (nextStatus === 'review') {
    const reviewer = db.prepare(`SELECT id FROM agents WHERE role = 'reviewer' LIMIT 1`).get();
    if (reviewer) {
      agentId = reviewer.id;
      db.prepare(`UPDATE tasks SET assigned_agent_id = ? WHERE id = ?`).run(agentId, tasks.id);
    }
  }

  db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, now(), tasks.id);

  // Add event
  const emoji = nextStatus === 'done' ? '✅' : '🔄';
  db.prepare(`INSERT INTO events (id, type, message, agent_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), 'task_updated', `${emoji} Task "${tasks.title}" moved to ${nextStatus}`, agentId, now());

  return `Advanced "${tasks.title}" → ${nextStatus}`;
}

function addComment() {
  // Pick a task that's active
  const task = db.prepare(`
    SELECT t.id, t.title, t.assigned_agent_id, a.role
    FROM tasks t
    JOIN agents a ON t.assigned_agent_id = a.id
    WHERE t.status IN ('assigned', 'in_progress', 'testing', 'review')
    ORDER BY RANDOM() LIMIT 1
  `).get();

  if (!task) return null;

  const role = task.role || 'builder';
  const comments = COMMENTS[role] || COMMENTS.builder;
  const comment = pick(comments);

  db.prepare(`INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuid(), task.id, task.assigned_agent_id, 'comment', comment, now());

  return `Comment on "${task.title}": ${comment.substring(0, 60)}...`;
}

function toggleAgentStatus() {
  const agent = db.prepare(`SELECT id, name, status, role FROM agents WHERE role != 'orchestrator' ORDER BY RANDOM() LIMIT 1`).get();
  if (!agent) return null;

  const statuses = ['working', 'standby', 'offline'];
  const newStatus = pick(statuses.filter(s => s !== agent.status));

  db.prepare(`UPDATE agents SET status = ?, updated_at = ? WHERE id = ?`).run(newStatus, now(), agent.id);

  return `Agent ${agent.name}: ${agent.status} → ${newStatus}`;
}

function createNewTask() {
  if (taskIdeaIndex >= TASK_IDEAS.length) taskIdeaIndex = 0;
  const idea = TASK_IDEAS[taskIdeaIndex++];

  // Check if we have too many tasks (keep it manageable)
  const count = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status != 'done'`).get();
  if (count.n > 12) {
    // Instead of creating, complete a done task removal isn't needed — just skip
    return null;
  }

  const wsId = db.prepare(`SELECT id FROM workspaces LIMIT 1`).get()?.id;
  const charlieId = db.prepare(`SELECT id FROM agents WHERE role = 'orchestrator' LIMIT 1`).get()?.id;
  if (!wsId || !charlieId) return null;

  const id = uuid();
  db.prepare(`INSERT INTO tasks (id, title, description, status, priority, workspace_id, created_by_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, idea.title, idea.desc, 'inbox', idea.priority, wsId, charlieId, now(), now());

  db.prepare(`INSERT INTO events (id, type, message, agent_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), 'task_created', `📋 New task: ${idea.title}`, charlieId, now());

  return `Created task: "${idea.title}"`;
}

function recycleDoneTasks() {
  // Move old done tasks back to planning to keep the board cycling
  const doneTasks = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status = 'done'`).get();
  if (doneTasks.n < 4) return null;

  const task = db.prepare(`SELECT id, title FROM tasks WHERE status = 'done' ORDER BY updated_at ASC LIMIT 1`).get();
  if (!task) return null;

  db.prepare(`UPDATE tasks SET status = 'planning', assigned_agent_id = NULL, updated_at = ? WHERE id = ?`).run(now(), task.id);

  db.prepare(`INSERT INTO events (id, type, message, created_at) VALUES (?, ?, ?, ?)`)
    .run(uuid(), 'task_updated', `🔄 Task "${task.title}" reopened for next iteration`, now());

  return `Recycled "${task.title}" back to planning`;
}

// --- Main Loop ---

const actions = [
  { fn: advanceTask, weight: 35 },
  { fn: addComment, weight: 30 },
  { fn: toggleAgentStatus, weight: 15 },
  { fn: createNewTask, weight: 10 },
  { fn: recycleDoneTasks, weight: 10 },
];

function pickAction() {
  const total = actions.reduce((sum, a) => sum + a.weight, 0);
  let r = Math.random() * total;
  for (const action of actions) {
    r -= action.weight;
    if (r <= 0) return action.fn;
  }
  return actions[0].fn;
}

let tick = 0;

function simulate() {
  tick++;
  const action = pickAction();
  const result = action();
  
  if (result) {
    console.log(`[${new Date().toLocaleTimeString()}] #${tick} ${result}`);
  } else {
    // Try a different action
    const fallback = pick(actions).fn;
    const fallbackResult = fallback();
    if (fallbackResult) {
      console.log(`[${new Date().toLocaleTimeString()}] #${tick} ${fallbackResult}`);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] #${tick} (idle)`);
    }
  }
}

// Run immediately and then on interval
simulate();
setInterval(simulate, interval);

console.log(`[Simulator] Running. Press Ctrl+C to stop.\n`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Simulator] Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
